import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  rulesConfigurationPreset,
  RulesConfigurationSchema,
  SeatingPolicySchema,
} from "@dglz/protocol";
import {
  ACTION_ENCODING_BOUNDS,
  MAX_LEGAL_ACTIONS,
  RESEARCH_ENCODING_VERSION,
  createHandSession,
  decodeChallengeTemplate,
  replayHand,
  type HandSession,
  type HandSessionOptions,
} from "./index.js";

export const BRIDGE_VERSION = 1;

class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function requireRequest(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new RequestError("invalid-request", message);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  requireRequest(
    Object.keys(value).every((key) => allowed.includes(key)),
    "请求包含未知字段。",
  );
}

function resetOptions(value: unknown): HandSessionOptions {
  requireRequest(object(value), "缺少初始化设置。");
  keys(value, [
    "players",
    "preset",
    "handSeed",
    "template",
    "rulesConfiguration",
    "seatingPolicy",
    "actionLimit",
    "record",
  ]);
  requireRequest(
    value.players === 4 || value.players === 6,
    "人数必须为四或六。",
  );
  requireRequest(
    Number.isSafeInteger(value.actionLimit) &&
      (value.actionLimit as number) > 0,
    "动作上限必须为正整数。",
  );
  requireRequest(typeof value.record === "boolean", "记录开关无效。");
  const seating = SeatingPolicySchema.safeParse(value.seatingPolicy);
  requireRequest(seating.success, "座位策略无效。");
  const common = {
    seatingPolicy: seating.data,
    actionLimit: value.actionLimit as number,
    record: value.record,
  };
  const rulesetId = value.players === 4 ? "dglz-4p-2d-v1" : "dglz-6p-3d-v1";
  if (value.template !== undefined) {
    requireRequest(
      value.handSeed === undefined &&
        value.rulesConfiguration === undefined &&
        value.preset === undefined,
      "挑战模板不能与种子或规则设置混用。",
    );
    let template;
    try {
      template = decodeChallengeTemplate(value.template);
    } catch {
      throw new RequestError("invalid-request", "挑战模板无效。");
    }
    requireRequest(template.rulesetId === rulesetId, "挑战模板人数不符。");
    return { ...common, mode: "challenge", template };
  }
  requireRequest(
    typeof value.handSeed === "string" && value.handSeed.length > 0,
    "手牌种子不能为空。",
  );
  requireRequest(
    value.preset === undefined ||
      value.preset === "省心" ||
      value.preset === "自主",
    "规则预设无效。",
  );
  requireRequest(
    value.rulesConfiguration === undefined || value.preset === undefined,
    "不能同时指定规则和预设。",
  );
  const parsed = RulesConfigurationSchema.safeParse(
    value.rulesConfiguration ??
      rulesConfigurationPreset(rulesetId, value.preset ?? "省心"),
  );
  requireRequest(
    parsed.success && parsed.data.rulesetId === rulesetId,
    "规则设置或人数无效。",
  );
  return {
    ...common,
    mode: "first-hand",
    handSeed: value.handSeed,
    rulesConfiguration: parsed.data,
  };
}

/** One synchronous session per process. No HTTP, policy execution, or reward policy. */
export function createResearchBridge(): (value: unknown) => unknown {
  let session: HandSession | undefined;
  let episode = 0;
  function status() {
    assert(session !== undefined);
    return {
      episode,
      status: session.status,
      actionCount: session.actionCount,
      currentPlayerId:
        session.status === "active" ? session.currentPlayerId : null,
      outcome: session.getOutcome() ?? null,
    };
  }
  return (value) => {
    let id: number | null = null;
    try {
      requireRequest(object(value), "请求必须为对象。");
      requireRequest(
        Number.isSafeInteger(value.id) && (value.id as number) >= 0,
        "请求编号无效。",
      );
      id = value.id as number;
      if (value.version !== BRIDGE_VERSION)
        throw new RequestError("version-mismatch", "桥接协议版本不兼容。");
      keys(value, ["version", "id", "op", "args"]);
      requireRequest(object(value.args), "请求参数必须为对象。");
      const args = value.args;
      let data: unknown;
      if (value.op === "reset") {
        const options = resetOptions(args);
        session = createHandSession(options);
        episode += 1;
        data = {
          ...status(),
          encodingVersion: RESEARCH_ENCODING_VERSION,
          maxActions: MAX_LEGAL_ACTIONS,
          actionBounds: ACTION_ENCODING_BOUNDS,
          players: session.playerIds.map((playerId) => {
            const seatIndex = session!
              .observe(playerId)
              .seats.find((seat) => seat.playerId === playerId)!.seatIndex;
            return { playerId, seatIndex, teamIndex: seatIndex % 2 };
          }),
        };
      } else if (value.op === "replay") {
        keys(args, ["record"]);
        // Evaluator-only operation; neither input nor record enters observations.
        try {
          const run = replayHand(args.record);
          data = {
            outcome: {
              result: run.result,
              finishPositions: run.finishPositions,
            },
            actionCount: run.actionCount,
          };
        } catch {
          throw new RequestError("invalid-record", "复现记录无效或不一致。");
        }
      } else {
        if (session === undefined)
          throw new RequestError("not-reset", "请先初始化环境。");
        switch (value.op) {
          case "observe":
            keys(args, ["playerId"]);
            requireRequest(
              typeof args.playerId === "string" &&
                session.playerIds.includes(args.playerId),
              "玩家不在当前手牌中。",
            );
            data = session.observeResearch(args.playerId);
            break;
          case "step": {
            keys(args, ["episode", "actionCount", "playerId", "actionId"]);
            if (session.status !== "active")
              throw new RequestError(
                "episode-ended",
                "手牌已结束或达到动作上限。",
              );
            if (
              args.episode !== episode ||
              args.actionCount !== session.actionCount ||
              args.playerId !== session.currentPlayerId
            )
              throw new RequestError(
                "stale-action",
                "动作不属于当前回合或玩家。",
              );
            requireRequest(
              Number.isSafeInteger(args.actionId) &&
                (args.actionId as number) >= 0,
              "动作编号必须为非负整数。",
            );
            const observation = session.observeResearch(
              session.currentPlayerId!,
            );
            const action = observation.legalActions[args.actionId as number];
            if (action === undefined)
              throw new RequestError(
                "illegal-action",
                "动作编号不在合法候选中。",
              );
            session.step(action);
            data = status();
            break;
          }
          case "record": {
            keys(args, []);
            const record = session.getResult()?.record;
            if (record === undefined)
              throw new RequestError(
                "record-unavailable",
                "记录未启用或手牌尚未完成。",
              );
            data = record;
            break;
          }
          default:
            throw new RequestError("invalid-request", "未知操作。");
        }
      }
      return { version: BRIDGE_VERSION, id, ok: true, data };
    } catch (error) {
      const expected = error instanceof RequestError;
      // A failed engine transition may have progressed: require a fresh reset.
      if (!expected) session = undefined;
      return {
        version: BRIDGE_VERSION,
        id,
        ok: false,
        error: {
          code: expected ? error.code : "engine-error",
          message: expected ? error.message : "引擎执行失败，请重置环境。",
        },
      };
    }
  };
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const dispatch = createResearchBridge();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      request = undefined;
    }
    if (!process.stdout.write(JSON.stringify(dispatch(request)) + "\n")) {
      await new Promise<void>((done) => process.stdout.once("drain", done));
    }
  }
}

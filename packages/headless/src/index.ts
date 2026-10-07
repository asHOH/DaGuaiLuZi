import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  decide,
  derivePlayerView,
  evolve,
  isChallengeTemplate,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type Command,
  type ChallengeTemplate,
  type Event,
  type PlayerViewHandResult,
  type SeatingPolicy,
} from "@dglz/game-core";
import { RULESET_DEFINITIONS, type RulesConfiguration } from "@dglz/game-rules";
import {
  RoomCommandPayloadSchema,
  RulesConfigurationSchema,
  SeatingPolicySchema,
} from "@dglz/protocol";
import { passivePolicy, type Policy } from "./policy.js";

export {
  passivePolicy,
  type PassiveObservation,
  type Policy,
  type PolicyAction,
} from "./policy.js";

type PolicyOptions = Readonly<{
  /** Include a private, JSON-safe reproduction record. */
  record?: boolean;
  seatingPolicy?: SeatingPolicy;
  actionLimit?: number;
  /** Called once per player per run, so policies can keep separate memory. */
  createPolicy?: (playerId: string) => Policy;
}>;

export type FirstHandOptions = PolicyOptions &
  Readonly<{
    rulesConfiguration: RulesConfiguration;
    handSeed: string;
  }>;

export type ChallengeHandOptions = PolicyOptions &
  Readonly<{
    template: ChallengeTemplate;
    /** Defaults to the Template's rules; the Challenge uses its own configuration. */
    roomRulesConfiguration?: RulesConfiguration;
  }>;

export type HandRunResult = Readonly<{
  result: PlayerViewHandResult;
  finishPositions: readonly (number | undefined)[];
  actionCount: number;
  /** Evaluator-only history; includes private deal inputs. Never pass to policies. */
  events: readonly Event[];
  record?: HandRecord;
}>;

// Bump when engine/rules/view semantics change; old records are not migrated.
const SOURCE_VERSION = "dglz-headless-1";
export type HandRecord = Readonly<{
  formatVersion: 1;
  sourceVersion: string;
  randomnessVersion: typeof RANDOMNESS_VERSION;
  shuffleVersion: typeof SHUFFLE_VERSION;
  setup: Readonly<{
    mode: "first-hand" | "challenge";
    rulesConfiguration: RulesConfiguration;
    seatingPolicy: SeatingPolicy;
    handSeed?: string;
    template?: unknown;
  }>;
  created: unknown;
  steps: readonly Readonly<{
    command: unknown;
    observationHash?: string;
    events: readonly unknown[];
  }>[];
  expected: unknown;
}>;

function json(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON arrays encode absent Finish Positions as null. Validate after decoding. */
export function decodeChallengeTemplate(value: unknown): ChallengeTemplate {
  const template = structuredClone(value);
  if (
    object(template) &&
    object(template.setup) &&
    Array.isArray(template.setup.finishPositions)
  ) {
    template.setup.finishPositions = template.setup.finishPositions.map(
      (position: unknown) => (position === null ? undefined : position),
    );
  }
  assert(isChallengeTemplate(template), "挑战模板无效。");
  return template;
}

/** Re-executes recorded commands through decide; never creates or calls policies. */
export function replayHand(value: unknown): HandRunResult {
  assert(object(value), "复现记录必须为对象。");
  assert(
    value.formatVersion === 1 &&
      value.sourceVersion === SOURCE_VERSION &&
      value.randomnessVersion === RANDOMNESS_VERSION &&
      value.shuffleVersion === SHUFFLE_VERSION,
    "不支持的复现记录版本。",
  );
  assert(
    object(value.setup) &&
      Array.isArray(value.steps) &&
      value.steps.length > 0 &&
      value.steps.every(
        (step: unknown) =>
          object(step) && object(step.command) && Array.isArray(step.events),
      ),
    "复现记录的设置或动作无效。",
  );
  const setup = value.setup;
  assert(
    setup.mode === "first-hand" || setup.mode === "challenge",
    "复现记录的模式无效。",
  );
  const common = {
    seatingPolicy: SeatingPolicySchema.parse(setup.seatingPolicy),
    actionLimit: value.steps.length,
    record: true,
  };
  const rulesConfiguration = RulesConfigurationSchema.parse(
    setup.rulesConfiguration,
  );
  const options =
    setup.mode === "first-hand"
      ? {
          ...common,
          mode: "first-hand" as const,
          rulesConfiguration,
          handSeed: setup.handSeed as string,
        }
      : {
          ...common,
          mode: "challenge" as const,
          roomRulesConfiguration: rulesConfiguration,
          template: decodeChallengeTemplate(setup.template),
        };
  const run = runHand(options, value as unknown as HandRecord);
  assert(
    isDeepStrictEqual(run.record, value),
    "复现记录不一致：设置、事件、观察或结果已改变。",
  );
  return run;
}

export type FirstHandResult = HandRunResult;

/** Runs one initial Match Hand. */
export function runFirstHand(options: FirstHandOptions): FirstHandResult {
  return runHand({ ...options, mode: "first-hand" });
}

/** Runs one initial or subsequent Hand from a validated private Template. */
export function runChallengeHand(options: ChallengeHandOptions): HandRunResult {
  return runHand({ ...options, mode: "challenge" });
}

function runHand(
  options:
    | (FirstHandOptions & { mode: "first-hand" })
    | (ChallengeHandOptions & { mode: "challenge" }),
  replay?: HandRecord,
): HandRunResult {
  let template: ChallengeTemplate | undefined;
  if (options.mode === "challenge") {
    assert(isChallengeTemplate(options.template), "挑战模板无效。");
    template = structuredClone(options.template);
  } else {
    assert(
      typeof options.handSeed === "string" && options.handSeed.length > 0,
      "手牌种子不能为空。",
    );
  }
  const configuration = RulesConfigurationSchema.parse(
    options.mode === "challenge"
      ? (options.roomRulesConfiguration ?? template!.rulesConfiguration)
      : options.rulesConfiguration,
  );
  const seatingPolicy = SeatingPolicySchema.parse(
    options.seatingPolicy ?? "fixed",
  );
  const actionLimit = options.actionLimit ?? 1500;
  assert(
    Number.isSafeInteger(actionLimit) && actionLimit > 0,
    "动作上限必须为正整数。",
  );
  const playerIds = Array.from(
    {
      length:
        RULESET_DEFINITIONS[template?.rulesetId ?? configuration.rulesetId]
          .playerCount,
    },
    (_, index) => `p${index + 1}`,
  );
  const created: Event = {
    type: "RoomCreated",
    roomId: "headless",
    ownerId: "p1",
    rulesConfiguration: configuration,
    seatingPolicy,
  };
  const events: Event[] = [created];
  const steps: HandRecord["steps"][number][] = [];
  const recording = options.record === true;
  let state = evolve(undefined, created);
  let completed: Pick<HandRunResult, "result" | "finishPositions"> | undefined;
  function execute(command: Command, observationHash?: string): void {
    if (replay !== undefined) {
      const step = replay.steps[steps.length];
      assert(
        isDeepStrictEqual(step?.command, json(command)),
        `复现动作 ${steps.length + 1} 不一致。`,
      );
      assert.equal(
        step?.observationHash,
        observationHash,
        `复现观察 ${steps.length + 1} 不一致。`,
      );
    }
    const decision = decide(state, command);
    if (!decision.ok)
      throw new Error(`动作被拒绝：${decision.rejection.reason}`);
    assert(decision.events.length > 0, "动作未推进牌局。");
    if (replay !== undefined)
      assert(
        isDeepStrictEqual(
          json(decision.events),
          replay.steps[steps.length]?.events,
        ),
        `复现事件 ${steps.length + 1} 不一致。`,
      );
    if (recording)
      steps.push({
        command: json(command),
        ...(observationHash === undefined ? {} : { observationHash }),
        events: json(decision.events) as unknown[],
      });
    for (const event of decision.events) {
      state = evolve(state, event);
      events.push(event);
      // Completion returns Challenges (and terminal Matches) to the lobby.
      if (event.type === "HandResultDetermined") {
        const view = derivePlayerView(state, "p1");
        assert(
          view.handResult !== undefined && view.finishPositions !== undefined,
          "缺少手牌结算结果。",
        );
        completed = {
          result: view.handResult,
          finishPositions: view.finishPositions,
        };
      }
    }
  }
  // Select first: a Challenge may have a different seat count from the Room.
  execute(
    template === undefined
      ? { type: "SelectMatch", playerId: "p1" }
      : { type: "SelectChallengeHand", playerId: "p1", template },
  );
  for (const playerId of playerIds.slice(1))
    execute({ type: "JoinRoom", playerId });
  for (const [seatIndex, playerId] of playerIds.entries()) {
    execute({ type: "AssignSeat", playerId, seatIndex });
    execute({ type: "SetReadiness", playerId, ready: true });
  }
  execute(
    options.mode === "challenge"
      ? { type: "StartChallengeHand" }
      : {
          type: "StartMatch",
          handSeed: options.handSeed,
          randomnessVersion: RANDOMNESS_VERSION,
          shuffleVersion: SHUFFLE_VERSION,
        },
  );
  const createPolicy = options.createPolicy ?? (() => passivePolicy);
  const policies = new Map(
    replay === undefined
      ? playerIds.map((id) => [id, createPolicy(id)] as const)
      : [],
  );
  for (let actionCount = 0; ; actionCount += 1) {
    if (completed !== undefined) {
      const result = { ...completed, actionCount, events };
      if (!recording) return result;
      return {
        ...result,
        record: {
          formatVersion: 1,
          sourceVersion: SOURCE_VERSION,
          randomnessVersion: RANDOMNESS_VERSION,
          shuffleVersion: SHUFFLE_VERSION,
          setup: {
            mode: options.mode,
            rulesConfiguration: configuration,
            seatingPolicy,
            ...(options.mode === "first-hand"
              ? { handSeed: options.handSeed }
              : { template: json(template) }),
          },
          created: json(created),
          steps,
          expected: json({ ...completed, actionCount }),
        },
      };
    }
    const current = derivePlayerView(state, "p1");
    assert(actionCount < actionLimit, "已达到动作上限，当前手牌尚未完成。");
    const actor =
      current.setupStage === "play"
        ? current.currentActor
        : current.seats.find(
            (seat) =>
              seat.playerId !== undefined &&
              current.pendingPlayerIds?.includes(seat.playerId),
          )?.playerId;
    assert(actor !== undefined, "缺少当前行动玩家。");
    const view = derivePlayerView(state, actor);
    const observationHash = recording
      ? createHash("sha256").update(JSON.stringify(view)).digest("hex")
      : undefined;
    let action: unknown;
    if (replay === undefined) {
      const policy = policies.get(actor);
      assert(policy !== undefined, "缺少玩家策略。");
      action = policy(view, actor);
    } else {
      const command = replay.steps[steps.length]?.command;
      assert(object(command), `复现动作 ${steps.length + 1} 缺失。`);
      const { playerId, ...payload } = command;
      assert.equal(
        playerId,
        actor,
        `复现动作 ${steps.length + 1} 的玩家不一致。`,
      );
      action = payload;
    }
    assert(action !== undefined, "策略未提供动作。");
    const payload = RoomCommandPayloadSchema.parse(action);
    assert(
      payload.type === "Play" ||
        payload.type === "Pass" ||
        payload.type === "SelectTributeCard" ||
        payload.type === "OfferReturnCandidates" ||
        payload.type === "SelectReturnCard" ||
        payload.type === "SubmitTieChoiceBallot",
      "策略只能提交出牌或开局选择动作。",
    );
    execute({ ...payload, playerId: actor }, observationHash);
  }
}

import assert from "node:assert/strict";
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
}>;

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
  let state = evolve(undefined, created);
  let completed: Pick<HandRunResult, "result" | "finishPositions"> | undefined;
  function execute(command: Command): void {
    const decision = decide(state, command);
    if (!decision.ok)
      throw new Error(`动作被拒绝：${decision.rejection.reason}`);
    assert(decision.events.length > 0, "动作未推进牌局。");
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
  const policies = new Map(playerIds.map((id) => [id, createPolicy(id)]));
  for (let actionCount = 0; ; actionCount += 1) {
    if (completed !== undefined) return { ...completed, actionCount, events };
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
    const policy = policies.get(actor);
    assert(policy !== undefined, "缺少玩家策略。");
    const action = policy(derivePlayerView(state, actor), actor);
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
    execute({ ...payload, playerId: actor });
  }
}

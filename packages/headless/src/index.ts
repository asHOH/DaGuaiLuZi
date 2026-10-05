import assert from "node:assert/strict";
import {
  decide,
  derivePlayerView,
  evolve,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type Command,
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

export type FirstHandOptions = Readonly<{
  rulesConfiguration: RulesConfiguration;
  handSeed: string;
  seatingPolicy?: SeatingPolicy;
  actionLimit?: number;
  /** Called once per player per run, so policies can keep separate memory. */
  createPolicy?: (playerId: string) => Policy;
}>;

export type FirstHandResult = Readonly<{
  result: PlayerViewHandResult;
  finishPositions: readonly (number | undefined)[];
  actionCount: number;
  /** Evaluator-only history; includes private deal inputs. Never pass to policies. */
  events: readonly Event[];
}>;

/** Runs one initial Match Hand. Subsequent-Hand setup and file replay are deferred. */
export function runFirstHand(options: FirstHandOptions): FirstHandResult {
  const configuration = RulesConfigurationSchema.parse(
    options.rulesConfiguration,
  );
  const seatingPolicy = SeatingPolicySchema.parse(
    options.seatingPolicy ?? "fixed",
  );
  const actionLimit = options.actionLimit ?? 1500;
  assert(
    Number.isSafeInteger(actionLimit) && actionLimit > 0,
    "动作上限必须为正整数。",
  );
  assert(
    typeof options.handSeed === "string" && options.handSeed.length > 0,
    "手牌种子不能为空。",
  );
  const playerIds = Array.from(
    { length: RULESET_DEFINITIONS[configuration.rulesetId].playerCount },
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
  function execute(command: Command): void {
    const decision = decide(state, command);
    if (!decision.ok)
      throw new Error(`动作被拒绝：${decision.rejection.reason}`);
    assert(decision.events.length > 0, "动作未推进牌局。");
    for (const event of decision.events) {
      state = evolve(state, event);
      events.push(event);
    }
  }
  for (const playerId of playerIds.slice(1))
    execute({ type: "JoinRoom", playerId });
  for (const [seatIndex, playerId] of playerIds.entries()) {
    execute({ type: "AssignSeat", playerId, seatIndex });
    execute({ type: "SetReadiness", playerId, ready: true });
  }
  execute({ type: "SelectMatch", playerId: "p1" });
  execute({
    type: "StartMatch",
    handSeed: options.handSeed,
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
  });
  const createPolicy = options.createPolicy ?? (() => passivePolicy);
  const policies = new Map(playerIds.map((id) => [id, createPolicy(id)]));
  for (let actionCount = 0; ; actionCount += 1) {
    const current = derivePlayerView(state, "p1");
    if (current.handResult !== undefined) {
      assert(current.finishPositions !== undefined, "缺少完赛顺序。");
      return {
        result: current.handResult,
        finishPositions: current.finishPositions,
        actionCount,
        events,
      };
    }
    assert(actionCount < actionLimit, "已达到动作上限，当前手牌尚未完成。");
    const actor = current.currentActor;
    assert(actor !== undefined, "缺少当前行动玩家。");
    const policy = policies.get(actor);
    assert(policy !== undefined, "缺少玩家策略。");
    const action = policy(derivePlayerView(state, actor), actor);
    assert(action !== undefined, "策略未提供动作。");
    const payload = RoomCommandPayloadSchema.parse(action);
    assert(
      payload.type === "Play" || payload.type === "Pass",
      "首手策略只能出牌或不出。",
    );
    execute({ ...payload, playerId: actor });
  }
}

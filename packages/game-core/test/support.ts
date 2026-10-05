import { expect } from "vitest";
import {
  RULESET_DEFINITIONS,
  type RulesConfiguration,
  type SixPlayerRulesConfiguration,
  type FourPlayerRulesConfiguration,
} from "@dglz/game-rules";
import {
  decide,
  derivePlayerView,
  evolve,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type Command,
  type Event,
  type State,
} from "../src/index.js";

// Explicit test inputs, independent of production presets and allowed-value definitions.
export const SIX_PLAYER_CONFIGURATION: SixPlayerRulesConfiguration = {
  rulesetId: "dglz-6p-3d-v1",
  jokerPairComparison: "two-small-and-mixed-are-equal",
  wildcardRank: "strongest-rank",
  finishingWildcardInterpretation: "weakest-form-and-rank",
  flushTieBreaking: "descending-ranks",
  nextHandLeader: "first-finisher",
  tributeCardSelection: "fair-random",
  returnCardSelection: "recipient-choice",
  tributeRecipientPairing: "adjacent-first-automatic",
  matchEnding: "no-failure-limit-at-5",
};

export const FOUR_PLAYER_CONFIGURATION: FourPlayerRulesConfiguration = {
  rulesetId: "dglz-4p-2d-v1",
  wildcardRank: "strongest-rank",
  finishingWildcardInterpretation: "weakest-form-and-rank",
  flushTieBreaking: "descending-ranks",
  nextHandLeader: "first-finisher",
  tributeCardSelection: "fair-random",
  tributeRecipientPairing: "adjacent-first-automatic",
  matchEnding: "no-failure-limit-at-5",
};

export function fold(
  state: State | undefined,
  events: readonly Event[],
): State {
  let next = state;
  for (const event of events) next = evolve(next, event);
  if (next === undefined) throw new Error("Event fold produced no state");
  return next;
}

export function apply(state: State, command: Command) {
  const decision = decide(state, command);
  expect(decision.ok).toBe(true);
  if (!decision.ok) throw new Error(decision.rejection.reason);
  return { state: fold(state, decision.events), events: decision.events };
}

export function startMatch(
  configuration: RulesConfiguration,
  handSeed: string,
  roomId: string,
) {
  const playerIds = Array.from(
    { length: RULESET_DEFINITIONS[configuration.rulesetId].playerCount },
    (_, index) => `p${index + 1}`,
  );
  const created: Event = {
    type: "RoomCreated",
    roomId,
    ownerId: "p1",
    rulesConfiguration: configuration,
    seatingPolicy: "fixed",
  };
  const history: Event[] = [created];
  let state = evolve(undefined, created);
  function execute(command: Command) {
    const result = apply(state, command);
    history.push(...result.events);
    state = result.state;
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
    handSeed,
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
  });
  return { state, history, playerIds };
}

export function playFirstHand(state: State, history: Event[]): State {
  let next = state;
  for (let step = 0; step < 1500; step += 1) {
    const current = derivePlayerView(next, "p1");
    if (current.handResult !== undefined) return next;
    const actor = current.currentActor;
    if (actor === undefined) throw new Error("Missing current actor");
    const actorView = derivePlayerView(next, actor);
    const card =
      current.unbeatenPlay === undefined
        ? actorView.hand?.[0]
        : actorView.hand?.find(
            (candidate) =>
              decide(next, {
                type: "Play",
                playerId: actor,
                cards: [candidate],
              }).ok,
          );
    const result = apply(
      next,
      card === undefined
        ? { type: "Pass", playerId: actor }
        : { type: "Play", playerId: actor, cards: [card] },
    );
    history.push(...result.events);
    next = result.state;
  }
  throw new Error("First Hand did not finish");
}

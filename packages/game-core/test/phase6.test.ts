import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { RulesConfiguration } from "@dglz/game-rules";
import {
  decide,
  derivePlayerView,
  evolve,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type Event,
  type PlayerView,
  type State,
  type TieChoiceCandidate,
} from "../src/index.js";

const SIX_PLAYER_CONFIGURATION: RulesConfiguration = {
  rulesetId: "dglz-6p-3d-v1",
  jokerPairComparison: "two-small-and-mixed-are-equal",
  wildcardRank: "strongest-rank",
  finishingWildcardInterpretation: "weakest-form-and-rank",
  flushTieBreaking: "descending-ranks",
  nextHandLeader: "first-finisher",
  tributeCardSelection: "fair-random",
  returnCardSelection: "recipient-choice",
  tributeRecipientPairing: "finish-position-by-tribute-rank",
  matchEnding: "no-failure-limit-at-5",
};

const LEADER_TIE_CONFIGURATION: RulesConfiguration = {
  ...SIX_PLAYER_CONFIGURATION,
  nextHandLeader: "highest-tribute",
  tributeRecipientPairing: "adjacent-first-automatic",
  tributeCardSelection: "giver-choice",
};

const THREE_WAY_LEADER_TIE_CONFIGURATION: RulesConfiguration = {
  ...SIX_PLAYER_CONFIGURATION,
  nextHandLeader: "highest-tribute",
  tributeRecipientPairing: "adjacent-first-automatic",
};

const FOUR_PLAYER_CONFIGURATION: RulesConfiguration = {
  rulesetId: "dglz-4p-2d-v1",
  wildcardRank: "strongest-rank",
  finishingWildcardInterpretation: "weakest-form-and-rank",
  flushTieBreaking: "descending-ranks",
  nextHandLeader: "first-finisher",
  tributeCardSelection: "fair-random",
  tributeRecipientPairing: "finish-position-by-tribute-rank",
  matchEnding: "no-failure-limit-at-5",
};

function fold(state: State | undefined, events: readonly Event[]): State {
  let next = state;
  for (const event of events) next = evolve(next, event);
  if (next === undefined) throw new Error("Event fold produced no state");
  return next;
}

function apply(
  state: State,
  command: Parameters<typeof decide>[1],
): { state: State; events: readonly Event[] } {
  const decision = decide(state, command);
  expect(decision.ok).toBe(true);
  if (!decision.ok) throw new Error(decision.rejection.reason);
  return { state: fold(state, decision.events), events: decision.events };
}

function applyRecorded(
  history: Event[],
  state: State,
  command: Parameters<typeof decide>[1],
): State {
  const result = apply(state, command);
  history.push(...result.events);
  return result.state;
}

function view(state: State, playerId = "p1"): PlayerView {
  return derivePlayerView(state, playerId);
}

function tieBallot(
  state: State,
  playerId: string,
  candidateId: TieChoiceCandidate,
) {
  const current = view(state, playerId);
  if (current.tieKind === undefined || current.tieRound === undefined) {
    throw new Error("Missing tie choice");
  }
  return {
    type: "SubmitTieChoiceBallot" as const,
    playerId,
    tieKind: current.tieKind,
    round: current.tieRound,
    candidateId,
  };
}

function submitTieRound(
  state: State,
  choices: readonly TieChoiceCandidate[],
): State {
  const voters = view(state).tieVoterIds ?? [];
  if (voters.length !== choices.length)
    throw new Error("Invalid ballot fixture");
  let next = state;
  for (let index = 0; index < voters.length; index += 1) {
    next = apply(next, tieBallot(next, voters[index]!, choices[index]!)).state;
  }
  return next;
}

function readyMatch(
  configuration: RulesConfiguration,
  initialSeed: string,
): { state: State; history: Event[] } {
  const playerCount = configuration.rulesetId === "dglz-6p-3d-v1" ? 6 : 4;
  const created: Event = {
    type: "RoomCreated",
    roomId: "phase-6-room",
    ownerId: "p1",
    rulesConfiguration: configuration,
    seatingPolicy: "fixed",
  };
  const history: Event[] = [created];
  let state = evolve(undefined, created);
  for (let index = 2; index <= playerCount; index += 1) {
    const joined = apply(state, { type: "JoinRoom", playerId: `p${index}` });
    history.push(...joined.events);
    state = joined.state;
  }
  for (let seatIndex = 0; seatIndex < playerCount; seatIndex += 1) {
    const playerId = `p${seatIndex + 1}`;
    let result = apply(state, { type: "AssignSeat", playerId, seatIndex });
    history.push(...result.events);
    state = result.state;
    result = apply(state, { type: "SetReadiness", playerId, ready: true });
    history.push(...result.events);
    state = result.state;
  }
  let result = apply(state, { type: "SelectMatch", playerId: "p1" });
  history.push(...result.events);
  state = result.state;
  result = apply(state, {
    type: "StartMatch",
    handSeed: initialSeed,
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
  });
  history.push(...result.events);
  return { state: result.state, history };
}

function playFirstHand(state: State, history: Event[]): State {
  let next = state;
  for (let step = 0; step < 1500; step += 1) {
    const current = view(next);
    if (current.handResult !== undefined) return next;
    const actor = current.currentActor;
    if (actor === undefined) throw new Error("Missing current actor");
    const actorView = view(next, actor);
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

function startInitialHand(
  configuration: RulesConfiguration,
  initialSeed: string,
): { state: State; history: Event[] } {
  const started = readyMatch(configuration, initialSeed);
  started.state = playFirstHand(started.state, started.history);
  return started;
}

function startNextHand(state: State, handSeed: string): State {
  return apply(state, {
    type: "StartNextHand",
    handSeed,
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
  }).state;
}

function finishReturns(state: State, history?: Event[]): State {
  let next = state;
  for (let step = 0; step < 20; step += 1) {
    if (view(next).setupStage === "play") return next;
    const current = view(next);
    expect(current.setupStage).toBe("return-card-selection");
    const actor = current.pendingPlayerIds?.[0];
    if (actor === undefined) throw new Error("Missing Return Card actor");
    const card = view(next, actor).hand?.[0];
    if (card === undefined) throw new Error("Missing Return Card");
    const result = apply(next, {
      type: "SelectReturnCard",
      playerId: actor,
      card,
    });
    history?.push(...result.events);
    next = result.state;
  }
  throw new Error("Returns did not finish");
}

function reachThreeWayLeaderTie(): State {
  const first = startInitialHand(
    THREE_WAY_LEADER_TIE_CONFIGURATION,
    "phase-5-singleton-tie-initial-36",
  );
  let state = startNextHand(first.state, "phase-6-triple-27");
  for (let step = 0; step < 20; step += 1) {
    const current = view(state);
    if (current.setupStage === "leader-selection-tie") return state;
    if (current.setupStage !== "return-card-selection") {
      throw new Error(`Unexpected setup stage: ${current.setupStage}`);
    }
    const actor = current.pendingPlayerIds?.[0];
    if (actor === undefined) throw new Error("Missing Return Card actor");
    state = apply(state, {
      type: "SelectReturnCard",
      playerId: actor,
      card: view(state, actor).hand![0]!,
    }).state;
  }
  throw new Error("Leader tie not reached");
}

describe("game-core tie-choice protocol", () => {
  it("keeps recipient ballots private, resolves collisions, and replays", () => {
    const first = startInitialHand(
      SIX_PLAYER_CONFIGURATION,
      "phase-5-singleton-tie-initial-36",
    );
    const started = apply(first.state, {
      type: "StartNextHand",
      handSeed: "phase-5-singleton-tie-2",
      randomnessVersion: RANDOMNESS_VERSION,
      shuffleVersion: SHUFFLE_VERSION,
    });
    let state = started.state;
    const history = [...first.history, ...started.events];
    expect(view(state).setupStage).toBe("recipient-pairing-tie");
    expect(view(state).tributeTransfers).toHaveLength(1);
    const voters = view(state).tieVoterIds!;
    const candidates = view(state).tieCandidateIds!;
    expect(voters.length).toBeGreaterThan(1);
    expect(candidates.length).toBe(voters.length);

    const firstVoter = voters[0]!;
    const secondVoter = voters[1]!;
    const firstBallot = tieBallot(state, firstVoter, candidates[0]!);
    state = applyRecorded(history, state, firstBallot);
    expect(view(state, firstVoter).tieOwnBallot).toBe(candidates[0]);
    expect(view(state, secondVoter).tieOwnBallot).toBeUndefined();
    expect(view(state, "p1").tieSubmittedPlayerIds).toEqual([firstVoter]);
    expect(decide(state, firstBallot)).toEqual({
      ok: false,
      rejection: { reason: "tie-choice-duplicate" },
    });
    state = applyRecorded(
      history,
      state,
      tieBallot(state, secondVoter, candidates[0]!),
    );
    expect(view(state).setupStage).toBe("recipient-pairing-tie");
    expect(view(state).tieRound).toBe(2);
    expect(view(state).tieResolvedRounds?.[0]?.ballots).toEqual([
      { voterId: firstVoter, candidateId: candidates[0] },
      { voterId: secondVoter, candidateId: candidates[0] },
    ]);
    expect(decide(state, firstBallot)).toEqual({
      ok: false,
      rejection: { reason: "tie-choice-stale" },
    });

    const roundTwo = view(state);
    for (const [index, voter] of (roundTwo.tieVoterIds ?? []).entries()) {
      state = applyRecorded(
        history,
        state,
        tieBallot(state, voter, roundTwo.tieCandidateIds![index]!),
      );
    }
    state = finishReturns(state, history);
    expect(view(state).setupStage).toBe("play");
    expect(view(state).tributeTransfers).toHaveLength(3);
    const replayed = fold(undefined, history);
    expect(view(replayed)).toEqual(view(state));
  });

  it("rejects invalid voters, candidates, and stale tie rounds", () => {
    const first = startInitialHand(
      SIX_PLAYER_CONFIGURATION,
      "phase-5-singleton-tie-initial-36",
    );
    const state = startNextHand(first.state, "phase-6-triple-27");
    const current = view(state);
    const voter = current.tieVoterIds![0]!;
    const candidate = current.tieCandidateIds![0]!;
    const ballot = tieBallot(state, voter, candidate);

    expect(decide(state, { ...ballot, playerId: "not-a-member" })).toEqual({
      ok: false,
      rejection: { reason: "not-a-member" },
    });
    expect(
      decide(state, { ...ballot, playerId: current.tieCandidateIds![0]! }),
    ).toEqual({
      ok: false,
      rejection: { reason: "not-pending-setup-actor" },
    });
    expect(
      decide(state, { ...ballot, candidateId: "not-a-candidate" }),
    ).toEqual({
      ok: false,
      rejection: { reason: "tie-choice-not-eligible" },
    });
    expect(decide(state, { ...ballot, round: ballot.round + 1 })).toEqual({
      ok: false,
      rejection: { reason: "tie-choice-stale" },
    });
  });

  it("commits the 2–1–0 recipient pair and automatically pairs a sole remainder", () => {
    const first = startInitialHand(
      SIX_PLAYER_CONFIGURATION,
      "phase-5-singleton-tie-initial-36",
    );
    let state = startNextHand(first.state, "phase-6-triple-27");
    const firstRound = view(state);
    const voters = firstRound.tieVoterIds!;
    const candidates = firstRound.tieCandidateIds!;
    expect(voters).toHaveLength(3);

    state = submitTieRound(state, [
      candidates[0]!,
      candidates[0]!,
      candidates[1]!,
    ]);
    expect(view(state).tieRound).toBe(2);
    expect(view(state).tieVoterIds).toEqual([voters[0], voters[1]]);
    expect(view(state).tieCandidateIds).toEqual([candidates[0], candidates[2]]);
    expect(view(state).tieResolvedRounds?.[0]?.committedPairs).toMatchObject([
      { giverId: voters[2], recipientId: candidates[1] },
    ]);
    expect(view(state).tributeTransfers).toHaveLength(1);

    state = submitTieRound(state, [candidates[0]!, null]);
    expect(view(state).setupStage).toBe("return-card-selection");
    expect(view(state).tributeTransfers).toHaveLength(3);
    expect(view(state).tieResolvedRounds?.at(-1)?.committedPairs).toMatchObject(
      [
        { giverId: voters[0], recipientId: candidates[0] },
        { giverId: voters[1], recipientId: candidates[2] },
      ],
    );
  });

  it("resolves four-player pairing ties without losing Card Instances", () => {
    const first = startInitialHand(
      FOUR_PLAYER_CONFIGURATION,
      "phase-6-four-initial-0",
    );
    let state = startNextHand(first.state, "phase-6-four-next-0");
    const candidates = view(state).tieCandidateIds!;
    expect(view(state).tieVoterIds).toHaveLength(2);

    state = submitTieRound(state, candidates);
    expect(view(state).setupStage).toBe("return-card-selection");
    const cards = ["p1", "p2", "p3", "p4"].flatMap(
      (playerId) => view(state, playerId).hand ?? [],
    );
    expect(cards).toHaveLength(108);
    expect(new Set(cards).size).toBe(108);
    expect(view(finishReturns(state)).setupStage).toBe("play");
  });

  it("uses the three-round adjacent fallback for recipient pairing", () => {
    const first = startInitialHand(
      SIX_PLAYER_CONFIGURATION,
      "phase-5-singleton-tie-initial-36",
    );
    let state = startNextHand(first.state, "phase-5-singleton-tie-2");
    for (let round = 1; round <= 3; round += 1) {
      const current = view(state);
      for (const voter of current.pendingPlayerIds ?? []) {
        state = apply(state, tieBallot(state, voter, null)).state;
      }
    }
    expect(view(state).setupStage).not.toBe("recipient-pairing-tie");
    expect(view(state).tieResolvedRounds?.at(-1)?.fallback).toBe(true);
    expect(view(state).tributeTransfers?.length).toBeGreaterThan(1);
    expect(view(finishReturns(state)).setupStage).toBe("play");
  });

  it("resolves a leader plurality and keeps its ballots public after replay", () => {
    const first = startInitialHand(
      LEADER_TIE_CONFIGURATION,
      "phase-5-leader-tie-initial-1",
    );
    let state = startNextHand(first.state, "phase-5-leader-tie-2");
    for (let step = 0; step < 30; step += 1) {
      const current = view(state);
      if (current.setupStage === "leader-selection-tie") break;
      if (current.setupStage === "return-card-selection") {
        const actor = current.pendingPlayerIds?.[0];
        if (actor === undefined) throw new Error("Missing Return actor");
        const card = view(state, actor).hand?.[0];
        if (card === undefined) throw new Error("Missing Return card");
        state = apply(state, {
          type: "SelectReturnCard",
          playerId: actor,
          card,
        }).state;
      } else {
        const actor = current.pendingPlayerIds?.[0];
        if (actor === undefined) throw new Error("Missing Tribute actor");
        state = apply(state, {
          type: "SelectTributeCard",
          playerId: actor,
          card: view(state, actor).eligibleTributeCards![0]!,
        }).state;
      }
    }
    expect(view(state).setupStage).toBe("leader-selection-tie");
    const tie = view(state);
    const voters = tie.tieVoterIds!;
    const winner = tie.tieCandidateIds![0]!;
    for (const voter of voters) {
      state = apply(state, tieBallot(state, voter, winner)).state;
    }
    expect(view(state).setupStage).toBe("play");
    expect(view(state).currentActor).toBe(winner);
    expect(view(state).tieResolvedRounds?.at(-1)?.selectedLeaderId).toBe(
      winner,
    );
  });

  it("narrows leader candidates while retaining every original voter", () => {
    let state = reachThreeWayLeaderTie();
    const firstRound = view(state);
    const voters = firstRound.tieVoterIds!;
    const candidates = firstRound.tieCandidateIds!;
    expect(voters).toHaveLength(3);

    state = submitTieRound(state, [candidates[0]!, candidates[1]!, null]);
    expect(view(state).tieRound).toBe(2);
    expect(view(state).tieVoterIds).toEqual(voters);
    expect(view(state).tieCandidateIds).toEqual([candidates[0], candidates[1]]);

    state = submitTieRound(state, [
      candidates[0]!,
      candidates[0]!,
      candidates[1]!,
    ]);
    expect(view(state).setupStage).toBe("play");
    expect(view(state).currentActor).toBe(candidates[0]);
  });

  it("limits round-three leader fallback to that round's highest candidates", () => {
    let state = reachThreeWayLeaderTie();
    const candidates = view(state).tieCandidateIds!;
    state = submitTieRound(state, [null, null, null]);
    state = submitTieRound(state, [null, null, null]);
    state = submitTieRound(state, [candidates[0]!, candidates[1]!, null]);

    const resolution = view(state).tieResolvedRounds?.at(-1);
    expect(resolution?.fallback).toBe(true);
    expect(resolution?.remainingCandidateIds).toEqual([
      candidates[0],
      candidates[1],
    ]);
    expect([candidates[0], candidates[1]]).toContain(
      resolution?.selectedLeaderId,
    );
  });

  it("uses the seeded leader fallback after three all-give-up rounds", () => {
    const first = startInitialHand(
      LEADER_TIE_CONFIGURATION,
      "phase-5-leader-tie-initial-1",
    );
    let state = startNextHand(first.state, "phase-5-leader-tie-2");
    for (let step = 0; step < 30; step += 1) {
      const current = view(state);
      if (current.setupStage === "leader-selection-tie") break;
      if (current.setupStage === "return-card-selection") {
        const actor = current.pendingPlayerIds?.[0];
        if (actor === undefined) throw new Error("Missing Return actor");
        state = apply(state, {
          type: "SelectReturnCard",
          playerId: actor,
          card: view(state, actor).hand![0]!,
        }).state;
      } else {
        const actor = current.pendingPlayerIds?.[0];
        if (actor === undefined) throw new Error("Missing Tribute actor");
        state = apply(state, {
          type: "SelectTributeCard",
          playerId: actor,
          card: view(state, actor).eligibleTributeCards![0]!,
        }).state;
      }
    }
    for (let round = 1; round <= 3; round += 1) {
      for (const voter of view(state).pendingPlayerIds ?? []) {
        state = apply(state, tieBallot(state, voter, null)).state;
      }
    }
    const finalView = view(state);
    expect(finalView.setupStage).toBe("play");
    expect(finalView.tieResolvedRounds?.at(-1)?.fallback).toBe(true);
    expect(finalView.currentActor).toBe(
      finalView.tieResolvedRounds?.at(-1)?.selectedLeaderId,
    );
  });

  it("keeps seeded leader fallback independent of ballot submission order", () => {
    const initial = reachThreeWayLeaderTie();
    const voters = view(initial).tieVoterIds!;
    let canonical = initial;
    for (let round = 0; round < 3; round += 1) {
      canonical = submitTieRound(
        canonical,
        voters.map(() => null),
      );
    }
    const expected = view(canonical).currentActor;

    fc.assert(
      fc.property(
        fc.shuffledSubarray([...voters], {
          minLength: voters.length,
          maxLength: voters.length,
        }),
        (order) => {
          let state = initial;
          for (let round = 0; round < 3; round += 1) {
            for (const voter of order) {
              state = apply(state, tieBallot(state, voter, null)).state;
            }
          }
          expect(view(state).currentActor).toBe(expected);
        },
      ),
      { numRuns: 12 },
    );
  });
});

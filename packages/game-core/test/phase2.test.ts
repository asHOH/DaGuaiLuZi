import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  decide,
  derivePlayerView,
  deriveStartRequirements,
  evolve,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type Event,
  type State,
} from "../src/index.js";
import type { RulesConfiguration } from "@dglz/game-rules";

const SIX_PLAYER_CONFIGURATION: RulesConfiguration = {
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

const FOUR_PLAYER_CONFIGURATION: RulesConfiguration = {
  rulesetId: "dglz-4p-2d-v1",
  wildcardRank: "strongest-rank",
  finishingWildcardInterpretation: "weakest-form-and-rank",
  flushTieBreaking: "descending-ranks",
  nextHandLeader: "first-finisher",
  tributeCardSelection: "fair-random",
  tributeRecipientPairing: "adjacent-first-automatic",
  matchEnding: "no-failure-limit-at-5",
};

function readyLobby(
  rulesConfiguration: RulesConfiguration,
  seatingPolicy: "fixed" | "randomized" = "fixed",
  history?: Event[],
): State {
  const playerCount = rulesConfiguration.rulesetId === "dglz-6p-3d-v1" ? 6 : 4;
  const created: Event = {
    type: "RoomCreated",
    roomId: "room-2",
    ownerId: "p1",
    rulesConfiguration,
    seatingPolicy,
  };
  history?.push(created);
  let state = evolve(undefined, created);

  for (let index = 2; index <= playerCount; index += 1) {
    const playerId = `p${index}`;
    const joined = decide(state, { type: "JoinRoom", playerId });
    expect(joined.ok).toBe(true);
    if (joined.ok) {
      history?.push(...joined.events);
      for (const event of joined.events) state = evolve(state, event);
    }
  }

  for (let seatIndex = 0; seatIndex < playerCount; seatIndex += 1) {
    const playerId = `p${seatIndex + 1}`;
    for (const command of [
      { type: "AssignSeat", playerId, seatIndex } as const,
      { type: "SetReadiness", playerId, ready: true } as const,
    ]) {
      const decision = decide(state, command);
      expect(decision.ok).toBe(true);
      if (decision.ok) {
        history?.push(...decision.events);
        for (const event of decision.events) state = evolve(state, event);
      }
    }
  }

  const selected = decide(state, { type: "SelectMatch", playerId: "p1" });
  expect(selected.ok).toBe(true);
  if (selected.ok) {
    history?.push(...selected.events);
    for (const event of selected.events) state = evolve(state, event);
  }
  return state;
}

function start(state: State, handSeed: string, history?: Event[]) {
  const decision = decide(state, {
    type: "StartMatch",
    handSeed,
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
  });
  expect(decision.ok).toBe(true);
  if (!decision.ok) throw new Error(decision.rejection.reason);
  expect(decision.events).toHaveLength(1);
  const event = decision.events[0];
  if (event === undefined || event.type !== "MatchStarted") {
    throw new Error("Expected MatchStarted");
  }
  history?.push(event);
  return { event, state: evolve(state, event) };
}

describe("game-core deterministic Match start", () => {
  it.each([
    [SIX_PLAYER_CONFIGURATION, 6],
    [FOUR_PLAYER_CONFIGURATION, 4],
  ] as const)(
    "deals 27 cards to every %s player",
    (configuration, playerCount) => {
      const lobby = readyLobby(configuration);
      const { event, state } = start(lobby, "phase-2-seed");

      expect(event.rulesetId).toBe(configuration.rulesetId);
      expect(event.playerIds).toEqual(
        Array.from({ length: playerCount }, (_, index) => `p${index + 1}`),
      );
      expect(event.teamLevels).toEqual(["2", "2"]);
      expect(event.failureCounters).toEqual([0, 0]);
      expect(event.trumpRank).toBe("2");
      expect(event.dealerSeat).toBeGreaterThanOrEqual(0);
      expect(event.dealerSeat).toBeLessThan(playerCount);
      expect(event.dealerTeam).toBe(event.dealerSeat % 2);

      const view = derivePlayerView(state, "p1");
      expect(view.lifecycle).toBe("ACTIVE");
      expect(view.handSizes).toEqual(Array(playerCount).fill(27));
      expect(view.hand).toHaveLength(27);
      expect(view.failureCounters).toEqual([0, 0]);
      expect(view.matchRulesConfigurationLocked).toBe(true);
      expect(view.seatingPolicyLocked).toBe(true);
      expect(JSON.stringify(view)).not.toContain("phase-2-seed");

      const cards = Array.from({ length: playerCount }, (_, index) =>
        derivePlayerView(state, `p${index + 1}`),
      ).flatMap((playerView) => playerView.hand ?? []);
      expect(cards).toHaveLength(playerCount * 27);
      expect(new Set(cards).size).toBe(playerCount * 27);
    },
  );

  it("replays MatchStarted into the same active player view", () => {
    const history: Event[] = [];
    const lobby = readyLobby(SIX_PLAYER_CONFIGURATION, "randomized", history);
    const { state } = start(lobby, "replay-seed", history);
    let replayed: State | undefined;
    for (const event of history) replayed = evolve(replayed, event);

    for (let index = 1; index <= 6; index += 1) {
      expect(derivePlayerView(replayed!, `p${index}`)).toEqual(
        derivePlayerView(state, `p${index}`),
      );
    }
  });

  it.each([
    [
      "4p2d",
      FOUR_PLAYER_CONFIGURATION,
      ["p4", "p3", "p1", "p2"],
      ["4C#2", "5C#2", "6D#1", "JD#1", "AD#1"],
    ],
    [
      "6p3d",
      SIX_PLAYER_CONFIGURATION,
      ["p4", "p1", "p6", "p5", "p2", "p3"],
      ["8D#1", "10C#2", "KC#2", "KS#2", "BIG#1"],
    ],
  ] as const)(
    "pins the v1 seating, dealer, shuffle, and deal fixture for %s",
    (_name, configuration, playerIds, hand) => {
      const started = start(
        readyLobby(configuration, "randomized"),
        "phase-2-fixture",
      );

      expect(started.event.playerIds).toEqual(playerIds);
      expect(started.event.dealerSeat).toBe(2);
      expect(derivePlayerView(started.state, "p1").hand?.slice(0, 5)).toEqual(
        hand,
      );
    },
  );

  it("keeps dealer selection independent from seating policy", () => {
    const fixed = start(
      readyLobby(SIX_PLAYER_CONFIGURATION, "fixed"),
      "domain-separation-seed",
    );
    const randomized = start(
      readyLobby(SIX_PLAYER_CONFIGURATION, "randomized"),
      "domain-separation-seed",
    );

    expect(randomized.event.dealerSeat).toBe(fixed.event.dealerSeat);
    expect(randomized.event.playerIds).not.toEqual(fixed.event.playerIds);
    expect([...randomized.event.playerIds].sort()).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
    ]);
  });

  it("rejects starts before durable requirements and empty Hand Seeds", () => {
    const lobby = evolve(undefined, {
      type: "RoomCreated",
      roomId: "room-2",
      ownerId: "p1",
      rulesConfiguration: FOUR_PLAYER_CONFIGURATION,
      seatingPolicy: "fixed",
    });
    expect(
      decide(lobby, {
        type: "StartMatch",
        handSeed: "seed",
        randomnessVersion: RANDOMNESS_VERSION,
        shuffleVersion: SHUFFLE_VERSION,
      }),
    ).toEqual({
      ok: false,
      rejection: { reason: "start-requirements-not-met" },
    });

    const ready = readyLobby(FOUR_PLAYER_CONFIGURATION);
    expect(
      decide(ready, {
        type: "StartMatch",
        handSeed: "",
        randomnessVersion: RANDOMNESS_VERSION,
        shuffleVersion: SHUFFLE_VERSION,
      }),
    ).toEqual({
      ok: false,
      rejection: { reason: "invalid-hand-seed" },
    });
  });

  it("locks lobby mutations after the Match starts", () => {
    const { state } = start(readyLobby(FOUR_PLAYER_CONFIGURATION), "lock-seed");
    for (const command of [
      { type: "JoinRoom", playerId: "p5" } as const,
      { type: "LeaveRoom", playerId: "p1" } as const,
      { type: "AssignSeat", playerId: "p1", seatIndex: 1 } as const,
      { type: "RemoveSeat", playerId: "p1" } as const,
      { type: "SetReadiness", playerId: "p1", ready: false } as const,
      {
        type: "ReplaceMatchRulesConfiguration",
        playerId: "p1",
        rulesConfiguration: FOUR_PLAYER_CONFIGURATION,
      } as const,
      {
        type: "ReplaceSeatingPolicy",
        playerId: "p1",
        seatingPolicy: "randomized",
      } as const,
      { type: "SelectMatch", playerId: "p1" } as const,
    ]) {
      expect(decide(state, command)).toEqual({
        ok: false,
        rejection: { reason: "room-not-in-lobby" },
      });
    }
    expect(
      decide(state, {
        type: "StartMatch",
        handSeed: "another-seed",
        randomnessVersion: RANDOMNESS_VERSION,
        shuffleVersion: SHUFFLE_VERSION,
      }),
    ).toEqual({
      ok: false,
      rejection: { reason: "room-not-in-lobby" },
    });
    expect(deriveStartRequirements(state)).toBeUndefined();
  });

  it("reproduces every deal for generated seeds", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<RulesConfiguration>(
          FOUR_PLAYER_CONFIGURATION,
          SIX_PLAYER_CONFIGURATION,
        ),
        fc.string({ minLength: 1, maxLength: 32 }),
        (configuration, handSeed) => {
          const first = start(
            readyLobby(configuration, "randomized"),
            handSeed,
          );
          const second = start(
            readyLobby(configuration, "randomized"),
            handSeed,
          );
          const playerCount =
            configuration.rulesetId === "dglz-6p-3d-v1" ? 6 : 4;
          expect(first.event).toEqual(second.event);
          expect([...first.event.playerIds].sort()).toEqual(
            Array.from({ length: playerCount }, (_, index) => `p${index + 1}`),
          );
          expect(derivePlayerView(first.state, "p1")).toEqual(
            derivePlayerView(second.state, "p1"),
          );
        },
      ),
    );
  });
});

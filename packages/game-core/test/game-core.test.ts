import { describe, expect, it } from "vitest";

import {
  decide,
  derivePlayerView,
  deriveStartRequirements,
  evolve,
  type Command,
  type Event,
  type PlayerAccountId,
  type RoomCreated,
  type State,
} from "../src/index.js";
import type {
  FourPlayerRulesConfiguration,
  RulesConfiguration,
  SixPlayerRulesConfiguration,
} from "@dglz/game-rules";

const SIX_PLAYER_CONFIGURATION: SixPlayerRulesConfiguration = {
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

const FOUR_PLAYER_CONFIGURATION: FourPlayerRulesConfiguration = {
  rulesetId: "dglz-4p-2d-v1",
  wildcardRank: "strongest-rank",
  finishingWildcardInterpretation: "weakest-form-and-rank",
  flushTieBreaking: "descending-ranks",
  nextHandLeader: "first-finisher",
  tributeCardSelection: "fair-random",
  tributeRecipientPairing: "adjacent-first-automatic",
  matchEnding: "no-failure-limit-at-5",
};

function roomCreated(
  rulesConfiguration: RulesConfiguration = SIX_PLAYER_CONFIGURATION,
): RoomCreated {
  return {
    type: "RoomCreated",
    roomId: "room-1",
    ownerId: "p1",
    rulesConfiguration,
    seatingPolicy: "fixed",
  };
}

function decideAndFold(
  state: State,
  command: Command,
  history?: Event[],
): State {
  const decision = decide(state, command);
  expect(decision.ok).toBe(true);
  if (!decision.ok) {
    throw new Error(decision.rejection.reason);
  }

  let next = state;
  for (const event of decision.events) {
    history?.push(event);
    next = evolve(next, event);
  }
  return next;
}

function createSixPlayerLobby(): State {
  return evolve(undefined, roomCreated());
}

function createFourPlayerLobby(): State {
  return evolve(undefined, roomCreated(FOUR_PLAYER_CONFIGURATION));
}

describe("game-core lobby seam", () => {
  it("bootstraps an immutable opaque state and derives the complete lobby view", () => {
    const state = createSixPlayerLobby();

    expect(Object.isFrozen(state)).toBe(true);
    expect(derivePlayerView(state, "p1")).toEqual({
      roomId: "room-1",
      lifecycle: "LOBBY",
      ownerId: "p1",
      members: [{ playerId: "p1", joinOrder: 0, ready: false }],
      seats: [
        { seatIndex: 0, playerId: undefined },
        { seatIndex: 1, playerId: undefined },
        { seatIndex: 2, playerId: undefined },
        { seatIndex: 3, playerId: undefined },
        { seatIndex: 4, playerId: undefined },
        { seatIndex: 5, playerId: undefined },
      ],
      rulesConfiguration: SIX_PLAYER_CONFIGURATION,
      seatingPolicy: "fixed",
      selectedActivity: undefined,
    });
    expect(deriveStartRequirements(state)).toBeUndefined();
  });

  it("replays a complete four-player lobby to identical derivations", () => {
    const created = roomCreated(FOUR_PLAYER_CONFIGURATION);
    const history: Event[] = [created];
    let state = evolve(undefined, created);

    for (const playerId of ["p2", "p3", "p4"] as const) {
      state = decideAndFold(state, { type: "JoinRoom", playerId }, history);
    }
    for (const [seatIndex, playerId] of [
      [0, "p1"],
      [1, "p2"],
      [2, "p3"],
      [3, "p4"],
    ] as const) {
      state = decideAndFold(
        state,
        { type: "AssignSeat", playerId, seatIndex },
        history,
      );
      state = decideAndFold(
        state,
        { type: "SetReadiness", playerId, ready: true },
        history,
      );
    }
    state = decideAndFold(
      state,
      { type: "SelectMatch", playerId: "p1" },
      history,
    );

    let replayed: State | undefined;
    for (const event of history) {
      replayed = evolve(replayed, event);
    }
    expect(replayed).toBeDefined();
    expect(derivePlayerView(replayed!, "p3")).toEqual(
      derivePlayerView(state, "p3"),
    );
    expect(deriveStartRequirements(replayed!)).toEqual({
      playerIds: ["p1", "p2", "p3", "p4"],
    });
  });

  it("supports a complete six-player flow and folds its accepted events", () => {
    const created = roomCreated();
    const history: Event[] = [created];
    let state = evolve(undefined, created);
    const players: readonly PlayerAccountId[] = ["p2", "p3", "p4", "p5", "p6"];

    for (const playerId of players) {
      const decision = decide(state, { type: "JoinRoom", playerId });
      expect(decision.ok).toBe(true);
      if (!decision.ok) {
        continue;
      }
      expect(decision.events).toEqual([
        {
          type: "MemberJoined",
          playerId,
          joinOrder: Number(playerId.slice(1)) - 1,
        },
      ]);
      history.push(...decision.events);
      for (const event of decision.events) {
        state = evolve(state, event);
      }
    }

    for (const [seatIndex, playerId] of [
      [0, "p1"],
      [1, "p2"],
      [2, "p3"],
      [3, "p4"],
      [4, "p5"],
      [5, "p6"],
    ] as const) {
      state = decideAndFold(
        state,
        { type: "AssignSeat", playerId, seatIndex },
        history,
      );
      state = decideAndFold(
        state,
        { type: "SetReadiness", playerId, ready: true },
        history,
      );
    }

    state = decideAndFold(
      state,
      { type: "SelectMatch", playerId: "p1" },
      history,
    );
    expect(deriveStartRequirements(state)).toEqual({
      playerIds: ["p1", "p2", "p3", "p4", "p5", "p6"],
    });

    const view = derivePlayerView(state, "p4");
    expect(view.members.every((member) => member.ready)).toBe(true);
    expect(view.seats.map((seat) => seat.playerId)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
    ]);

    let replayed: State | undefined;
    for (const event of history) {
      replayed = evolve(replayed, event);
    }
    expect(derivePlayerView(replayed!, "p4")).toEqual(view);
    expect(deriveStartRequirements(replayed!)).toEqual(
      deriveStartRequirements(state),
    );
  });

  it("transfers ownership on departure and gives a rejoin a new join order", () => {
    let state = createFourPlayerLobby();
    state = decideAndFold(state, { type: "JoinRoom", playerId: "p2" });
    state = decideAndFold(state, { type: "JoinRoom", playerId: "p3" });

    const departure = decide(state, { type: "LeaveRoom", playerId: "p1" });
    expect(departure).toEqual({
      ok: true,
      events: [
        { type: "MemberLeft", playerId: "p1" },
        { type: "OwnerTransferred", ownerId: "p2" },
      ],
    });
    if (departure.ok) {
      for (const event of departure.events) {
        state = evolve(state, event);
      }
    }

    state = decideAndFold(state, { type: "JoinRoom", playerId: "p1" });
    expect(derivePlayerView(state, "p2").members).toEqual([
      { playerId: "p2", joinOrder: 1, ready: false },
      { playerId: "p3", joinOrder: 2, ready: false },
      { playerId: "p1", joinOrder: 3, ready: false },
    ]);
    expect(derivePlayerView(state, "p2").ownerId).toBe("p2");
  });

  it("handles both directions of Ruleset change", () => {
    let state = createFourPlayerLobby();
    for (const playerId of ["p2", "p3", "p4"] as const) {
      state = decideAndFold(state, { type: "JoinRoom", playerId });
    }
    for (const [seatIndex, playerId] of [
      [0, "p1"],
      [1, "p2"],
      [2, "p3"],
      [3, "p4"],
    ] as const) {
      state = decideAndFold(state, { type: "AssignSeat", playerId, seatIndex });
      state = decideAndFold(state, {
        type: "SetReadiness",
        playerId,
        ready: true,
      });
    }

    const up = decide(state, {
      type: "ReplaceMatchRulesConfiguration",
      playerId: "p1",
      rulesConfiguration: SIX_PLAYER_CONFIGURATION,
    });
    expect(up).toMatchObject({
      ok: true,
      events: [
        { type: "MatchRulesConfigurationReplaced" },
        { type: "ReadinessCleared" },
      ],
    });
    if (up.ok) {
      for (const event of up.events) {
        state = evolve(state, event);
      }
    }
    expect(
      derivePlayerView(state, "p1")
        .seats.slice(0, 4)
        .map((seat) => seat.playerId),
    ).toEqual(["p1", "p2", "p3", "p4"]);
    expect(
      derivePlayerView(state, "p1").members.every((member) => !member.ready),
    ).toBe(true);

    const downPreserving = decide(state, {
      type: "ReplaceMatchRulesConfiguration",
      playerId: "p1",
      rulesConfiguration: FOUR_PLAYER_CONFIGURATION,
    });
    expect(downPreserving).toMatchObject({
      ok: true,
      events: [
        { type: "MatchRulesConfigurationReplaced" },
        { type: "ReadinessCleared" },
      ],
    });
    if (downPreserving.ok) {
      for (const event of downPreserving.events) {
        state = evolve(state, event);
      }
    }
    expect(
      derivePlayerView(state, "p1").seats.map((seat) => seat.playerId),
    ).toEqual(["p1", "p2", "p3", "p4"]);

    state = decideAndFold(state, {
      type: "ReplaceMatchRulesConfiguration",
      playerId: "p1",
      rulesConfiguration: SIX_PLAYER_CONFIGURATION,
    });

    state = decideAndFold(state, {
      type: "AssignSeat",
      playerId: "p1",
      seatIndex: 4,
    });
    const down = decide(state, {
      type: "ReplaceMatchRulesConfiguration",
      playerId: "p1",
      rulesConfiguration: FOUR_PLAYER_CONFIGURATION,
    });
    expect(down).toEqual({
      ok: true,
      events: [
        {
          type: "MatchRulesConfigurationReplaced",
          rulesConfiguration: FOUR_PLAYER_CONFIGURATION,
        },
        { type: "ReadinessCleared" },
        { type: "SeatAssignmentsCleared" },
      ],
    });
    if (down.ok) {
      for (const event of down.events) {
        state = evolve(state, event);
      }
    }
    const downView = derivePlayerView(state, "p1");
    expect(downView.seats.every((seat) => seat.playerId === undefined)).toBe(
      true,
    );
    expect(downView.members.every((member) => !member.ready)).toBe(true);
  });

  it("moves seats atomically and keeps readiness when a seat is removed", () => {
    let state = createFourPlayerLobby();
    state = decideAndFold(state, {
      type: "AssignSeat",
      playerId: "p1",
      seatIndex: 0,
    });
    state = decideAndFold(state, {
      type: "SetReadiness",
      playerId: "p1",
      ready: true,
    });
    state = decideAndFold(state, {
      type: "AssignSeat",
      playerId: "p1",
      seatIndex: 1,
    });
    expect(
      derivePlayerView(state, "p1").seats.map((seat) => seat.playerId),
    ).toEqual([undefined, "p1", undefined, undefined]);

    state = decideAndFold(state, { type: "RemoveSeat", playerId: "p1" });
    const view = derivePlayerView(state, "p1");
    expect(view.seats.every((seat) => seat.playerId === undefined)).toBe(true);
    expect(view.members[0]?.ready).toBe(true);
    expect(deriveStartRequirements(state)).toBeUndefined();

    state = decideAndFold(state, {
      type: "SetReadiness",
      playerId: "p1",
      ready: false,
    });
    expect(derivePlayerView(state, "p1").members[0]?.ready).toBe(false);
  });

  it("lets the owner replace same-Ruleset configuration and seating policy", () => {
    let state = createFourPlayerLobby();
    state = decideAndFold(state, {
      type: "AssignSeat",
      playerId: "p1",
      seatIndex: 0,
    });
    state = decideAndFold(state, {
      type: "SetReadiness",
      playerId: "p1",
      ready: true,
    });
    state = decideAndFold(state, {
      type: "ReplaceMatchRulesConfiguration",
      playerId: "p1",
      rulesConfiguration: {
        ...FOUR_PLAYER_CONFIGURATION,
        wildcardRank: "weakest-rank",
      },
    });
    state = decideAndFold(state, {
      type: "ReplaceSeatingPolicy",
      playerId: "p1",
      seatingPolicy: "randomized",
    });

    const view = derivePlayerView(state, "p1");
    expect(view.members[0]?.ready).toBe(true);
    expect(view.rulesConfiguration.wildcardRank).toBe("weakest-rank");
    expect(view.seatingPolicy).toBe("randomized");
  });

  it("rejects invalid authority, membership, capacity, and no-change commands", () => {
    let state = createFourPlayerLobby();
    expect(decide(state, { type: "LeaveRoom", playerId: "p1" })).toEqual({
      ok: false,
      rejection: { reason: "sole-owner-cannot-leave" },
    });
    expect(decide(state, { type: "JoinRoom", playerId: "p1" })).toEqual({
      ok: false,
      rejection: { reason: "already-a-member" },
    });
    expect(decide(state, { type: "SelectMatch", playerId: "p2" })).toEqual({
      ok: false,
      rejection: { reason: "not-a-member" },
    });
    expect(
      decide(state, {
        type: "ReplaceSeatingPolicy",
        playerId: "p1",
        seatingPolicy: "fixed",
      }),
    ).toEqual({
      ok: false,
      rejection: { reason: "seating-policy-unchanged" },
    });
    expect(
      decide(state, { type: "AssignSeat", playerId: "p1", seatIndex: 4 }),
    ).toEqual({
      ok: false,
      rejection: { reason: "invalid-seat-index" },
    });
    expect(
      decide(state, { type: "SetReadiness", playerId: "p1", ready: true }),
    ).toEqual({
      ok: false,
      rejection: { reason: "member-must-be-seated" },
    });

    state = decideAndFold(state, {
      type: "AssignSeat",
      playerId: "p1",
      seatIndex: 0,
    });
    expect(
      decide(state, { type: "AssignSeat", playerId: "p1", seatIndex: 0 }),
    ).toEqual({
      ok: false,
      rejection: { reason: "seat-unchanged" },
    });

    state = decideAndFold(state, { type: "JoinRoom", playerId: "p2" });
    expect(
      decide(state, { type: "AssignSeat", playerId: "p2", seatIndex: 0 }),
    ).toEqual({
      ok: false,
      rejection: { reason: "seat-occupied" },
    });
    expect(decide(state, { type: "SelectMatch", playerId: "p2" })).toEqual({
      ok: false,
      rejection: { reason: "owner-only" },
    });
    expect(
      decide(state, {
        type: "ReplaceMatchRulesConfiguration",
        playerId: "p1",
        rulesConfiguration: FOUR_PLAYER_CONFIGURATION,
      }),
    ).toEqual({
      ok: false,
      rejection: { reason: "rules-configuration-unchanged" },
    });

    for (const playerId of ["p3", "p4"] as const) {
      state = decideAndFold(state, { type: "JoinRoom", playerId });
    }
    expect(decide(state, { type: "JoinRoom", playerId: "p5" })).toEqual({
      ok: false,
      rejection: { reason: "membership-capacity-reached" },
    });

    state = decideAndFold(state, {
      type: "ReplaceMatchRulesConfiguration",
      playerId: "p1",
      rulesConfiguration: SIX_PLAYER_CONFIGURATION,
    });
    state = decideAndFold(state, { type: "JoinRoom", playerId: "p5" });
    expect(
      decide(state, {
        type: "ReplaceMatchRulesConfiguration",
        playerId: "p1",
        rulesConfiguration: FOUR_PLAYER_CONFIGURATION,
      }),
    ).toEqual({
      ok: false,
      rejection: { reason: "ruleset-change-would-exceed-capacity" },
    });

    state = decideAndFold(state, { type: "SelectMatch", playerId: "p1" });
    expect(decide(state, { type: "SelectMatch", playerId: "p1" })).toEqual({
      ok: false,
      rejection: { reason: "match-already-selected" },
    });
  });
});

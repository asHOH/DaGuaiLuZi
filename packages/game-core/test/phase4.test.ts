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

function playerCount(configuration: RulesConfiguration): number {
  return configuration.rulesetId === "dglz-6p-3d-v1" ? 6 : 4;
}

function fold(state: State | undefined, events: readonly Event[]): State {
  let next = state;
  for (const event of events) next = evolve(next, event);
  if (next === undefined) throw new Error("Event fold produced no state");
  return next;
}

function readyLobby(configuration: RulesConfiguration): {
  state: State;
  history: Event[];
} {
  const count = playerCount(configuration);
  const created: Event = {
    type: "RoomCreated",
    roomId: "phase-4-room",
    ownerId: "p1",
    rulesConfiguration: configuration,
    seatingPolicy: "fixed",
  };
  const history: Event[] = [created];
  let state = evolve(undefined, created);

  for (let index = 2; index <= count; index += 1) {
    const events = acceptedEvents(state, {
      type: "JoinRoom",
      playerId: `p${index}`,
    });
    history.push(...events);
    state = fold(state, events);
  }
  for (let seatIndex = 0; seatIndex < count; seatIndex += 1) {
    const playerId = `p${seatIndex + 1}`;
    const seatEvents = acceptedEvents(state, {
      type: "AssignSeat",
      playerId,
      seatIndex,
    });
    history.push(...seatEvents);
    state = fold(state, seatEvents);
    const readyEvents = acceptedEvents(state, {
      type: "SetReadiness",
      playerId,
      ready: true,
    });
    history.push(...readyEvents);
    state = fold(state, readyEvents);
  }
  const selectedEvents = acceptedEvents(state, {
    type: "SelectMatch",
    playerId: "p1",
  });
  history.push(...selectedEvents);
  return { state: fold(state, selectedEvents), history };
}

function acceptedEvents(
  state: State,
  command: Parameters<typeof decide>[1],
): readonly Event[] {
  const decision = decide(state, command);
  expect(decision.ok).toBe(true);
  if (!decision.ok) throw new Error(decision.rejection.reason);
  return decision.events;
}

function start(configuration: RulesConfiguration, handSeed: string) {
  const lobby = readyLobby(configuration);
  const decision = decide(lobby.state, {
    type: "StartMatch",
    handSeed,
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
  });
  expect(decision.ok).toBe(true);
  if (!decision.ok) throw new Error(decision.rejection.reason);
  return {
    state: fold(lobby.state, decision.events),
    history: [...lobby.history, ...decision.events],
    playerIds: Array.from(
      { length: playerCount(configuration) },
      (_, index) => `p${index + 1}`,
    ),
  };
}

function replaceMatchStartContext(
  started: ReturnType<typeof start>,
  teamLevels: ["2" | "3" | "4" | "5", "2" | "3" | "4" | "5"],
  failureCounters: [number, number],
): ReturnType<typeof start> {
  const dealerTeam = view(started.state).dealerTeam!;
  const history = started.history.map((event): Event =>
    event.type === "MatchStarted"
      ? {
          ...event,
          teamLevels,
          trumpRank: teamLevels[dealerTeam],
          failureCounters,
        }
      : event,
  );
  return { ...started, history, state: fold(undefined, history) };
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

function view(state: State, playerId = "p1"): PlayerView {
  return derivePlayerView(state, playerId);
}

function playHand(state: State, history: Event[]): State {
  let next = state;
  for (let step = 0; step < 1200; step += 1) {
    if (
      view(next).lifecycle !== "ACTIVE" ||
      view(next).handResult !== undefined
    )
      return next;
    const actor = view(next).currentActor;
    if (actor === undefined) throw new Error("Missing current actor");
    const actorView = view(next, actor);
    const candidate =
      view(next).unbeatenPlay === undefined
        ? actorView.hand?.[0]
        : actorView.hand?.find(
            (card) =>
              decide(next, { type: "Play", playerId: actor, cards: [card] }).ok,
          );
    const applied = apply(
      next,
      candidate === undefined
        ? { type: "Pass", playerId: actor }
        : { type: "Play", playerId: actor, cards: [candidate] },
    );
    history.push(...applied.events);
    next = applied.state;
  }
  throw new Error("Hand did not finish");
}

function injectHandContext(
  state: State,
  handNumber: number,
  dealerTeam: 0 | 1,
  teamLevels: ["2" | "3" | "4" | "5" | "6", "2" | "3" | "4" | "5" | "6"],
  failureCounters: [number, number],
): State {
  return evolve(state, {
    type: "HandSettled",
    handNumber,
    dealerTeam,
    teamLevels,
    failureCounters,
  });
}

function prepareFinisher(
  state: State,
  targetTeam: 0 | 1,
  preserveTeammate: boolean,
): { state: State; history: Event[]; targetSeat: number } {
  const initial = view(state);
  const targetSeat = initial.seats.find(
    (seat) => seat.playerId !== undefined && seat.seatIndex % 2 === targetTeam,
  )?.seatIndex;
  if (targetSeat === undefined) throw new Error("Missing target seat");
  const teammateSeat = initial.seats.find(
    (seat) =>
      seat.playerId !== undefined &&
      seat.seatIndex % 2 === targetTeam &&
      seat.seatIndex !== targetSeat,
  )?.seatIndex;
  const keepSeats = new Set<number>([targetSeat]);
  if (preserveTeammate && teammateSeat !== undefined) {
    keepSeats.add(teammateSeat);
  }

  const history: Event[] = [];
  let next = state;
  for (const seat of initial.seats) {
    if (seat.playerId === undefined) continue;
    const keep = keepSeats.has(seat.seatIndex)
      ? view(next, seat.playerId).hand?.[0]
      : undefined;
    for (const card of view(next, seat.playerId).hand ?? []) {
      if (card === keep) continue;
      const event = {
        type: "CardsPlayed",
        playerId: seat.playerId,
        seatIndex: seat.seatIndex,
        cards: [card],
        form: "single",
        rank: "2",
        representedFaces: ["2S"],
        comparisonRanks: ["2"],
      } satisfies Event;
      history.push(event);
      next = evolve(next, event);
    }
  }
  const reset = { type: "LeadReset", seatIndex: targetSeat } satisfies Event;
  history.push(reset);
  return { state: evolve(next, reset), history, targetSeat };
}

describe("game-core Match settlement", () => {
  it.each([FOUR_PLAYER_CONFIGURATION, SIX_PLAYER_CONFIGURATION])(
    "settles a non-terminal Hand atomically for %s",
    (configuration) => {
      const started = start(configuration, "phase-4-settle");
      const initial = view(started.state);
      const state = playHand(started.state, started.history);
      const result = view(state).handResult;
      expect(result).toBeDefined();

      const resultIndex = started.history.findIndex(
        (event) => event.type === "HandResultDetermined",
      );
      const settledIndex = started.history.findIndex(
        (event) => event.type === "HandSettled",
      );
      expect(settledIndex).toBe(resultIndex + 1);
      expect(
        started.history.some((event) => event.type === "MatchCompleted"),
      ).toBe(false);

      const settled = started.history[settledIndex];
      expect(settled).toMatchObject({
        type: "HandSettled",
        handNumber: 1,
        dealerTeam: result?.nextDealerTeam,
        failureCounters: [0, 0],
      });
      expect(state).toBeDefined();
      expect(view(state).lifecycle).toBe("ACTIVE");
      expect(view(state).completedHandCount).toBe(1);
      expect(view(state).selectedActivity).toBe("match");
      expect(view(state).teamLevels).toEqual(
        result?.outcome === "win" && result.winningTeam === initial.dealerTeam
          ? initial.teamLevels?.map((level, team) =>
              team === initial.dealerTeam
                ? (
                    {
                      "2": "3",
                      "3": "4",
                      "4": "5",
                      "5": "6",
                      "6": "6",
                    } as const
                  )[level]
                : level,
            )
          : initial.teamLevels,
      );
      expect(
        decide(state, {
          type: "Pass",
          playerId: view(state).currentActor ?? "p1",
        }),
      ).toEqual({ ok: false, rejection: { reason: "hand-result-determined" } });

      let replayed: State | undefined;
      for (const event of started.history) replayed = evolve(replayed, event);
      for (const playerId of started.playerIds) {
        expect(view(replayed!, playerId)).toEqual(view(state, playerId));
      }
    },
  );

  it.each([FOUR_PLAYER_CONFIGURATION, SIX_PLAYER_CONFIGURATION])(
    "completes when the current Dealer Team wins at level 5 for %s",
    (configuration) => {
      const initial = start(configuration, "terminal-seed");
      const dealerTeam = view(initial.state).dealerTeam!;
      const started = replaceMatchStartContext(
        initial,
        dealerTeam === 0 ? ["5", "2"] : ["2", "5"],
        [0, 0],
      );
      const prepared = prepareFinisher(started.state, dealerTeam, false);
      const context: Event = {
        type: "HandSettled",
        handNumber: 7,
        dealerTeam,
        teamLevels: dealerTeam === 0 ? ["5", "2"] : ["2", "5"],
        failureCounters: [0, 0],
      };
      const history = [...started.history, ...prepared.history, context];
      const state = injectHandContext(
        prepared.state,
        7,
        dealerTeam,
        dealerTeam === 0 ? ["5", "2"] : ["2", "5"],
        [0, 0],
      );
      const lastCard = view(
        state,
        view(state).seats[prepared.targetSeat]!.playerId!,
      ).hand![0]!;
      const applied = apply(state, {
        type: "Play",
        playerId: view(state).seats[prepared.targetSeat]!.playerId!,
        cards: [lastCard],
      });
      history.push(...applied.events);
      const final = view(applied.state);
      expect(final.lifecycle).toBe("LOBBY");
      expect(final.selectedActivity).toBeUndefined();
      expect(final.completedHandCount).toBe(8);
      expect(final.matchSummary).toEqual({
        outcome: "completed",
        winningTeam: dealerTeam,
        endingReason: "team-level-6",
        teamLevels: dealerTeam === 0 ? ["6", "2"] : ["2", "6"],
        completedHandCount: 8,
      });
      expect(final.hand).toBeUndefined();
      expect(final.handSizes).toBeUndefined();
      expect(final.handResult).toBeUndefined();
      expect(final.currentActor).toBeUndefined();
      expect(final.teamLevels).toEqual(
        dealerTeam === 0 ? ["6", "2"] : ["2", "6"],
      );
      expect(final.members.every((member) => !member.ready)).toBe(true);
      expect(history.at(-2)?.type).toBe("HandSettled");
      expect(history.at(-1)).toMatchObject({
        type: "MatchCompleted",
        winningTeam: dealerTeam,
        endingReason: "team-level-6",
        completedHandCount: 8,
      });
      expect(
        decide(applied.state, { type: "AbortMatch", playerId: "p1" }),
      ).toEqual({ ok: false, rejection: { reason: "room-not-active" } });
      const replayed = fold(undefined, history);
      for (const playerId of started.playerIds) {
        expect(view(replayed, playerId)).toEqual(view(applied.state, playerId));
      }
    },
  );

  it("ends on the third failure at level 5 and isolates the counter", () => {
    const configuration: RulesConfiguration = {
      ...FOUR_PLAYER_CONFIGURATION,
      matchEnding: "three-failure-limit-at-5",
    };
    const initial = start(configuration, "failure-seed");
    const dealerTeam = view(initial.state).dealerTeam!;
    const teamLevels: ["5" | "2", "5" | "2"] =
      dealerTeam === 0 ? ["5", "2"] : ["2", "5"];
    const started = replaceMatchStartContext(
      initial,
      teamLevels,
      dealerTeam === 0 ? [2, 0] : [0, 2],
    );
    const prepared = prepareFinisher(
      started.state,
      (1 - dealerTeam) as 0 | 1,
      false,
    );
    const context: Event = {
      type: "HandSettled",
      handNumber: 2,
      dealerTeam,
      teamLevels,
      failureCounters: dealerTeam === 0 ? [2, 0] : [0, 2],
    };
    const history = [...started.history, ...prepared.history, context];
    const state = injectHandContext(
      prepared.state,
      2,
      dealerTeam,
      teamLevels,
      dealerTeam === 0 ? [2, 0] : [0, 2],
    );
    const targetPlayer = view(state).seats[prepared.targetSeat]!.playerId!;
    const applied = apply(state, {
      type: "Play",
      playerId: targetPlayer,
      cards: [view(state, targetPlayer).hand![0]!],
    });
    history.push(...applied.events);
    const final = view(applied.state);
    expect(final.lifecycle).toBe("LOBBY");
    expect(final.matchSummary).toMatchObject({
      outcome: "completed",
      winningTeam: 1 - dealerTeam,
      endingReason: "three-failure-limit-at-5",
    });
    expect(
      applied.events.find((event) => event.type === "HandSettled"),
    ).toMatchObject({
      failureCounters: dealerTeam === 0 ? [3, 0] : [0, 3],
    });
    expect(final.teamLevels).toEqual(
      dealerTeam === 0 ? ["5", "2"] : ["2", "5"],
    );
  });

  it.each([FOUR_PLAYER_CONFIGURATION, SIX_PLAYER_CONFIGURATION])(
    "records an unlimited level-5 failure without completing %s",
    (configuration) => {
      const initial = start(configuration, "unlimited-failure");
      const dealerTeam = view(initial.state).dealerTeam!;
      const teamLevels: ["5" | "2", "5" | "2"] =
        dealerTeam === 0 ? ["5", "2"] : ["2", "5"];
      const started = replaceMatchStartContext(initial, teamLevels, [0, 0]);
      const prepared = prepareFinisher(
        started.state,
        (1 - dealerTeam) as 0 | 1,
        false,
      );
      const targetPlayer = view(started.state).seats[prepared.targetSeat]!
        .playerId!;
      const applied = apply(prepared.state, {
        type: "Play",
        playerId: targetPlayer,
        cards: [view(prepared.state, targetPlayer).hand![0]!],
      });
      expect(view(applied.state).lifecycle).toBe("ACTIVE");
      expect(view(applied.state).teamLevels).toEqual(teamLevels);
      expect(view(applied.state).trumpRank).toBe("5");
      expect(
        applied.events.find((event) => event.type === "HandSettled"),
      ).toMatchObject({
        dealerTeam: 1 - dealerTeam,
        failureCounters: dealerTeam === 0 ? [1, 0] : [0, 1],
      });
      expect(
        decide(applied.state, { type: "AbortMatch", playerId: "p1" }).ok,
      ).toBe(true);
    },
  );

  it("counts a level-5 draw as a failure without advancing either team", () => {
    const initial = start(FOUR_PLAYER_CONFIGURATION, "draw-failure");
    const dealerTeam = view(initial.state).dealerTeam!;
    const teamLevels: ["5" | "2", "5" | "2"] =
      dealerTeam === 0 ? ["5", "2"] : ["2", "5"];
    const started = replaceMatchStartContext(initial, teamLevels, [0, 0]);
    const prepared = prepareFinisher(started.state, dealerTeam, true);
    const targetPlayer = view(started.state).seats[prepared.targetSeat]!
      .playerId!;
    const applied = apply(prepared.state, {
      type: "Play",
      playerId: targetPlayer,
      cards: [view(prepared.state, targetPlayer).hand![0]!],
    });
    expect(view(applied.state).handResult?.outcome).toBe("draw");
    expect(view(applied.state).teamLevels).toEqual(teamLevels);
    expect(
      applied.events.find((event) => event.type === "HandSettled"),
    ).toMatchObject({
      failureCounters: dealerTeam === 0 ? [1, 0] : [0, 1],
    });
  });

  it.each([FOUR_PLAYER_CONFIGURATION, SIX_PLAYER_CONFIGURATION])(
    "lets the owner abort an incomplete active Match and hides its Hand for %s",
    (configuration) => {
      const started = start(configuration, "abort-seed");
      expect(
        decide(started.state, { type: "AbortMatch", playerId: "p2" }),
      ).toEqual({ ok: false, rejection: { reason: "owner-only" } });

      const decision = decide(started.state, {
        type: "AbortMatch",
        playerId: "p1",
      });
      expect(decision.ok).toBe(true);
      if (!decision.ok) throw new Error(decision.rejection.reason);
      expect(decision.events).toEqual([
        { type: "MatchAborted", teamLevels: ["2", "2"], completedHandCount: 0 },
      ]);
      expect(Object.isFrozen(decision.events)).toBe(true);

      const state = fold(started.state, decision.events);
      const aborted = view(state);
      expect(aborted.lifecycle).toBe("LOBBY");
      expect(aborted.selectedActivity).toBeUndefined();
      expect(aborted.completedHandCount).toBe(0);
      expect(aborted.matchSummary).toEqual({
        outcome: "aborted",
        teamLevels: ["2", "2"],
        completedHandCount: 0,
      });
      expect(aborted.hand).toBeUndefined();
      expect(aborted.handSizes).toBeUndefined();
      expect(aborted.currentActor).toBeUndefined();
      expect(aborted.handResult).toBeUndefined();
      expect(aborted.members.every((member) => !member.ready)).toBe(true);
      expect(decide(state, { type: "AbortMatch", playerId: "p1" })).toEqual({
        ok: false,
        rejection: { reason: "room-not-active" },
      });
      const replayed = fold(undefined, [
        ...started.history,
        ...decision.events,
      ]);
      for (const playerId of started.playerIds) {
        expect(view(replayed, playerId)).toEqual(view(state, playerId));
      }
    },
  );

  it("preserves settlement invariants across generated first Hands", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<RulesConfiguration>(
          FOUR_PLAYER_CONFIGURATION,
          SIX_PLAYER_CONFIGURATION,
        ),
        fc.string({ minLength: 1, maxLength: 24 }),
        (configuration, handSeed) => {
          const started = start(configuration, handSeed);
          const final = playHand(started.state, started.history);
          const settled = started.history.filter(
            (event): event is Extract<Event, { type: "HandSettled" }> =>
              event.type === "HandSettled",
          );
          expect(settled).toHaveLength(1);
          expect(settled[0]?.handNumber).toBe(1);
          expect(view(final).completedHandCount).toBe(1);
          expect(view(final).lifecycle).toBe("ACTIVE");
          expect(view(final).matchSummary).toBeUndefined();
          const replayed = fold(undefined, started.history);
          expect(view(replayed)).toEqual(view(final));
        },
      ),
      { numRuns: 20 },
    );
  });
});

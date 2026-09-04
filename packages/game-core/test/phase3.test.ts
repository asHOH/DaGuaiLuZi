import fc from "fast-check";
import { describe, expect, it } from "vitest";

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
import {
  type CardInstanceCode,
  type RulesConfiguration,
} from "@dglz/game-rules";

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

function fold(state: State | undefined, events: readonly Event[]): State {
  let next = state;
  for (const event of events) next = evolve(next, event);
  return next as State;
}

function start(
  configuration: RulesConfiguration,
  handSeed = "phase-3-seed",
): {
  state: State;
  playerIds: readonly string[];
  history: Event[];
} {
  const playerCount = configuration.rulesetId === "dglz-6p-3d-v1" ? 6 : 4;
  const history: Event[] = [
    {
      type: "RoomCreated",
      roomId: "phase-3-room",
      ownerId: "p1",
      rulesConfiguration: configuration,
      seatingPolicy: "fixed",
    },
  ];
  let state = evolve(undefined, history[0]!);

  for (let index = 2; index <= playerCount; index += 1) {
    const decision = decide(state, { type: "JoinRoom", playerId: `p${index}` });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      history.push(...decision.events);
      state = fold(state, decision.events);
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
        history.push(...decision.events);
        state = fold(state, decision.events);
      }
    }
  }

  const selected = decide(state, { type: "SelectMatch", playerId: "p1" });
  expect(selected.ok).toBe(true);
  if (!selected.ok) throw new Error(selected.rejection.reason);
  state = fold(state, selected.events);
  history.push(...selected.events);
  const decision = decide(state, {
    type: "StartMatch",
    handSeed,
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
  });
  expect(decision.ok).toBe(true);
  if (!decision.ok) throw new Error(decision.rejection.reason);
  history.push(...decision.events);
  state = fold(state, decision.events);
  return {
    state,
    playerIds: Array.from(
      { length: playerCount },
      (_, index) => `p${index + 1}`,
    ),
    history,
  };
}

function apply(
  state: State,
  command: Parameters<typeof decide>[1],
): {
  state: State;
  events: readonly Event[];
} {
  const decision = decide(state, command);
  expect(decision.ok).toBe(true);
  if (!decision.ok) throw new Error(decision.rejection.reason);
  return { state: fold(state, decision.events), events: decision.events };
}

function playerView(state: State, playerId: string): PlayerView {
  return derivePlayerView(state, playerId);
}

function remainingCards(state: State, playerIds: readonly string[]): string[] {
  return playerIds.flatMap(
    (playerId) => playerView(state, playerId).hand ?? [],
  );
}

function passUntilOpenLead(state: State): State {
  let next = state;
  while (playerView(next, "p1").unbeatenPlay !== undefined) {
    const actor = playerView(next, "p1").currentActor;
    if (actor === undefined) throw new Error("Missing response actor");
    next = apply(next, { type: "Pass", playerId: actor }).state;
  }
  return next;
}

function drainCurrentLeader(state: State): State {
  const leader = playerView(state, "p1").currentActor;
  if (leader === undefined) throw new Error("Missing leader");

  let next = state;
  while (playerView(next, "p1").handResult === undefined) {
    const view = playerView(next, "p1");
    if (view.currentActor !== leader) return next;
    const card = playerView(next, leader).hand?.[0];
    if (card === undefined) return next;
    next = apply(next, { type: "Play", playerId: leader, cards: [card] }).state;
    if (playerView(next, "p1").handResult !== undefined) return next;
    next = passUntilOpenLead(next);
  }
  return next;
}

describe("game-core active Hand play", () => {
  it.each([SIX_PLAYER_CONFIGURATION, FOUR_PLAYER_CONFIGURATION])(
    "plays a complete first Hand for %s",
    (configuration) => {
      const started = start(configuration);
      let state = started.state;
      const history = [...started.history];
      const playerIds = started.playerIds;
      const initialCards = remainingCards(state, playerIds);

      for (let turn = 0; turn < 1000; turn += 1) {
        const view = playerView(state, "p1");
        if (view.handResult !== undefined) break;
        const actor = view.currentActor;
        if (actor === undefined) throw new Error("Missing active actor");
        const actorView = playerView(state, actor);
        expect(actorView.hand?.length).toBeGreaterThan(0);
        const candidate =
          view.unbeatenPlay === undefined
            ? actorView.hand?.[0]
            : actorView.hand?.find((card) => {
                const decision = decide(state, {
                  type: "Play",
                  playerId: actor,
                  cards: [card],
                });
                return decision.ok;
              });
        const command =
          candidate === undefined
            ? ({ type: "Pass", playerId: actor } as const)
            : ({ type: "Play", playerId: actor, cards: [candidate] } as const);
        const applied = apply(state, command);
        history.push(...applied.events);
        state = applied.state;

        const played = applied.events.filter(
          (event): event is Extract<Event, { type: "CardsPlayed" }> =>
            event.type === "CardsPlayed",
        );
        const remaining = remainingCards(state, playerIds);
        const playedCodes = history
          .filter(
            (event): event is Extract<Event, { type: "CardsPlayed" }> =>
              event.type === "CardsPlayed",
          )
          .flatMap((event) => event.cards);
        expect(playedCodes.length + remaining.length).toBe(initialCards.length);
        expect([...new Set([...playedCodes, ...remaining])].sort()).toEqual(
          [...initialCards].sort(),
        );
        expect(played.length).toBeLessThanOrEqual(1);
      }

      expect(playerView(state, "p1").handResult).toBeDefined();
      expect(
        history.some((event) => event.type === "HandResultDetermined"),
      ).toBe(true);

      let replayed: State | undefined;
      for (const event of history) replayed = evolve(replayed, event);
      for (const playerId of playerIds) {
        expect(playerView(replayed!, playerId)).toEqual(
          playerView(state, playerId),
        );
      }
    },
  );

  it("resets an ordinary response circuit and never records synthetic passes", () => {
    let state = start(FOUR_PLAYER_CONFIGURATION).state;
    const first = playerView(state, "p1");
    const actor = first.currentActor!;
    const leadCard = playerView(state, actor).hand!.find(
      (card) => !card.startsWith("SMALL") && !card.startsWith("BIG"),
    )!;
    state = apply(state, {
      type: "Play",
      playerId: actor,
      cards: [leadCard],
    }).state;
    const observer = actor === "p1" ? "p2" : "p1";
    const observerJson = JSON.stringify(playerView(state, observer));
    for (const privateCard of playerView(state, actor).hand ?? []) {
      expect(observerJson).not.toContain(`"${privateCard}"`);
    }

    for (let index = 0; index < 3; index += 1) {
      const view = playerView(state, "p1");
      const decision = apply(state, {
        type: "Pass",
        playerId: view.currentActor!,
      });
      state = decision.state;
      expect(decision.events.some((event) => event.type === "LeadReset")).toBe(
        index === 2,
      );
      expect(decision.events.at(-1)?.type).toBe(
        index === 2 ? "LeadReset" : "TurnAdvanced",
      );
      expect(decision.events[0]).toMatchObject({
        type: "PlayerPassed",
        playerId: view.currentActor,
        seatIndex: view.currentActorSeat,
      });
    }

    const view = playerView(state, "p1");
    expect(view.unbeatenPlay).toBeUndefined();
    expect(view.currentActor).toBe(actor);
    expect(view.passedPlayerIds).toEqual([]);
  });

  it("closes a BIG lead immediately without synthetic passes", () => {
    let scenario:
      | Readonly<{ state: State; actor: string; card: CardInstanceCode }>
      | undefined;
    for (let seed = 0; seed < 20 && scenario === undefined; seed += 1) {
      const state = start(FOUR_PLAYER_CONFIGURATION, `closure-${seed}`).state;
      const actor = playerView(state, "p1").currentActor!;
      const card = playerView(state, actor).hand?.find((code) =>
        code.startsWith("BIG"),
      );
      if (card !== undefined) scenario = { state, actor, card };
    }
    expect(scenario).toBeDefined();

    const played = apply(scenario!.state, {
      type: "Play",
      playerId: scenario!.actor,
      cards: [scenario!.card],
    });
    expect(played.events.map((event) => event.type)).toEqual([
      "CardsPlayed",
      "LeadReset",
    ]);
    expect(played.events.some((event) => event.type === "PlayerPassed")).toBe(
      false,
    );
    const view = playerView(played.state, "p1");
    expect(view.unbeatenPlay).toBeUndefined();
    expect(view.currentActor).toBe(scenario!.actor);
  });

  it("uses finishing wildcard interpretation for the actor's last cards", () => {
    const actor = "p4";
    const cards = ["SMALL#2", "2D#1", "AH#1", "AC#2", "AC#1"] as const;
    let state = start(FOUR_PLAYER_CONFIGURATION, "wildcard-0").state;
    expect(playerView(state, "p1").currentActor).toBe(actor);
    const retained = new Set<CardInstanceCode>(cards);
    while (playerView(state, actor).hand!.length > retained.size) {
      const card = playerView(state, actor).hand!.find(
        (candidate) => !retained.has(candidate),
      )!;
      state = apply(state, {
        type: "Play",
        playerId: actor,
        cards: [card],
      }).state;
      state = passUntilOpenLead(state);
    }

    const played = apply(state, {
      type: "Play",
      playerId: actor,
      cards,
    });
    expect(played.events[0]).toMatchObject({
      type: "CardsPlayed",
      form: "full-house",
      rank: "A",
      representedFaces: ["2S", "2D", "AH", "AC", "AC"],
      comparisonRanks: ["A"],
    });
    expect(played.events.some((event) => event.type === "PlayerFinished")).toBe(
      true,
    );
  });

  it.each([SIX_PLAYER_CONFIGURATION, FOUR_PLAYER_CONFIGURATION])(
    "records a win, caught opponent, and no current actor for %s",
    (configuration) => {
      let state = start(configuration, "win-seed").state;
      for (let finisher = 0; finisher < 5; finisher += 1) {
        state = drainCurrentLeader(state);
        if (playerView(state, "p1").handResult !== undefined) break;
      }

      const view = playerView(state, "p1");
      expect(view.handResult).toMatchObject({
        outcome: "win",
        winningTeam: view.handResult?.firstFinisherTeam,
        nextDealerTeam: view.handResult?.firstFinisherTeam,
      });
      expect(view.handResult?.caughtPlayerIds).toHaveLength(1);
      expect(view.currentActor).toBeUndefined();
      expect(view.currentActorSeat).toBeUndefined();
    },
  );

  it("records a draw when the opposing team finishes after the first finisher", () => {
    let scenario: State | undefined;
    for (let seed = 0; seed < 20 && scenario === undefined; seed += 1) {
      let state = start(FOUR_PLAYER_CONFIGURATION, `draw-${seed}`).state;
      state = drainCurrentLeader(state);
      state = drainCurrentLeader(state);
      const leader = playerView(state, "p1").currentActor!;

      for (const leadCard of playerView(state, leader).hand ?? []) {
        const lead = decide(state, {
          type: "Play",
          playerId: leader,
          cards: [leadCard],
        });
        if (!lead.ok || lead.events.some((event) => event.type === "LeadReset"))
          continue;
        const ledState = fold(state, lead.events);
        const responder = playerView(ledState, "p1").currentActor!;
        const responseCard = playerView(ledState, responder).hand?.find(
          (card) =>
            decide(ledState, {
              type: "Play",
              playerId: responder,
              cards: [card],
            }).ok,
        );
        if (responseCard === undefined) continue;
        let responseState = apply(ledState, {
          type: "Play",
          playerId: responder,
          cards: [responseCard],
        }).state;
        if (playerView(responseState, "p1").unbeatenPlay !== undefined) {
          responseState = apply(responseState, {
            type: "Pass",
            playerId: playerView(responseState, "p1").currentActor!,
          }).state;
        }
        scenario = drainCurrentLeader(responseState);
        break;
      }
    }
    expect(scenario).toBeDefined();

    const result = playerView(scenario!, "p1").handResult;
    expect(result).toEqual({
      outcome: "draw",
      firstFinisherTeam: result?.firstFinisherTeam,
      nextDealerTeam: result?.firstFinisherTeam,
      caughtPlayerIds: [],
    });
  });

  it("allows a previous passer to respond after a stronger play", () => {
    let acceptedReentry = false;
    for (let seed = 0; seed < 40 && !acceptedReentry; seed += 1) {
      const initial = start(FOUR_PLAYER_CONFIGURATION, `reentry-${seed}`).state;
      const leader = playerView(initial, "p1").currentActor!;

      for (const leadCard of playerView(initial, leader).hand ?? []) {
        const lead = decide(initial, {
          type: "Play",
          playerId: leader,
          cards: [leadCard],
        });
        if (!lead.ok || lead.events.some((event) => event.type === "LeadReset"))
          continue;
        let state = fold(initial, lead.events);
        const passer = playerView(state, "p1").currentActor!;
        state = apply(state, { type: "Pass", playerId: passer }).state;
        const responder = playerView(state, "p1").currentActor!;

        for (const responseCard of playerView(state, responder).hand ?? []) {
          const response = decide(state, {
            type: "Play",
            playerId: responder,
            cards: [responseCard],
          });
          if (
            !response.ok ||
            response.events.some((event) => event.type === "LeadReset")
          )
            continue;
          let responseState = fold(state, response.events);
          expect(playerView(responseState, "p1").passedPlayerIds).toEqual([]);
          for (let pass = 0; pass < 2; pass += 1) {
            responseState = apply(responseState, {
              type: "Pass",
              playerId: playerView(responseState, "p1").currentActor!,
            }).state;
          }
          if (playerView(responseState, "p1").currentActor !== passer) continue;
          const reentryCard = playerView(responseState, passer).hand?.find(
            (card) =>
              decide(responseState, {
                type: "Play",
                playerId: passer,
                cards: [card],
              }).ok,
          );
          if (reentryCard === undefined) continue;
          expect(
            decide(responseState, {
              type: "Play",
              playerId: passer,
              cards: [reentryCard],
            }).ok,
          ).toBe(true);
          acceptedReentry = true;
          break;
        }
        if (acceptedReentry) break;
      }
    }
    expect(acceptedReentry).toBe(true);
  });

  it("rejects invalid action state, actor, ownership, and pass commands", () => {
    const lobby = evolve(undefined, {
      type: "RoomCreated",
      roomId: "rejection-room",
      ownerId: "p1",
      rulesConfiguration: FOUR_PLAYER_CONFIGURATION,
      seatingPolicy: "fixed",
    });
    expect(decide(lobby, { type: "Pass", playerId: "p1" })).toEqual({
      ok: false,
      rejection: { reason: "room-not-active" },
    });

    const started = start(FOUR_PLAYER_CONFIGURATION, "rejection-seed");
    const view = playerView(started.state, "p1");
    const actor = view.currentActor!;
    const other = started.playerIds.find((playerId) => playerId !== actor)!;
    expect(decide(started.state, { type: "Pass", playerId: actor })).toEqual({
      ok: false,
      rejection: { reason: "pass-on-open-lead" },
    });
    expect(
      decide(started.state, { type: "Play", playerId: other, cards: [] }),
    ).toEqual({ ok: false, rejection: { reason: "not-current-player" } });
    expect(
      decide(started.state, {
        type: "Play",
        playerId: actor,
        cards: [playerView(started.state, other).hand![0]!],
      }),
    ).toEqual({ ok: false, rejection: { reason: "card-not-in-hand" } });
    const ownCard = playerView(started.state, actor).hand![0]!;
    expect(
      decide(started.state, {
        type: "Play",
        playerId: actor,
        cards: [ownCard, ownCard],
      }),
    ).toEqual({
      ok: false,
      rejection: { reason: "duplicate-card-instance" },
    });
  });

  it("conserves cards and turn ownership for generated legal-single flows", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(FOUR_PLAYER_CONFIGURATION, SIX_PLAYER_CONFIGURATION),
        fc.string({ minLength: 1, maxLength: 24 }),
        (configuration, handSeed) => {
          const started = start(configuration, handSeed);
          let state = started.state;
          const initialCards = remainingCards(state, started.playerIds).sort();
          const playedCards: string[] = [];

          for (let step = 0; step < 24; step += 1) {
            const view = playerView(state, "p1");
            if (view.handResult !== undefined) break;
            const actor = view.currentActor!;
            const command =
              view.unbeatenPlay === undefined
                ? ({
                    type: "Play",
                    playerId: actor,
                    cards: [playerView(state, actor).hand![0]!],
                  } as const)
                : ({ type: "Pass", playerId: actor } as const);
            const applied = apply(state, command);
            for (const event of applied.events) {
              if (event.type === "CardsPlayed")
                playedCards.push(...event.cards);
            }
            state = applied.state;

            const remaining = remainingCards(state, started.playerIds);
            expect(playedCards.length + remaining.length).toBe(
              initialCards.length,
            );
            expect([...new Set([...playedCards, ...remaining])].sort()).toEqual(
              initialCards,
            );
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  decodeCardInstance,
  type CardInstanceCode,
  type RulesConfiguration,
} from "@dglz/game-rules";
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

function count(configuration: RulesConfiguration): number {
  return configuration.rulesetId === "dglz-6p-3d-v1" ? 6 : 4;
}

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

function view(state: State, playerId = "p1"): PlayerView {
  return derivePlayerView(state, playerId);
}

function readyMatch(
  configuration: RulesConfiguration,
  initialSeed = "phase-5-initial",
): {
  state: State;
  history: Event[];
  playerIds: readonly string[];
} {
  const playerCount = count(configuration);
  const created: Event = {
    type: "RoomCreated",
    roomId: "phase-5-room",
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
    const seated = apply(state, {
      type: "AssignSeat",
      playerId,
      seatIndex,
    });
    history.push(...seated.events);
    state = seated.state;
    const ready = apply(state, {
      type: "SetReadiness",
      playerId,
      ready: true,
    });
    history.push(...ready.events);
    state = ready.state;
  }
  const selected = apply(state, { type: "SelectMatch", playerId: "p1" });
  history.push(...selected.events);
  state = selected.state;
  const started = apply(state, {
    type: "StartMatch",
    handSeed: initialSeed,
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
  });
  history.push(...started.events);
  return {
    state: started.state,
    history,
    playerIds: Array.from(
      { length: playerCount },
      (_, index) => `p${index + 1}`,
    ),
  };
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
    const applied = apply(
      next,
      card === undefined
        ? { type: "Pass", playerId: actor }
        : { type: "Play", playerId: actor, cards: [card] },
    );
    history.push(...applied.events);
    next = applied.state;
  }
  throw new Error("First Hand did not finish");
}

function startInitialHand(
  configuration: RulesConfiguration,
  initialSeed = "phase-5-initial",
): {
  state: State;
  history: Event[];
  playerIds: readonly string[];
} {
  const started = readyMatch(configuration, initialSeed);
  started.state = playFirstHand(started.state, started.history);
  return started;
}

function initialCards(state: State, playerIds: readonly string[]): string[] {
  return playerIds.flatMap((playerId) => view(state, playerId).hand ?? []);
}

function runReturns(state: State): State {
  let next = state;
  for (let step = 0; step < 20; step += 1) {
    const current = view(next);
    if (current.setupStage === "play") return next;
    if (current.setupStage !== "return-card-selection") {
      throw new Error(`Unexpected setup stage: ${current.setupStage}`);
    }
    const actor = current.pendingPlayerIds?.[0];
    if (actor === undefined) throw new Error("Missing Return Card actor");
    const actorView = view(next, actor);
    const card = actorView.hand?.[0];
    if (card === undefined) throw new Error("Return actor has no cards");
    next = apply(next, {
      type: "SelectReturnCard",
      playerId: actor,
      card,
    }).state;
  }
  throw new Error("Return Cards did not finish");
}

describe("game-core subsequent Hands and Tribute", () => {
  it("skips Tribute and starts play with the first finisher after a draw", () => {
    const first = startInitialHand(FOUR_PLAYER_CONFIGURATION, "phase-5-draw-1");
    expect(view(first.state).handResult?.caughtPlayerIds).toEqual([]);
    const firstFinisher =
      first.playerIds[
        view(first.state).finishPositions!.findIndex(
          (position) => position === 1,
        )
      ];

    const next = apply(first.state, {
      type: "StartNextHand",
      handSeed: "phase-5-after-draw",
      randomnessVersion: RANDOMNESS_VERSION,
      shuffleVersion: SHUFFLE_VERSION,
    });

    expect(next.events.map((event) => event.type)).toEqual([
      "HandStarted",
      "HandLeaderChosen",
    ]);
    expect(view(next.state).setupStage).toBe("play");
    expect(view(next.state).currentActor).toBe(firstFinisher);
  });

  it.each([FOUR_PLAYER_CONFIGURATION, SIX_PLAYER_CONFIGURATION])(
    "starts a deterministic next Hand and reaches play after automatic setup for %s",
    (configuration) => {
      const first = startInitialHand(configuration);
      const before = initialCards(first.state, first.playerIds);
      const command = {
        type: "StartNextHand",
        handSeed: "phase-5-next",
        randomnessVersion: RANDOMNESS_VERSION,
        shuffleVersion: SHUFFLE_VERSION,
      } as const;
      const next = apply(first.state, command);
      expect(decide(first.state, command)).toEqual({
        ok: true,
        events: next.events,
      });
      expect(next.events[0]?.type).toBe("HandStarted");
      expect(["HandLeaderChosen", "TributeTransferred"]).toContain(
        next.events.at(-1)?.type,
      );
      expect(view(next.state).completedHandCount).toBe(1);
      expect(view(next.state).trumpRank).toBe(
        view(first.state).teamLevels?.[view(next.state).dealerTeam!],
      );
      expect(
        view(next.state).handSizes?.reduce((sum, size) => sum + size, 0),
      ).toBe(count(configuration) * 27);

      const replayed = fold(undefined, [...first.history, ...next.events]);
      expect(view(replayed)).toEqual(view(next.state));
      expect(before).not.toEqual(initialCards(next.state, first.playerIds));
      expect(JSON.stringify(view(next.state))).not.toContain(command.handSeed);
    },
  );

  it.each([FOUR_PLAYER_CONFIGURATION, SIX_PLAYER_CONFIGURATION])(
    "accepts Fair Random Tribute and recipient-selected Returns for %s",
    (configuration) => {
      const first = startInitialHand(configuration);
      const next = apply(first.state, {
        type: "StartNextHand",
        handSeed: "phase-5-return",
        randomnessVersion: RANDOMNESS_VERSION,
        shuffleVersion: SHUFFLE_VERSION,
      });
      let state = next.state;
      expect(view(state).setupStage).toBe("return-card-selection");
      const transfer = view(state).tributeTransfers![0]!;
      const returnedTribute = apply(state, {
        type: "SelectReturnCard",
        playerId: transfer.recipientId,
        card: transfer.card,
      });
      expect(returnedTribute.events[0]).toMatchObject({
        type: "ReturnTransferred",
        card: transfer.card,
      });
      expect(view(returnedTribute.state, transfer.giverId).hand).toContain(
        transfer.card,
      );
      state = returnedTribute.state;
      state = runReturns(state);
      expect(view(state).setupStage).toBe("play");
      expect(view(state).currentActor).toBeDefined();
      expect(view(state).returnCandidates).toEqual([]);
    },
  );

  it("keeps Giver Choice private until each giver commits and exposes only public setup facts", () => {
    const configuration: RulesConfiguration = {
      ...SIX_PLAYER_CONFIGURATION,
      nextHandLeader: "highest-tribute",
      tributeCardSelection: "giver-choice",
      returnCardSelection: "giver-choice-from-candidates",
      tributeRecipientPairing: "finish-position-by-tribute-rank",
    };
    const first = startInitialHand(configuration);
    let next = apply(first.state, {
      type: "StartNextHand",
      handSeed: "phase-5-giver-choice",
      randomnessVersion: RANDOMNESS_VERSION,
      shuffleVersion: SHUFFLE_VERSION,
    }).state;
    expect(view(next).setupStage).toBe("tribute-selection");
    expect(view(next)).not.toHaveProperty("currentActor");
    expect(view(next)).not.toHaveProperty("currentActorSeat");
    const pending = view(next).pendingPlayerIds ?? [];
    expect(pending.length).toBeGreaterThan(0);
    const giver = pending[0]!;
    const giverView = view(next, giver);
    expect(giverView.eligibleTributeCards?.length).toBeGreaterThan(0);
    const opponent = first.playerIds.find((playerId) => playerId !== giver)!;
    const opponentJson = JSON.stringify(view(next, opponent));
    for (const card of giverView.hand ?? []) {
      expect(opponentJson).not.toContain(`"${card}"`);
    }

    next = apply(next, {
      type: "SelectTributeCard",
      playerId: giver,
      card: giverView.eligibleTributeCards![0]!,
    }).state;
    expect(view(next, giver).eligibleTributeCards).toEqual([]);
  });

  it("completes the autonomous Tribute and candidate Return paths when no tie is present", () => {
    const configuration: RulesConfiguration = {
      ...SIX_PLAYER_CONFIGURATION,
      nextHandLeader: "highest-tribute",
      tributeCardSelection: "giver-choice",
      returnCardSelection: "giver-choice-from-candidates",
      tributeRecipientPairing: "finish-position-by-tribute-rank",
    };
    const first = startInitialHand(configuration);
    let state = apply(first.state, {
      type: "StartNextHand",
      handSeed: "phase-5-autonomous-0",
      randomnessVersion: RANDOMNESS_VERSION,
      shuffleVersion: SHUFFLE_VERSION,
    }).state;
    let jokerOfferTested = false;

    for (
      let step = 0;
      step < 40 && view(state).setupStage !== "play";
      step += 1
    ) {
      const current = view(state);
      expect(current.setupStage).not.toBe("recipient-pairing-tie");
      expect(current.setupStage).not.toBe("leader-selection-tie");
      if (current.setupStage === "tribute-selection") {
        const actor = current.pendingPlayerIds![0]!;
        state = apply(state, {
          type: "SelectTributeCard",
          playerId: actor,
          card: view(state, actor).eligibleTributeCards![0]!,
        }).state;
        continue;
      }

      const actor = current.pendingPlayerIds![0]!;
      const offer = current.returnCandidates?.find(
        (candidateOffer) => candidateOffer.giverId === actor,
      );
      if (offer !== undefined) {
        state = apply(state, {
          type: "SelectReturnCard",
          playerId: actor,
          card: offer.candidateCards[0]!,
        }).state;
        continue;
      }

      const transfer = current.tributeTransfers!.find(
        (candidate) => candidate.recipientId === actor,
      )!;
      const tribute = decodeCardInstance(transfer.card);
      if (tribute.ok && tribute.card.face.kind === "joker") {
        jokerOfferTested = true;
        const directReturn = decide(state, {
          type: "SelectReturnCard",
          playerId: actor,
          card: view(state, actor).hand![0]!,
        });
        if (
          directReturn.ok ||
          directReturn.rejection.reason !== "return-candidates-invalid"
        ) {
          throw new Error("Joker Return accepted without a candidate offer");
        }
        const candidateCards: CardInstanceCode[] = [];
        const ranks = new Set<string>();
        for (const candidate of view(state, actor).hand ?? []) {
          const decoded = decodeCardInstance(candidate);
          if (!decoded.ok || ranks.has(decoded.card.face.rank)) continue;
          ranks.add(decoded.card.face.rank);
          candidateCards.push(candidate);
          if (
            candidateCards.length ===
            (tribute.card.face.rank === "SMALL" ? 2 : 3)
          )
            break;
        }
        state = apply(state, {
          type: "OfferReturnCandidates",
          playerId: actor,
          candidateCards,
        }).state;
      } else {
        state = apply(state, {
          type: "SelectReturnCard",
          playerId: actor,
          card: view(state, actor).hand![0]!,
        }).state;
      }
    }

    expect(view(state).setupStage).toBe("play");
    expect(jokerOfferTested).toBe(true);
  });

  it("defers unresolved Finish Position and Highest Tribute ties", () => {
    const configuration: RulesConfiguration = {
      ...SIX_PLAYER_CONFIGURATION,
      nextHandLeader: "highest-tribute",
      tributeCardSelection: "fair-random",
      tributeRecipientPairing: "finish-position-by-tribute-rank",
    };
    const first = startInitialHand(
      configuration,
      "phase-5-singleton-tie-initial-36",
    );
    const pairingTie = apply(first.state, {
      type: "StartNextHand",
      handSeed: "phase-5-singleton-tie-2",
      randomnessVersion: RANDOMNESS_VERSION,
      shuffleVersion: SHUFFLE_VERSION,
    }).state;
    expect(view(pairingTie).setupStage).toBe("recipient-pairing-tie");
    expect(view(pairingTie).tributeTransfers).toHaveLength(1);

    const leaderConfig: RulesConfiguration = {
      ...SIX_PLAYER_CONFIGURATION,
      nextHandLeader: "highest-tribute",
      tributeCardSelection: "giver-choice",
      tributeRecipientPairing: "adjacent-first-automatic",
    };
    const leaderFirst = startInitialHand(
      leaderConfig,
      "phase-5-leader-tie-initial-1",
    );
    let leaderTie = apply(leaderFirst.state, {
      type: "StartNextHand",
      handSeed: "phase-5-leader-tie-2",
      randomnessVersion: RANDOMNESS_VERSION,
      shuffleVersion: SHUFFLE_VERSION,
    }).state;
    for (let step = 0; step < 30; step += 1) {
      const current = view(leaderTie);
      if (current.setupStage === "leader-selection-tie") break;
      if (current.setupStage === "return-card-selection") {
        const actor = current.pendingPlayerIds![0]!;
        leaderTie = apply(leaderTie, {
          type: "SelectReturnCard",
          playerId: actor,
          card: view(leaderTie, actor).hand![0]!,
        }).state;
        continue;
      }
      const actor = current.pendingPlayerIds![0]!;
      leaderTie = apply(leaderTie, {
        type: "SelectTributeCard",
        playerId: actor,
        card: view(leaderTie, actor).eligibleTributeCards![0]!,
      }).state;
    }
    expect(view(leaderTie).setupStage).toBe("leader-selection-tie");
  });

  it("excludes Jokers when finding a four-player Tribute rank", () => {
    const configuration: RulesConfiguration = {
      ...FOUR_PLAYER_CONFIGURATION,
      tributeCardSelection: "giver-choice",
    };
    const first = startInitialHand(configuration);
    const state = apply(first.state, {
      type: "StartNextHand",
      handSeed: "phase-5-4p-joker-0",
      randomnessVersion: RANDOMNESS_VERSION,
      shuffleVersion: SHUFFLE_VERSION,
    }).state;
    const eligible = view(
      state,
      view(state).pendingPlayerIds![0]!,
    ).eligibleTributeCards!;
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible.every((card) => !/^(SMALL|BIG)#/.test(card))).toBe(true);
  });

  it("rejects repeated/invalid next-Hand and setup commands", () => {
    const first = startInitialHand(FOUR_PLAYER_CONFIGURATION);
    expect(
      decide(first.state, {
        type: "StartNextHand",
        handSeed: "",
        randomnessVersion: RANDOMNESS_VERSION,
        shuffleVersion: SHUFFLE_VERSION,
      }),
    ).toEqual({ ok: false, rejection: { reason: "invalid-hand-seed" } });
    expect(
      decide(first.state, {
        type: "StartNextHand",
        handSeed: "phase-5-version",
        randomnessVersion:
          "unsupported" as unknown as typeof RANDOMNESS_VERSION,
        shuffleVersion: SHUFFLE_VERSION,
      }),
    ).toEqual({
      ok: false,
      rejection: { reason: "unsupported-randomness-version" },
    });
    expect(
      decide(first.state, {
        type: "StartNextHand",
        handSeed: "phase-5-version",
        randomnessVersion: RANDOMNESS_VERSION,
        shuffleVersion: "unsupported" as unknown as typeof SHUFFLE_VERSION,
      }),
    ).toEqual({
      ok: false,
      rejection: { reason: "unsupported-shuffle-version" },
    });

    const next = apply(first.state, {
      type: "StartNextHand",
      handSeed: "phase-5-reject",
      randomnessVersion: RANDOMNESS_VERSION,
      shuffleVersion: SHUFFLE_VERSION,
    });
    expect(
      decide(next.state, {
        type: "StartNextHand",
        handSeed: "phase-5-repeat",
        randomnessVersion: RANDOMNESS_VERSION,
        shuffleVersion: SHUFFLE_VERSION,
      }).ok,
    ).toBe(false);
    expect(
      decide(next.state, {
        type: "Play",
        playerId: view(next.state).currentActor ?? "p1",
        cards: [
          view(next.state, view(next.state).currentActor ?? "p1").hand![0]!,
        ],
      }),
    ).toMatchObject({ ok: false });
  });

  it.each([FOUR_PLAYER_CONFIGURATION, SIX_PLAYER_CONFIGURATION])(
    "conserves Card Instances through Tribute and Return transfers for %s",
    (configuration) => {
      const first = startInitialHand(configuration);
      const next = apply(first.state, {
        type: "StartNextHand",
        handSeed: "phase-5-conserve",
        randomnessVersion: RANDOMNESS_VERSION,
        shuffleVersion: SHUFFLE_VERSION,
      });
      const history = [...first.history, ...next.events];
      let state = next.state;
      for (
        let step = 0;
        step < 20 && view(state).setupStage !== "play";
        step += 1
      ) {
        const current = view(state);
        if (current.setupStage !== "return-card-selection") break;
        const actor = current.pendingPlayerIds![0]!;
        const card = view(state, actor).hand![0]! as CardInstanceCode;
        const returned = apply(state, {
          type: "SelectReturnCard",
          playerId: actor,
          card,
        });
        history.push(...returned.events);
        state = returned.state;
        const allCards = initialCards(state, first.playerIds);
        expect(allCards.length).toBe(count(configuration) * 27);
        expect(new Set(allCards).size).toBe(count(configuration) * 27);
      }
      expect(view(state).setupStage).toBe("play");
      const replayed = fold(undefined, history);
      expect(view(replayed)).toEqual(view(state));
    },
  );

  it.each([FOUR_PLAYER_CONFIGURATION, SIX_PLAYER_CONFIGURATION])(
    "keeps generated next-Hand deals deterministic and conserved for %s",
    (configuration) => {
      const first = startInitialHand(configuration);
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 24 }), (handSeed) => {
          const command = {
            type: "StartNextHand",
            handSeed,
            randomnessVersion: RANDOMNESS_VERSION,
            shuffleVersion: SHUFFLE_VERSION,
          } as const;
          const left = decide(first.state, command);
          const right = decide(first.state, command);
          expect(left).toEqual(right);
          if (!left.ok) throw new Error(left.rejection.reason);
          const state = fold(first.state, left.events);
          const cards = initialCards(state, first.playerIds);
          expect(cards).toHaveLength(count(configuration) * 27);
          expect(new Set(cards).size).toBe(cards.length);
          for (const playerId of first.playerIds) {
            expect(view(state, playerId)).not.toHaveProperty("handSeed");
          }
        }),
        { numRuns: 12 },
      );
    },
  );
});

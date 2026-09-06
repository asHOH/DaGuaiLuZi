import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  decide,
  derivePlayerView,
  deriveStartRequirements,
  evolve,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type ChallengeTemplate,
  type Event,
  type State,
} from "../src/index.js";
import type { RulesConfiguration } from "@dglz/game-rules";

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

function fold(state: State | undefined, events: readonly Event[]): State {
  let next = state;
  for (const event of events) next = evolve(next, event);
  if (next === undefined) throw new Error("Expected state");
  return next;
}

function apply(
  state: State,
  command: Parameters<typeof decide>[1],
  history?: Event[],
): State {
  const decision = decide(state, command);
  expect(decision.ok).toBe(true);
  if (!decision.ok) throw new Error(decision.rejection.reason);
  history?.push(...decision.events);
  return fold(state, decision.events);
}

function lobby(
  configuration: RulesConfiguration,
  playerCount: number,
  seatingPolicy: "fixed" | "randomized" = "fixed",
  history?: Event[],
  playerPrefix = "p",
): State {
  const ownerId = `${playerPrefix}1`;
  const created: Event = {
    type: "RoomCreated",
    roomId: "phase-7-room",
    ownerId,
    rulesConfiguration: configuration,
    seatingPolicy,
  };
  history?.push(created);
  let state = evolve(undefined, created);
  for (let index = 2; index <= playerCount; index += 1) {
    state = apply(
      state,
      { type: "JoinRoom", playerId: `${playerPrefix}${index}` },
      history,
    );
  }
  for (let seatIndex = 0; seatIndex < playerCount; seatIndex += 1) {
    const playerId = `${playerPrefix}${seatIndex + 1}`;
    state = apply(state, { type: "AssignSeat", playerId, seatIndex }, history);
    state = apply(
      state,
      { type: "SetReadiness", playerId, ready: true },
      history,
    );
  }
  return state;
}

function initialTemplate(
  configuration: RulesConfiguration,
  dealerSeat = 0,
): ChallengeTemplate {
  return {
    rulesetId: configuration.rulesetId,
    rulesConfiguration: configuration,
    handSeed: "phase-7-challenge-seed",
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
    dealerTeam: (dealerSeat % 2) as 0 | 1,
    teamLevels: ["2", "2"],
    failureCounters: [0, 0],
    trumpRank: "2",
    setup: { kind: "initial-hand", dealerSeat },
  };
}

function playToChallengeCompletion(state: State): State {
  let next = state;
  for (let step = 0; step < 500; step += 1) {
    const current = derivePlayerView(next, "p1");
    if (current.lifecycle !== "ACTIVE") return next;
    const actor = current.currentActor;
    if (actor === undefined) throw new Error("Missing Challenge actor");
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
    next = apply(
      next,
      card === undefined
        ? { type: "Pass", playerId: actor }
        : { type: "Play", playerId: actor, cards: [card] },
    );
  }
  throw new Error("Challenge Hand did not finish");
}

describe("game-core Challenge Hands and hardening", () => {
  it("rejects non-canonical or inconsistent Challenge Templates", () => {
    const state = lobby(FOUR_PLAYER_CONFIGURATION, 4);
    const template = initialTemplate(FOUR_PLAYER_CONFIGURATION);
    const rejectionFor = (candidate: ChallengeTemplate) =>
      decide(state, {
        type: "SelectChallengeHand",
        playerId: "p1",
        template: candidate,
      });

    expect(
      rejectionFor({
        ...template,
        setup: {
          ...template.setup,
          sourcePlayerIds: ["source-account"],
        },
      } as unknown as ChallengeTemplate),
    ).toEqual({
      ok: false,
      rejection: { reason: "challenge-template-invalid" },
    });
    expect(
      rejectionFor({
        ...template,
        rulesConfiguration: {
          ...FOUR_PLAYER_CONFIGURATION,
          wildcardRank: "invalid",
        } as unknown as RulesConfiguration,
      }),
    ).toEqual({
      ok: false,
      rejection: { reason: "challenge-template-invalid" },
    });
    expect(rejectionFor({ ...template, dealerTeam: 1 })).toEqual({
      ok: false,
      rejection: { reason: "challenge-template-invalid" },
    });
    expect(rejectionFor({ ...template, trumpRank: "3" })).toEqual({
      ok: false,
      rejection: { reason: "challenge-template-invalid" },
    });
    expect(
      rejectionFor({
        ...template,
        teamLevels: ["6", "2"],
        trumpRank: "6",
      } as unknown as ChallengeTemplate),
    ).toEqual({
      ok: false,
      rejection: { reason: "challenge-template-invalid" },
    });
  });

  it("uses the Challenge Ruleset for selection and preserves Match settings", () => {
    let state = lobby(SIX_PLAYER_CONFIGURATION, 6);
    state = apply(state, { type: "SelectMatch", playerId: "p1" });
    expect(deriveStartRequirements(state)).toEqual({
      playerIds: ["p1", "p2", "p3", "p4", "p5", "p6"],
    });
    const template = initialTemplate(FOUR_PLAYER_CONFIGURATION);
    const selected = decide(state, {
      type: "SelectChallengeHand",
      playerId: "p1",
      template,
    });
    expect(selected).toEqual({
      ok: false,
      rejection: { reason: "challenge-ruleset-too-small" },
    });
  });

  it("clears stale readiness when first selection changes the effective Ruleset", () => {
    const state = lobby(SIX_PLAYER_CONFIGURATION, 4);
    const selected = decide(state, {
      type: "SelectChallengeHand",
      playerId: "p1",
      template: initialTemplate(FOUR_PLAYER_CONFIGURATION),
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) throw new Error(selected.rejection.reason);
    expect(selected.events.map((event) => event.type)).toEqual([
      "ChallengeHandSelected",
      "ReadinessCleared",
    ]);
    expect(
      deriveStartRequirements(fold(state, selected.events)),
    ).toBeUndefined();
  });

  it("applies effective-Ruleset transitions without coupling Match configuration", () => {
    let state = lobby(FOUR_PLAYER_CONFIGURATION, 4);
    state = apply(state, { type: "SelectMatch", playerId: "p1" });
    state = apply(state, {
      type: "SelectChallengeHand",
      playerId: "p1",
      template: initialTemplate(SIX_PLAYER_CONFIGURATION),
    });
    let view = derivePlayerView(state, "p1");
    expect(view.seats).toHaveLength(6);
    expect(view.seats.slice(0, 4).map((seat) => seat.playerId)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
    expect(view.members.every((member) => !member.ready)).toBe(true);

    for (let index = 1; index <= 4; index += 1) {
      state = apply(state, {
        type: "SetReadiness",
        playerId: `p${index}`,
        ready: true,
      });
    }
    const changedMatchConfiguration: RulesConfiguration = {
      ...FOUR_PLAYER_CONFIGURATION,
      wildcardRank: "weakest-rank",
    };
    state = apply(state, {
      type: "ReplaceMatchRulesConfiguration",
      playerId: "p1",
      rulesConfiguration: changedMatchConfiguration,
    });
    view = derivePlayerView(state, "p1");
    expect(view.rulesConfiguration).toEqual(changedMatchConfiguration);
    expect(view.effectiveRulesetId).toBe("dglz-6p-3d-v1");
    expect(view.members.every((member) => member.ready)).toBe(true);

    state = apply(state, { type: "SelectMatch", playerId: "p1" });
    view = derivePlayerView(state, "p1");
    expect(view.seats).toHaveLength(4);
    expect(view.members.every((member) => !member.ready)).toBe(true);

    let shrinking = lobby(SIX_PLAYER_CONFIGURATION, 4);
    shrinking = apply(shrinking, {
      type: "AssignSeat",
      playerId: "p3",
      seatIndex: 4,
    });
    shrinking = apply(shrinking, {
      type: "AssignSeat",
      playerId: "p4",
      seatIndex: 5,
    });
    shrinking = apply(shrinking, {
      type: "SelectChallengeHand",
      playerId: "p1",
      template: initialTemplate(FOUR_PLAYER_CONFIGURATION),
    });
    expect(
      derivePlayerView(shrinking, "p1").seats.every(
        (seat) => seat.playerId === undefined,
      ),
    ).toBe(true);
  });

  it("starts a reusable initial Challenge Hand with hidden seed and isolated locks", () => {
    let state = lobby(FOUR_PLAYER_CONFIGURATION, 4, "randomized");
    state = apply(state, { type: "SelectMatch", playerId: "p1" });
    state = apply(state, {
      type: "SelectChallengeHand",
      playerId: "p1",
      template: initialTemplate(FOUR_PLAYER_CONFIGURATION, 2),
    });
    for (let seatIndex = 0; seatIndex < 4; seatIndex += 1) {
      state = apply(state, {
        type: "SetReadiness",
        playerId: `p${seatIndex + 1}`,
        ready: true,
      });
    }
    expect(deriveStartRequirements(state)).toEqual({
      playerIds: ["p1", "p2", "p3", "p4"],
    });
    const selectedView = derivePlayerView(state, "p1");
    expect(selectedView.selectedActivity).toBe("challenge");
    expect(selectedView.effectiveRulesetId).toBe("dglz-4p-2d-v1");

    const started = decide(state, { type: "StartChallengeHand" });
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.rejection.reason);
    expect(started.events.map((event) => event.type)).toEqual([
      "ChallengeHandStarted",
      "HandLeaderChosen",
    ]);
    const event = started.events[0];
    if (event === undefined || event.type !== "ChallengeHandStarted") {
      throw new Error("Expected ChallengeHandStarted");
    }
    state = fold(state, started.events);
    const playerView = derivePlayerView(state, "p1");
    expect(playerView.lifecycle).toBe("ACTIVE");
    expect(playerView.selectedActivity).toBe("challenge");
    expect(playerView.handSizes).toEqual([27, 27, 27, 27]);
    expect(playerView.matchRulesConfigurationLocked).toBe(false);
    expect(playerView.seatingPolicyLocked).toBe(true);
    expect(JSON.stringify(playerView)).not.toContain(event.template.handSeed);
    expect(
      ["p1", "p2", "p3", "p4"].flatMap(
        (playerId) => derivePlayerView(state, playerId).hand ?? [],
      ),
    ).toHaveLength(108);
    expect(
      new Set(
        ["p1", "p2", "p3", "p4"].flatMap(
          (playerId) => derivePlayerView(state, playerId).hand ?? [],
        ),
      ).size,
    ).toBe(108);
  });

  it("reproduces the source logical-seat deal for independent Challenge runs", () => {
    const template = initialTemplate(SIX_PLAYER_CONFIGURATION, 4);
    const start = (seed: string, playerPrefix: string) => {
      let state = lobby(
        SIX_PLAYER_CONFIGURATION,
        6,
        "randomized",
        undefined,
        playerPrefix,
      );
      state = apply(state, {
        type: "SelectChallengeHand",
        playerId: `${playerPrefix}1`,
        template: { ...template, handSeed: seed },
      });
      const decision = decide(state, { type: "StartChallengeHand" });
      expect(decision.ok).toBe(true);
      if (!decision.ok) throw new Error(decision.rejection.reason);
      const event = decision.events[0];
      if (event === undefined || event.type !== "ChallengeHandStarted") {
        throw new Error("Expected ChallengeHandStarted");
      }
      return {
        state: fold(state, decision.events),
        event,
      };
    };

    const first = start("phase-7-repro-seed", "p");
    const second = start("phase-7-repro-seed", "q");
    expect(first.event.template).toEqual(second.event.template);
    for (let seatIndex = 0; seatIndex < 6; seatIndex += 1) {
      expect(
        derivePlayerView(first.state, first.event.playerIds[seatIndex]!).hand,
      ).toEqual(
        derivePlayerView(second.state, second.event.playerIds[seatIndex]!).hand,
      );
    }
  });

  it("completes and retains only the public Challenge result", () => {
    let state = lobby(FOUR_PLAYER_CONFIGURATION, 4);
    state = apply(state, {
      type: "SelectChallengeHand",
      playerId: "p1",
      template: initialTemplate(FOUR_PLAYER_CONFIGURATION),
    });
    state = apply(state, { type: "StartChallengeHand" });
    state = playToChallengeCompletion(state);
    const playerView = derivePlayerView(state, "p1");
    expect(playerView.lifecycle).toBe("LOBBY");
    expect(playerView.selectedActivity).toBeUndefined();
    expect(playerView.challengeSummary?.outcome).toBe("completed");
    expect(playerView.hand).toBeUndefined();
    expect(playerView.handSizes).toBeUndefined();
  });

  it("reuses seat-indexed subsequent-Hand setup without source identities", () => {
    let state = lobby(SIX_PLAYER_CONFIGURATION, 6);
    const template: ChallengeTemplate = {
      ...initialTemplate(SIX_PLAYER_CONFIGURATION),
      handSeed: "phase-7-subsequent-seed",
      setup: {
        kind: "subsequent-hand",
        finishPositions: [1, undefined, 2, undefined, 3, undefined],
        result: {
          outcome: "win",
          firstFinisherTeam: 0,
          winningTeam: 0,
          nextDealerTeam: 0,
          caughtSeatIndices: [1, 3, 5],
        },
      },
    };
    state = apply(state, {
      type: "SelectChallengeHand",
      playerId: "p1",
      template,
    });
    state = apply(state, { type: "StartChallengeHand" });
    expect(derivePlayerView(state, "p1").setupStage).toBe(
      "return-card-selection",
    );
    expect(derivePlayerView(state, "p1").tributeTransfers).toHaveLength(3);

    for (let step = 0; step < 3; step += 1) {
      const current = derivePlayerView(state, "p1");
      const recipientId = current.pendingPlayerIds?.[0];
      if (recipientId === undefined) throw new Error("Missing Return actor");
      const card = derivePlayerView(state, recipientId).hand?.[0];
      if (card === undefined) throw new Error("Missing Return card");
      state = apply(state, {
        type: "SelectReturnCard",
        playerId: recipientId,
        card,
      });
    }
    expect(derivePlayerView(state, "p1").setupStage).toBe("play");
    expect(derivePlayerView(state, "p1").currentActor).toBe("p1");
  });

  it("supports owner abort, interruption, and archival without private views", () => {
    let state = lobby(FOUR_PLAYER_CONFIGURATION, 4);
    state = apply(state, {
      type: "SelectChallengeHand",
      playerId: "p1",
      template: initialTemplate(FOUR_PLAYER_CONFIGURATION),
    });
    state = apply(state, { type: "StartChallengeHand" });
    expect(
      decide(state, { type: "AbortChallengeHand", playerId: "p2" }),
    ).toEqual({ ok: false, rejection: { reason: "owner-only" } });
    state = apply(state, { type: "AbortChallengeHand", playerId: "p1" });
    expect(derivePlayerView(state, "p1").challengeSummary).toBeUndefined();

    let interrupted = lobby(FOUR_PLAYER_CONFIGURATION, 4);
    interrupted = apply(interrupted, {
      type: "SelectChallengeHand",
      playerId: "p1",
      template: initialTemplate(FOUR_PLAYER_CONFIGURATION),
    });
    interrupted = apply(interrupted, { type: "StartChallengeHand" });
    interrupted = apply(interrupted, { type: "InterruptRoom" });
    expect(derivePlayerView(interrupted, "p1").lifecycle).toBe("INTERRUPTED");
    expect(derivePlayerView(interrupted, "p1").hand).toBeUndefined();
    interrupted = apply(interrupted, { type: "ArchiveRoom", playerId: "p1" });
    expect(derivePlayerView(interrupted, "p1").lifecycle).toBe("ARCHIVED");
  });

  it("replays immutable Challenge start events to identical views", () => {
    const history: Event[] = [];
    let state = lobby(FOUR_PLAYER_CONFIGURATION, 4, "fixed", history);
    state = apply(
      state,
      {
        type: "SelectChallengeHand",
        playerId: "p1",
        template: initialTemplate(FOUR_PLAYER_CONFIGURATION, 2),
      },
      history,
    );
    const started = decide(state, { type: "StartChallengeHand" });
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.rejection.reason);
    expect(Object.isFrozen(started.events)).toBe(true);
    expect(Object.isFrozen(started.events[0])).toBe(true);
    history.push(...started.events);
    state = fold(state, started.events);
    const replayed = fold(undefined, history);
    for (const playerId of ["p1", "p2", "p3", "p4"]) {
      expect(derivePlayerView(replayed, playerId)).toEqual(
        derivePlayerView(state, playerId),
      );
    }
  });

  it("keeps generated Challenge deals deterministic and conserved", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<RulesConfiguration>(
          FOUR_PLAYER_CONFIGURATION,
          SIX_PLAYER_CONFIGURATION,
        ),
        fc.string({ minLength: 1, maxLength: 24 }),
        (configuration, handSeed) => {
          const playerCount =
            configuration.rulesetId === "dglz-4p-2d-v1" ? 4 : 6;
          let state = lobby(configuration, playerCount);
          state = apply(state, {
            type: "SelectChallengeHand",
            playerId: "p1",
            template: {
              ...initialTemplate(configuration),
              handSeed,
            },
          });
          const left = decide(state, { type: "StartChallengeHand" });
          const right = decide(state, { type: "StartChallengeHand" });
          expect(left).toEqual(right);
          expect(left.ok).toBe(true);
          if (!left.ok) return;
          const started = fold(state, left.events);
          const cards = Array.from(
            { length: playerCount },
            (_, index) => derivePlayerView(started, `p${index + 1}`).hand ?? [],
          ).flat();
          expect(cards).toHaveLength(playerCount * 27);
          expect(new Set(cards).size).toBe(cards.length);
        },
      ),
      { numRuns: 30 },
    );
  });
});

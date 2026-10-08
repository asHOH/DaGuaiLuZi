import { describe, expect, it } from "vitest";
import {
  derivePlayerView,
  evolve,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type ChallengeTemplate,
  type Event,
  type PlayerView,
  type State,
} from "@dglz/game-core";
import type { RulesConfiguration } from "@dglz/game-rules";
import { rulesConfigurationPreset } from "@dglz/protocol";
import {
  createHandSession,
  passivePolicy,
  replayHand,
  runChallengeHand,
  type ChallengeHandOptions,
} from "../src/index.js";

// Previous-Hand facts and seeds reuse game-core's subsequent-Hand/tie scenarios.
function subsequentTemplate(
  rulesConfiguration: RulesConfiguration,
  handSeed = "phase-7-subsequent-seed",
): ChallengeTemplate {
  const count = rulesConfiguration.rulesetId === "dglz-4p-2d-v1" ? 4 : 6;
  return {
    rulesetId: rulesConfiguration.rulesetId,
    rulesConfiguration,
    handSeed,
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
    dealerTeam: 0,
    teamLevels: ["2", "2"],
    failureCounters: [0, 0],
    trumpRank: "2",
    setup: {
      kind: "subsequent-hand",
      finishPositions: Array.from({ length: count }, (_, seat) =>
        seat % 2 === 0 ? seat / 2 + 1 : undefined,
      ),
      result: {
        outcome: "win",
        firstFinisherTeam: 0,
        winningTeam: 0,
        nextDealerTeam: 0,
        caughtSeatIndices: Array.from(
          { length: count / 2 },
          (_, index) => index * 2 + 1,
        ),
      },
    },
  };
}

function fold(events: readonly Event[]): State {
  let state: State | undefined;
  for (const event of events) state = evolve(state, event);
  if (state === undefined) throw new Error("Missing recorded state");
  return state;
}

const rulesets = ["dglz-4p-2d-v1", "dglz-6p-3d-v1"] as const;

describe("Challenge runner", () => {
  for (const rulesetId of rulesets) {
    for (const preset of ["省心", "自主"] as const) {
      for (const seatingPolicy of ["fixed", "randomized"] as const) {
        it(`completes ${rulesetId}/${preset}/${seatingPolicy} setup using Challenge rules`, () => {
          const template = subsequentTemplate(
            rulesConfigurationPreset(rulesetId, preset),
          );
          const original = structuredClone(template);
          const roomRulesConfiguration = rulesConfigurationPreset(
            rulesetId === rulesets[0] ? rulesets[1] : rulesets[0],
            preset === "省心" ? "自主" : "省心",
          );
          const stages = new Set<string | undefined>();
          const options = {
            record: true,
            template,
            roomRulesConfiguration,
            seatingPolicy,
            createPolicy: () => (view: PlayerView, actor: string) => {
              expect(view.effectiveRulesConfiguration).toEqual(
                template.rulesConfiguration,
              );
              expect(view.rulesConfiguration).toEqual(roomRulesConfiguration);
              stages.add(view.setupStage);
              return passivePolicy(view, actor);
            },
          };
          const run = runChallengeHand(options);
          expect(replayHand(JSON.parse(JSON.stringify(run.record)))).toEqual(
            run,
          );
          expect(stages).toEqual(
            new Set(
              preset === "自主"
                ? ["tribute-selection", "return-card-selection", "play"]
                : ["return-card-selection", "play"],
            ),
          );
          expect(
            run.events.filter((event) => event.type === "TributeTransferred"),
          ).toHaveLength(rulesetId === rulesets[0] ? 2 : 3);
          expect(
            run.events
              .filter((event) => event.type === "ReturnCandidatesOffered")
              .map((event) => event.candidateCards.length)
              .sort((left, right) => left - right),
          ).toEqual(
            rulesetId === rulesets[1] && preset === "自主" ? [2, 3] : [],
          );
          const final = derivePlayerView(fold(run.events), "p1");
          expect(final.lifecycle).toBe("LOBBY");
          expect(final.handResult).toBeUndefined();
          expect(final.hand).toBeUndefined();
          expect(final.challengeSummary?.result).toEqual(run.result);
          expect(run.finishPositions).toHaveLength(
            rulesetId === rulesets[0] ? 4 : 6,
          );
          expect(run.events.at(-1)?.type).toBe("ChallengeHandCompleted");
          expect(
            runChallengeHand({ ...options, actionLimit: run.actionCount }),
          ).toEqual(run);
          expect(template).toEqual(original);
          expect(Object.isFrozen(template.setup)).toBe(false);
        });
      }
    }

    it(`resolves both ${rulesetId} ties after three abstaining rounds`, () => {
      const template = subsequentTemplate(
        rulesConfigurationPreset(rulesetId, "自主"),
        "phase-6-triple-27",
      );
      const seen: { playerId: string; view: PlayerView }[] = [];
      const run = runChallengeHand({
        record: true,
        template,
        seatingPolicy: "randomized",
        createPolicy: () => (view, playerId) => {
          expect(JSON.stringify(view)).not.toContain(template.handSeed);
          expect(Object.isFrozen(view)).toBe(true);
          seen.push({ playerId, view });
          return passivePolicy(view, playerId);
        },
      });
      expect(replayHand(JSON.parse(JSON.stringify(run.record)))).toEqual(run);
      expect(
        run.events
          .filter((event) => event.type === "TieChoiceRoundResolved")
          .map((event) => [event.tieKind, event.round, event.fallback]),
      ).toEqual([
        ["recipient-pairing", 1, false],
        ["recipient-pairing", 2, false],
        ["recipient-pairing", 3, true],
        ["leader-selection", 1, false],
        ["leader-selection", 2, false],
        ["leader-selection", 3, true],
      ]);
      // Giver-choice fixture: these facts each begin exactly one policy action.
      const actionEvents = new Set([
        "TributeCardSelected",
        "ReturnCandidatesOffered",
        "ReturnTransferred",
        "TieChoiceBallotSubmitted",
        "CardsPlayed",
        "PlayerPassed",
      ]);
      const expected: typeof seen = [];
      let state: State | undefined;
      for (const event of run.events) {
        if (actionEvents.has(event.type)) {
          const playerId = seen[expected.length]!.playerId;
          expected.push({ playerId, view: derivePlayerView(state!, playerId) });
        }
        state = evolve(state, event);
      }
      expect(seen).toHaveLength(run.actionCount);
      expect(seen).toEqual(expected);
      const setupViews = seen.filter(({ view }) => view.setupStage !== "play");
      expect(setupViews.length).toBeGreaterThan(0);
      // Compare actual scheduling with the lowest pending logical seat, not ID order.
      expect(
        setupViews.map(({ playerId, view }) =>
          view.seats.findIndex((seat) => seat.playerId === playerId),
        ),
      ).toEqual(
        setupViews.map(({ view }) =>
          Math.min(
            ...view.seats
              .filter((seat) => view.pendingPlayerIds!.includes(seat.playerId!))
              .map((seat) => seat.seatIndex),
          ),
        ),
      );
      expect(
        runChallengeHand({
          template,
          seatingPolicy: "randomized",
          record: true,
        }),
      ).toEqual(run);
    });

    it(`retains initial ${rulesetId} Challenge results at Trump Rank 5`, () => {
      const template: ChallengeTemplate = {
        ...subsequentTemplate(rulesConfigurationPreset(rulesetId, "省心")),
        teamLevels: ["5", "2"],
        trumpRank: "5",
        setup: { kind: "initial-hand", dealerSeat: 0 },
      };
      const run = runChallengeHand({ template });
      expect(run.result).toMatchObject({ outcome: "win", winningTeam: 0 });
      expect(
        run.events.some(
          (event) =>
            event.type === "TributeTransferred" ||
            event.type === "MatchCompleted",
        ),
      ).toBe(false);
      expect(run.events.at(-1)?.type).toBe("ChallengeHandCompleted");
      const beforeCompletion = derivePlayerView(
        fold(run.events.slice(0, -1)),
        "p1",
      );
      expect(run.result).toEqual(beforeCompletion.handResult);
      expect(run.finishPositions).toEqual(beforeCompletion.finishPositions);
      expect(
        derivePlayerView(fold(run.events), "p1").finishPositions,
      ).toBeUndefined();
    });
  }

  it("does not reveal an earlier voter's unresolved choice to a later policy", () => {
    const template = subsequentTemplate(
      rulesConfigurationPreset(rulesets[1], "自主"),
      "phase-6-triple-27",
    );
    const laterViews: PlayerView[] = [];
    for (const candidateIndex of [0, 1]) {
      const session = createHandSession({
        mode: "challenge",
        template,
        record: true,
      });
      let captured = false;
      while (session.currentPlayerId !== undefined) {
        const playerId = session.currentPlayerId;
        const view = session.observe(playerId);
        if (
          view.tieKind === "recipient-pairing" &&
          view.tieRound === 1 &&
          !captured
        ) {
          if (view.tieSubmittedPlayerIds!.length === 1) {
            laterViews.push(view);
            captured = true;
          } else {
            session.step({
              type: "SubmitTieChoiceBallot",
              tieKind: view.tieKind,
              round: view.tieRound,
              candidateId: view.tieCandidateIds![candidateIndex]!,
            });
            continue;
          }
        }
        session.step(passivePolicy(view, playerId));
      }
      expect(captured).toBe(true);
      expect(session.observe("p1").lifecycle).toBe("LOBBY");
      const result = session.getResult()!;
      expect(result.result).toBeDefined();
      expect(result.finishPositions).toHaveLength(6);
      expect(replayHand(result.record)).toEqual(result);
    }
    expect(laterViews).toHaveLength(2);
    expect(laterViews[0]).toEqual(laterViews[1]);
    expect(laterViews[0]?.tieSubmittedPlayerIds).toHaveLength(1);
    expect(laterViews[0]?.tieOwnBallot).toBeUndefined();
    expect(laterViews[0]?.tieResolvedRounds).toBeUndefined();
  });

  it("skips Tribute after a draw", () => {
    const template: ChallengeTemplate = {
      ...subsequentTemplate(rulesConfigurationPreset(rulesets[0], "自主")),
      setup: {
        kind: "subsequent-hand",
        finishPositions: [1, 2, undefined, 3],
        result: {
          outcome: "draw",
          firstFinisherTeam: 0,
          nextDealerTeam: 0,
          caughtSeatIndices: [],
        },
      },
    };
    const stages = new Set();
    const run = runChallengeHand({
      template,
      createPolicy: () => (view, actor) => {
        stages.add(view.setupStage);
        return passivePolicy(view, actor);
      },
    });
    expect(stages).toEqual(new Set(["play"]));
    expect(
      run.events.some((event) => event.type === "TributeTransferred"),
    ).toBe(false);
    expect(run.events.at(-1)?.type).toBe("ChallengeHandCompleted");
  });

  it("rejects an omitted Template even when untyped input supplies Match options", () => {
    let calls = 0;
    const options = {
      mode: "first-hand",
      rulesConfiguration: rulesConfigurationPreset(rulesets[0], "省心"),
      handSeed: "missing-template",
      createPolicy: () => {
        calls++;
        return passivePolicy;
      },
    };
    expect(() =>
      runChallengeHand(options as unknown as ChallengeHandOptions),
    ).toThrow("挑战模板无效");
    expect(calls).toBe(0);
  });

  it("validates Templates before calling policies and bounds setup actions", () => {
    const template = subsequentTemplate(
      rulesConfigurationPreset(rulesets[0], "自主"),
    );
    let calls = 0;
    for (const invalid of [
      null,
      { ...template, handSeed: "" },
      { ...template, randomnessVersion: "future" },
      { ...template, trumpRank: "5" },
      {
        ...template,
        setup: { ...template.setup, finishPositions: [1, 1, 2, undefined] },
      },
    ]) {
      expect(() =>
        runChallengeHand({
          template: invalid as unknown as ChallengeTemplate,
          createPolicy: () => {
            calls++;
            return passivePolicy;
          },
        }),
      ).toThrow("挑战模板无效");
    }
    expect(calls).toBe(0);
    expect(() => runChallengeHand({ template, actionLimit: 1 })).toThrow(
      "动作上限",
    );
    expect(() =>
      runChallengeHand({
        template,
        createPolicy: () => () => ({ type: "Pass" }),
      }),
    ).toThrow("hand-setup-incomplete");
    expect(() =>
      runChallengeHand({
        template,
        createPolicy: () => () => ({
          type: "SelectTributeCard",
          card: "BIG#1",
        }),
      }),
    ).toThrow("tribute-card-not-eligible");
  });
});

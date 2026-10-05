import { describe, expect, it } from "vitest";
import {
  derivePlayerView,
  evolve,
  type PlayerView,
  type State,
} from "@dglz/game-core";
import { rulesConfigurationPreset } from "@dglz/protocol";
import type { RulesConfiguration } from "@dglz/game-rules";
import {
  passivePolicy,
  runFirstHand,
  type Policy,
  type PassiveObservation,
} from "../src/index.js";

const four = rulesConfigurationPreset("dglz-4p-2d-v1", "省心");
const six = rulesConfigurationPreset("dglz-6p-3d-v1", "自主");

describe("first-Hand runner", () => {
  for (const configuration of [four, six]) {
    for (const seatingPolicy of ["fixed", "randomized"] as const) {
      it(`finishes and repeats ${configuration.rulesetId} with ${seatingPolicy} seats`, () => {
        const options = {
          rulesConfiguration: configuration,
          handSeed: "headless-phase-1",
          seatingPolicy,
        };
        const run = runFirstHand(options);
        expect(runFirstHand(options)).toEqual(run);
        expect(
          run.events.filter((event) => event.type === "MatchStarted"),
        ).toHaveLength(1);
        expect(
          run.events.filter((event) => event.type === "HandSettled"),
        ).toHaveLength(1);
        expect(run.events.some((event) => event.type === "HandStarted")).toBe(
          false,
        );
        expect(run.actionCount).toBe(
          run.events.filter(
            (event) =>
              event.type === "CardsPlayed" || event.type === "PlayerPassed",
          ).length,
        );
        let state: State | undefined;
        for (const event of run.events) state = evolve(state, event);
        const final = derivePlayerView(state!, "p1");
        expect(run.result).toEqual(final.handResult);
        expect(run.finishPositions).toEqual(final.finishPositions);
        expect(final.completedHandCount).toBe(1);
        // The completing action is allowed at the exact limit.
        expect(
          runFirstHand({ ...options, actionLimit: run.actionCount }),
        ).toEqual(run);
      });
    }
  }

  it("gives each policy only its frozen engine view and separate per-run memory", () => {
    const observed: { playerId: string; view: PlayerView }[] = [];
    const created: string[] = [];
    const firstHandSizes: (number | undefined)[] = [];
    const options = {
      rulesConfiguration: six,
      handSeed: "private-seed-not-for-policies",
      createPolicy: (playerId: string): Policy => {
        created.push(playerId);
        let calls = 0;
        return (view, actor) => {
          expect(actor).toBe(playerId);
          expect(Object.isFrozen(view)).toBe(true);
          expect(Object.isFrozen(view.hand)).toBe(true);
          expect(JSON.stringify(view)).not.toContain(options.handSeed);
          if (calls++ === 0) firstHandSizes.push(view.hand?.length);
          observed.push({ playerId, view });
          return passivePolicy(view, actor);
        };
      },
    };
    const run = runFirstHand(options);
    expect(created).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(observed).toHaveLength(run.actionCount);
    let state: State | undefined;
    const expected: typeof observed = [];
    for (const event of run.events) {
      if (event.type === "CardsPlayed" || event.type === "PlayerPassed") {
        expected.push({
          playerId: event.playerId,
          view: derivePlayerView(state!, event.playerId),
        });
      }
      state = evolve(state, event);
    }
    expect(observed).toEqual(expected);
    expect(firstHandSizes).toEqual([27, 27, 27, 27, 27, 27]);
    expect(runFirstHand(options)).toEqual(run);
    expect(created).toHaveLength(12);
    expect(firstHandSizes).toHaveLength(12);
  });

  it("fails instead of replacing missing, illegal, or impersonated actions", () => {
    const options = { rulesConfiguration: four, handSeed: "headless-invalid" };
    expect(() =>
      runFirstHand({ ...options, createPolicy: () => () => undefined }),
    ).toThrow("策略未提供动作");
    expect(() =>
      runFirstHand({
        ...options,
        createPolicy: () => () => ({ type: "Pass" }),
      }),
    ).toThrow("pass-on-open-lead");
    expect(() =>
      runFirstHand({
        ...options,
        createPolicy: () => () => ({ type: "Play", cards: [] }),
      }),
    ).toThrow(/too_small/);
    expect(() =>
      runFirstHand({
        ...options,
        createPolicy: () =>
          (() => ({ type: "AbortMatch" })) as unknown as Policy,
      }),
    ).toThrow("首手策略只能出牌或不出");
    expect(() =>
      runFirstHand({
        ...options,
        createPolicy: () => (view, actor) => ({
          ...passivePolicy(view, actor)!,
          playerId: "impostor",
        }),
      }),
    ).toThrow(/unrecognized_keys/);
  });

  it("bounds execution and rejects malformed setup", () => {
    const options = { rulesConfiguration: four, handSeed: "headless-bounds" };
    expect(() => runFirstHand({ ...options, actionLimit: 1 })).toThrow(
      "动作上限",
    );
    for (const actionLimit of [0, -1, 1.5, Infinity, NaN]) {
      expect(() => runFirstHand({ ...options, actionLimit })).toThrow("正整数");
    }
    expect(() => runFirstHand({ ...options, handSeed: "" })).toThrow(
      "种子不能为空",
    );
    expect(() =>
      runFirstHand({
        ...options,
        rulesConfiguration: {
          ...four,
          wildcardRank: "invalid",
        } as unknown as RulesConfiguration,
      }),
    ).toThrow(/invalid_value/);
  });
});

describe("extracted passive policy", () => {
  const base: PassiveObservation = {
    lifecycle: "ACTIVE",
    rulesConfiguration: four,
    setupStage: "return-card-selection",
    pendingPlayerIds: ["p1"],
    hand: ["2S#1", "2H#1", "3S#1", "4S#1"],
  };

  it("waits when inactive or when another player must act", () => {
    expect(
      passivePolicy({ ...base, lifecycle: "LOBBY" }, "p1"),
    ).toBeUndefined();
    expect(passivePolicy(base, "p2")).toBeUndefined();
    expect(
      passivePolicy({ ...base, setupStage: "play", currentActor: "p2" }, "p1"),
    ).toBeUndefined();
  });

  it("retains Tribute selection, abstention, and both Return Card choices", () => {
    expect(
      passivePolicy(
        {
          ...base,
          setupStage: "tribute-selection",
          eligibleTributeCards: ["AS#1"],
        },
        "p1",
      ),
    ).toEqual({ type: "SelectTributeCard", card: "AS#1" });
    expect(
      passivePolicy(
        {
          ...base,
          setupStage: "leader-selection-tie",
          tieKind: "leader-selection",
          tieRound: 2,
        },
        "p1",
      ),
    ).toEqual({
      type: "SubmitTieChoiceBallot",
      tieKind: "leader-selection",
      round: 2,
      candidateId: null,
    });
    expect(passivePolicy(base, "p1")).toEqual({
      type: "SelectReturnCard",
      card: "2S#1",
    });
    expect(
      passivePolicy(
        {
          ...base,
          returnCandidates: [
            {
              giverId: "p1",
              giverSeat: 0,
              recipientId: "p2",
              recipientSeat: 1,
              tributeCard: "BIG#1",
              candidateCards: ["AS#1", "KS#1", "QS#1"],
            },
          ],
        },
        "p1",
      ),
    ).toEqual({ type: "SelectReturnCard", card: "AS#1" });
  });

  it("uses Challenge rules for distinct-rank joker Return offers", () => {
    const challenge = { ...base, effectiveRulesConfiguration: six };
    expect(
      passivePolicy(
        {
          ...challenge,
          tributeTransfers: [{ recipientId: "p1", card: "SMALL#1" }],
        },
        "p1",
      ),
    ).toEqual({
      type: "OfferReturnCandidates",
      candidateCards: ["2S#1", "3S#1"],
    });
    expect(
      passivePolicy(
        {
          ...challenge,
          tributeTransfers: [{ recipientId: "p1", card: "BIG#1" }],
        },
        "p1",
      ),
    ).toEqual({
      type: "OfferReturnCandidates",
      candidateCards: ["2S#1", "3S#1", "4S#1"],
    });
    expect(
      passivePolicy(
        {
          ...challenge,
          tributeTransfers: [{ recipientId: "p1", card: "AS#1" }],
        },
        "p1",
      ),
    ).toEqual({ type: "SelectReturnCard", card: "2S#1" });
  });
});

import { expect, it } from "vitest";
import {
  decide,
  derivePlayerView,
  evolve,
  type Command,
  type PlayerView,
  type State,
} from "@dglz/game-core";
import {
  decodeCardInstance,
  evaluatePlay,
  type CardInstanceCode,
} from "@dglz/game-rules";
import { rulesConfigurationPreset } from "@dglz/protocol";
import {
  ACTION_ENCODING_BOUNDS,
  MAX_LEGAL_ACTIONS,
  actionFeatures,
  cardFeatureId,
  createHandSession,
  legalActions,
  passivePolicy,
  runChallengeHand,
  type PolicyAction,
} from "../src/index.js";
import { subsequentTemplate } from "./support.js";

const ids = ["dglz-4p-2d-v1", "dglz-6p-3d-v1"] as const;
const decode = (code: string) => {
  const card = decodeCardInstance(code);
  if (!card.ok) throw new Error(code);
  return card.card;
};
const key = (action: PolicyAction) => JSON.stringify(action);

for (const rulesetId of ids) {
  it(`enumerates every small-hand subset, including finishing wildcards: ${rulesetId}`, () => {
    const session = createHandSession({
      mode: "first-hand",
      rulesConfiguration: rulesConfigurationPreset(rulesetId, "省心"),
      handSeed: "legal-subsets",
    });
    const playerId = session.currentPlayerId!;
    const base = session.observe(playerId);
    const hands: readonly (readonly CardInstanceCode[])[] = [
      ["2S#1", "2S#2", "3H#1", "4C#1", "5D#1", "SMALL#1", "BIG#1"],
      ["AS#1", "2S#1", "3S#1", "4S#1", "BIG#1"],
      ["SMALL#1", "SMALL#2", "BIG#1", "BIG#2"],
    ];
    const leads = [
      { cards: ["3S#2"], form: "single" },
      { cards: ["3S#2", "3H#2"], form: "pair" },
      { cards: ["3S#2", "3H#2", "3D#2"], form: "triple" },
      {
        cards: ["AH#2", "2H#2", "3D#2", "4H#2", "5H#2"],
        form: "mixed-suit-straight",
      },
      {
        cards: ["3H#2", "4H#2", "6H#2", "8H#2", "10H#2"],
        form: "flush",
      },
      {
        cards: ["3S#2", "3H#2", "3D#2", "4H#2", "4D#2"],
        form: "full-house",
      },
      {
        cards: ["3S#2", "3H#2", "3D#2", "3C#2", "4H#2"],
        form: "four-plus-one",
      },
      {
        cards: ["AH#2", "2H#2", "3H#2", "4H#2", "5H#2"],
        form: "straight-flush",
      },
      {
        cards: ["3S#2", "3H#2", "3D#2", "3C#2", "3D#1"],
        form: "five-of-a-kind",
      },
    ] satisfies readonly {
      cards: readonly CardInstanceCode[];
      form: string;
    }[];
    for (const preset of ["省心", "自主"] as const)
      for (const hand of hands) {
        const config = rulesConfigurationPreset(rulesetId, preset);
        for (const lead of [undefined, ...leads]) {
          const previous =
            lead === undefined
              ? undefined
              : evaluatePlay({
                  cards: lead.cards.map(decode),
                  configuration: config,
                  trumpRank: base.trumpRank!,
                  isFinishingPlay: false,
                });
          if (previous !== undefined && !previous.ok)
            throw new Error(`Invalid test lead: ${lead!.form}`);
          expect(previous?.play.form).toBe(lead?.form);
          expect(lead?.cards.some((card) => hand.includes(card)) ?? false).toBe(
            false,
          );
          const view: PlayerView = {
            ...base,
            rulesConfiguration: config,
            hand,
            ...(previous !== undefined
              ? {
                  unbeatenPlay: {
                    ...previous.play,
                    playerId: "other",
                    seatIndex: 1,
                    cards: lead!.cards,
                  },
                }
              : {}),
          };
          const expected: PolicyAction[] =
            previous !== undefined ? [{ type: "Pass" }] : [];
          // Independent power-set traversal: includes unsupported lengths and empty selection.
          for (let mask = 0; mask < 2 ** hand.length; mask++) {
            const cards = hand.filter((_, i) => (mask & (1 << i)) !== 0).sort();
            if (
              evaluatePlay({
                cards: cards.map(decode),
                configuration: config,
                trumpRank: base.trumpRank!,
                isFinishingPlay: cards.length === hand.length,
                ...(previous !== undefined
                  ? { previousPlay: previous.play }
                  : {}),
              }).ok
            )
              expected.push({ type: "Play", cards });
          }
          const actual = legalActions(view, playerId);
          expect(actual.map(key).sort()).toEqual(expected.map(key).sort());
          expect(new Set(actual.map(key)).size).toBe(actual.length);
          expect(
            legalActions({ ...view, hand: [...hand].reverse() }, playerId),
          ).toEqual(actual);
          expect(legalActions(view, "not-the-actor")).toEqual([]);
        }
      }
  });

  it(`generated choices pass independent engine decisions throughout setup: ${rulesetId}`, () => {
    const run = runChallengeHand({
      template: subsequentTemplate(
        rulesConfigurationPreset(rulesetId, "自主"),
        "phase-6-triple-27",
      ),
      record: true,
    });
    let state = evolve(undefined, run.events[0]!);
    const checked = new Set<string>();
    const cases: {
      state: State;
      playerId: string;
      view: PlayerView;
      action: PolicyAction;
    }[] = [];
    for (const step of run.record!.steps) {
      const command = step.command as Command;
      if (step.observationHash !== undefined && "playerId" in command) {
        const view = derivePlayerView(state, command.playerId);
        // All setup decisions; play samples use small actual hands to keep this check bounded.
        if (
          view.setupStage !== "play" ||
          (view.hand!.length <= 7 && !checked.has("play"))
        ) {
          const { playerId: _, ...payload } = command;
          cases.push({
            state,
            playerId: command.playerId,
            view,
            action: payload as PolicyAction,
          });
          checked.add(view.setupStage!);
          checked.add(command.type);
        }
      }
      for (const event of step.events)
        state = evolve(state, event as Parameters<typeof evolve>[1]);
    }
    for (const sample of cases) {
      const actions = legalActions(sample.view, sample.playerId);
      expect(
        actions
          .map((action) =>
            decide(sample.state, {
              ...action,
              playerId: sample.playerId,
            } as Command),
          )
          .filter((decision) => !decision.ok),
      ).toEqual([]);
      expect(
        actions.some(
          (action) =>
            JSON.stringify(actionFeatures(action, sample.view)) ===
            JSON.stringify(actionFeatures(sample.action, sample.view)),
        ),
      ).toBe(true);
    }
    expect([...checked]).toEqual(
      expect.arrayContaining([
        "tribute-selection",
        "recipient-pairing-tie",
        "return-card-selection",
        "leader-selection-tie",
        "play",
      ]),
    );
  }, 30000);
}

it("encodes physical copies and all action kinds without collisions or arbitrary truncation", () => {
  expect(cardFeatureId("2S#1")).toBe(1);
  expect(cardFeatureId("2S#2")).toBe(2);
  expect(cardFeatureId("BIG#3")).toBe(162);
  const choose = (n: number, k: number) =>
    Array.from({ length: k }, (_, i) => (n - i) / (i + 1)).reduce(
      (a, b) => a * b,
      1,
    );
  expect(MAX_LEGAL_ACTIONS).toBe(
    Math.round(1 + [1, 2, 3, 5].reduce((n, k) => n + choose(28, k), 0)),
  );
  const s = createHandSession({
    mode: "challenge",
    template: subsequentTemplate(
      rulesConfigurationPreset(ids[1], "自主"),
      "phase-6-triple-27",
    ),
  });
  const seen = new Set<string>();
  const observations = [];
  // Setup is cheap to enumerate; finish play with the existing passive policy.
  while (s.currentPlayerId !== undefined) {
    const actor = s.currentPlayerId;
    const view = s.observe(actor);
    if (view.setupStage !== "play") {
      observations.push(s.observeResearch(actor));
    }
    s.step(passivePolicy(view, actor));
  }
  for (const observation of observations) {
    const rows = observation.actionFeatures;
    expect(rows).toHaveLength(observation.legalActions.length);
    expect(new Set(rows.map((row) => JSON.stringify(row))).size).toBe(
      rows.length,
    );
    expect(
      rows.every(
        (row) =>
          row.length === 9 &&
          row.every(
            (value, i) =>
              Number.isInteger(value) &&
              value >= 0 &&
              value < ACTION_ENCODING_BOUNDS[i]!,
          ),
      ),
    ).toBe(true);
    observation.legalActions.forEach((action) => seen.add(action.type));
  }
  expect(seen).toEqual(
    new Set([
      "SelectTributeCard",
      "SubmitTieChoiceBallot",
      "OfferReturnCandidates",
      "SelectReturnCard",
    ]),
  );
  const final = s.observeResearch("p1");
  expect(final.legalActions).toEqual([]);
  expect(final.view.lifecycle).toBe("LOBBY");
  expect(
    final.publicHistory.some((event) => event.type === "CardsPlayed"),
  ).toBe(true);
  expect(
    final.publicHistory
      .filter((event) => event.type === "ReturnTransferred")
      .every((event) => !("card" in event)),
  ).toBe(true);
  expect(JSON.stringify(final)).not.toContain("phase-6-triple-27");
  expect(final.seatIndex).toBe(0);
  expect(final.teamIndex).toBe(0);
});

it("covers every setup subset, candidate ballot, and eligible physical card", () => {
  const s = createHandSession({
    mode: "first-hand",
    rulesConfiguration: rulesConfigurationPreset(ids[1], "自主"),
    handSeed: "setup-subsets",
  });
  const playerId = s.currentPlayerId!;
  const hand: readonly CardInstanceCode[] = [
    "2S#1",
    "2S#2",
    "3H#1",
    "4D#1",
    "SMALL#1",
    "BIG#1",
  ];
  const view: PlayerView = {
    ...s.observe(playerId),
    hand,
    setupStage: "return-card-selection",
    pendingPlayerIds: [playerId],
  };
  for (const card of ["AS#1", "SMALL#1", "BIG#1"] as const) {
    const own: PlayerView = {
      ...view,
      tributeTransfers: [
        {
          giverId: "giver",
          giverSeat: 1,
          recipientId: playerId,
          recipientSeat: 0,
          card,
          rank: decode(card).face.rank,
        },
      ],
    };
    const expected: PolicyAction[] = [];
    const count = card === "BIG#1" ? 3 : card === "SMALL#1" ? 2 : 1;
    for (let mask = 0; mask < 2 ** hand.length; mask++) {
      const cards = hand.filter((_, i) => (mask & (1 << i)) !== 0).sort();
      if (
        cards.length === count &&
        new Set(cards.map((code) => decode(code).face.rank)).size === count
      ) {
        expected.push(
          count === 1
            ? { type: "SelectReturnCard", card: cards[0]! }
            : { type: "OfferReturnCandidates", candidateCards: cards },
        );
      }
    }
    expect(legalActions(own, playerId).map(key).sort()).toEqual(
      expected.map(key).sort(),
    );
  }
  expect(
    legalActions(
      {
        ...view,
        setupStage: "tribute-selection",
        eligibleTributeCards: ["2S#1", "2S#2"],
      },
      playerId,
    ),
  ).toEqual([
    { type: "SelectTributeCard", card: "2S#1" },
    { type: "SelectTributeCard", card: "2S#2" },
  ]);
  expect(
    legalActions(
      {
        ...view,
        setupStage: "leader-selection-tie",
        tieKind: "leader-selection",
        tieRound: 3,
        tieCandidateIds: ["p1", "p2"],
      },
      playerId,
    ),
  ).toEqual(
    [null, "p1", "p2"].map((candidateId) => ({
      type: "SubmitTieChoiceBallot",
      tieKind: "leader-selection",
      round: 3,
      candidateId,
    })),
  );
  expect(legalActions({ ...view, pendingPlayerIds: [] }, playerId)).toEqual([]);
});

it("does not publish the selected Return Card to uninvolved players", () => {
  const observations = [];
  for (const choice of [0, 1]) {
    const s = createHandSession({
      mode: "challenge",
      template: subsequentTemplate(rulesConfigurationPreset(ids[0], "省心")),
    });
    const actor = s.currentPlayerId!;
    const view = s.observe(actor);
    expect(view.setupStage).toBe("return-card-selection");
    const transfer = view.tributeTransfers!.find(
      (item) => item.recipientId === actor,
    )!;
    const other = s.playerIds.find(
      (id) => id !== actor && id !== transfer.giverId,
    )!;
    s.step({ type: "SelectReturnCard", card: view.hand![choice]! });
    observations.push(s.observeResearch(other));
  }
  expect(observations[0]).toEqual(observations[1]);
});

it("keeps unseen ballots out of history/features and retains immutable public history", () => {
  const observations = [];
  const histories = [];
  for (const choice of [0, 1]) {
    const s = createHandSession({
      mode: "challenge",
      template: subsequentTemplate(
        rulesConfigurationPreset(ids[1], "自主"),
        "phase-6-triple-27",
      ),
      seatingPolicy: "randomized",
    });
    while (s.currentPlayerId !== undefined) {
      const actor = s.currentPlayerId;
      const view = s.observe(actor);
      if (view.tieKind === "recipient-pairing" && view.tieRound === 1) {
        const before = s.observeResearch(actor);
        s.step({
          type: "SubmitTieChoiceBallot",
          tieKind: view.tieKind,
          round: 1,
          candidateId: view.tieCandidateIds![choice]!,
        });
        const after = s.observeResearch(s.currentPlayerId!);
        observations.push(after);
        histories.push(before.publicHistory);
        break;
      }
      s.step(passivePolicy(view, actor));
    }
  }
  expect(observations).toHaveLength(2);
  expect(observations[0]).toEqual(observations[1]);
  expect(histories).toEqual(
    observations.map((observation) => observation.publicHistory),
  );
  expect(histories.every(Object.isFrozen)).toBe(true);
  expect(
    observations.every(
      (observation) => observation.teamIndex === observation.seatIndex % 2,
    ),
  ).toBe(true);
});

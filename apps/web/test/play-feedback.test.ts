import { expect, it } from "vitest";
import { selectionFeedback } from "../src/play-feedback";
import { errorMessage } from "../src/api";

const view: Parameters<typeof selectionFeedback>[0] = {
  hand: ["4C#1", "5D#1", "SMALL#1", "SMALL#2", "BIG#1"],
  trumpRank: "2",
  rulesConfiguration: {
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
  },
};

it("uses own remaining hand size for finishing-wildcard feedback", () => {
  expect(selectionFeedback(view, view.hand)).toMatchObject({
    ok: true,
    play: { form: "mixed-suit-straight", rank: "5" },
  });
  expect(
    selectionFeedback({ ...view, hand: [...view.hand, "AS#1"] }, view.hand),
  ).toMatchObject({ ok: true, play: { form: "four-plus-one" } });
});

it("evaluates a Challenge with its effective rules instead of the Room Match rules", () => {
  const challenge = {
    ...view,
    rulesConfiguration: {
      ...view.rulesConfiguration,
      finishingWildcardInterpretation: "normal" as const,
    },
    effectiveRulesConfiguration: view.rulesConfiguration,
  };
  expect(selectionFeedback(challenge, view.hand)).toMatchObject({
    ok: true,
    play: { form: "mixed-suit-straight", rank: "5" },
  });
  expect(
    selectionFeedback(
      { ...view, rulesConfiguration: challenge.rulesConfiguration },
      view.hand,
    ),
  ).toMatchObject({ ok: true, play: { form: "four-plus-one" } });
});

it("compares against the server's committed interpretation of the unbeaten play", () => {
  const hand: typeof view.hand = ["6C#1", "7D#1", "8S#1", "9H#1", "10C#1"];
  expect(
    selectionFeedback(
      {
        ...view,
        hand,
        unbeatenPlay: {
          playerId: "other",
          seatIndex: 1,
          cards: view.hand,
          form: "mixed-suit-straight",
          rank: "5",
          comparisonRanks: ["5"],
          representedFaces: ["4C", "5D", "AS", "2S", "3S"],
        },
      },
      hand,
    ),
  ).toMatchObject({
    ok: true,
    play: { form: "mixed-suit-straight", rank: "10" },
  });
});

it("gives actionable Chinese feedback for invalid selection and server rejection", () => {
  const result = selectionFeedback(view, view.hand.slice(0, 4));
  expect(result).toEqual({ ok: false, reason: "unsupported-card-count" });
  if (result.ok) throw new Error("expected-invalid-selection");
  expect(errorMessage("domain-rejected", result.reason)).toBe(
    "请选择 1、2、3 或 5 张牌。",
  );
  expect(errorMessage("domain-rejected", "card-not-in-hand")).toBe(
    "所选牌不在你的手牌中，请重新选择。",
  );
});

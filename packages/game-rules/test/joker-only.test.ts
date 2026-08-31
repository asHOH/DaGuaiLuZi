import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  decodeCardInstance,
  evaluatePlay,
  hasAutomaticResponseClosure,
  type CardInstance,
  type ClassifiedPlay,
  type EvaluatePlayResult,
  type FourPlayerRulesConfiguration,
  type RulesConfiguration,
  type SixPlayerRulesConfiguration,
  type TrumpRank,
} from "../src/index.js";

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

const JOKER_ONLY_FIXTURES = [
  ["SMALL#1"],
  ["BIG#1"],
  ["SMALL#1", "SMALL#2"],
  ["SMALL#1", "BIG#1"],
  ["BIG#1", "BIG#2"],
  ["SMALL#1", "SMALL#2", "SMALL#3"],
  ["SMALL#1", "SMALL#2", "BIG#1"],
  ["SMALL#1", "BIG#1", "BIG#2"],
  ["BIG#1", "BIG#2", "BIG#3"],
  ["SMALL#1", "SMALL#2", "SMALL#3", "BIG#1", "BIG#2"],
  ["BIG#1", "BIG#2", "BIG#3", "SMALL#1", "SMALL#2"],
] as const;

describe("Joker-only Play interpretation", () => {
  it.each([
    [["SMALL#1"], "single", "SMALL", ["SMALL"]],
    [["BIG#1"], "single", "BIG", ["BIG"]],
    [["SMALL#1", "BIG#1"], "pair", "SMALL", ["SMALL", "SMALL"]],
    [["BIG#1", "BIG#2"], "pair", "BIG", ["BIG", "BIG"]],
    [
      ["SMALL#1", "BIG#1", "BIG#2"],
      "triple",
      "SMALL",
      ["SMALL", "SMALL", "SMALL"],
    ],
    [["BIG#1", "BIG#2", "BIG#3"], "triple", "BIG", ["BIG", "BIG", "BIG"]],
    [
      ["SMALL#1", "SMALL#2", "SMALL#3", "BIG#1", "BIG#2"],
      "five-of-a-kind",
      "SMALL",
      ["SMALL", "SMALL", "SMALL", "SMALL", "SMALL"],
    ],
  ] as const)(
    "classifies %j as %s ranked %s",
    (cards, form, rank, representedFaces) => {
      expect(evaluateLead(cards, SIX_PLAYER_CONFIGURATION, "5")).toMatchObject({
        ok: true,
        play: { form, rank, representedFaces },
      });
    },
  );

  it("keeps ordinary wildcard interpretation and Trump Rank out of Joker-only Plays", () => {
    const reorderedPlay = fc
      .constantFrom(...JOKER_ONLY_FIXTURES)
      .chain((cards) =>
        fc.shuffledSubarray([...cards], {
          minLength: cards.length,
          maxLength: cards.length,
        }),
      );

    fc.assert(
      fc.property(
        reorderedPlay,
        fc.constantFrom<"weakest-rank" | "strongest-rank">(
          "weakest-rank",
          "strongest-rank",
        ),
        fc.constantFrom<"normal" | "weakest-form-and-rank">(
          "normal",
          "weakest-form-and-rank",
        ),
        fc.constantFrom<TrumpRank>("2", "3", "4", "5"),
        fc.boolean(),
        (
          cards,
          wildcardRank,
          finishingWildcardInterpretation,
          trumpRank,
          isFinishingPlay,
        ) => {
          const configuration: SixPlayerRulesConfiguration = {
            ...SIX_PLAYER_CONFIGURATION,
            wildcardRank,
            finishingWildcardInterpretation,
          };
          const result = evaluate({
            cards,
            configuration,
            trumpRank,
            isFinishingPlay,
          });
          const baseline = legalLead(cards, SIX_PLAYER_CONFIGURATION, "5");

          expect(result.ok).toBe(true);
          if (!result.ok) {
            return;
          }
          expect(playMeaning(result.play)).toEqual(playMeaning(baseline));
        },
      ),
    );
  });
});

describe("Joker-only Play comparison", () => {
  it("makes all-BIG Plays stronger than SMALL-ranked Plays", () => {
    const smallSingle = legalLead(["SMALL#1"], SIX_PLAYER_CONFIGURATION, "5");
    const smallTriple = legalLead(
      ["SMALL#1", "SMALL#2", "BIG#1"],
      SIX_PLAYER_CONFIGURATION,
      "5",
    );

    expect(
      evaluateResponse(["BIG#1"], smallSingle, SIX_PLAYER_CONFIGURATION, "5")
        .ok,
    ).toBe(true);
    expect(
      evaluateResponse(
        ["BIG#1", "BIG#2", "BIG#3"],
        smallTriple,
        SIX_PLAYER_CONFIGURATION,
        "5",
      ).ok,
    ).toBe(true);
  });

  it("ties Double SMALL with the mixed pair under Tie", () => {
    const mixed = legalLead(
      ["SMALL#1", "BIG#1"],
      SIX_PLAYER_CONFIGURATION,
      "5",
    );

    expect(
      evaluateResponse(
        ["SMALL#2", "SMALL#3"],
        mixed,
        SIX_PLAYER_CONFIGURATION,
        "5",
      ),
    ).toEqual({ ok: false, reason: "response-not-stronger" });
  });

  it("makes Double SMALL stronger than the mixed pair under Double SMALL higher", () => {
    const configuration: SixPlayerRulesConfiguration = {
      ...SIX_PLAYER_CONFIGURATION,
      jokerPairComparison: "two-small-jokers-win",
    };
    const mixed = legalLead(["SMALL#1", "BIG#1"], configuration, "5");
    const doubleSmall = legalLead(["SMALL#2", "SMALL#3"], configuration, "5");

    expect(
      evaluateResponse(["SMALL#2", "SMALL#3"], mixed, configuration, "5").ok,
    ).toBe(true);
    expect(
      evaluateResponse(["SMALL#1", "BIG#1"], doubleSmall, configuration, "5"),
    ).toEqual({ ok: false, reason: "response-not-stronger" });
  });

  it("uses the fixed pair tie in 4p2d", () => {
    const mixed = legalLead(
      ["SMALL#1", "BIG#1"],
      FOUR_PLAYER_CONFIGURATION,
      "5",
    );

    expect(
      evaluateResponse(
        ["SMALL#1", "SMALL#2"],
        mixed,
        FOUR_PLAYER_CONFIGURATION,
        "5",
      ),
    ).toEqual({ ok: false, reason: "response-not-stronger" });
  });

  it("ties every non-all-BIG Joker-only Triple", () => {
    const incumbent = legalLead(
      ["SMALL#1", "SMALL#2", "BIG#1"],
      SIX_PLAYER_CONFIGURATION,
      "5",
    );

    expect(
      evaluateResponse(
        ["SMALL#3", "BIG#2", "BIG#3"],
        incumbent,
        SIX_PLAYER_CONFIGURATION,
        "5",
      ),
    ).toEqual({ ok: false, reason: "response-not-stronger" });
  });

  it("ranks every five-joker play above a natural Five of a Kind", () => {
    const naturalFiveOfAKind = legalLead(
      ["AS#1", "AS#2", "AH#1", "AH#2", "AD#1"],
      SIX_PLAYER_CONFIGURATION,
      "5",
    );

    expect(
      evaluateResponse(
        ["SMALL#1", "SMALL#2", "SMALL#3", "BIG#1", "BIG#2"],
        naturalFiveOfAKind,
        SIX_PLAYER_CONFIGURATION,
        "5",
      ).ok,
    ).toBe(true);
  });
});

describe("Automatic Response Closure", () => {
  it.each([
    [["SMALL#1"], false],
    [["BIG#1"], true],
    [["SMALL#1", "SMALL#2"], false],
    [["SMALL#1", "BIG#1"], false],
    [["BIG#1", "BIG#2"], true],
    [["SMALL#1", "SMALL#2", "SMALL#3"], false],
    [["SMALL#1", "SMALL#2", "BIG#1"], true],
    [["SMALL#1", "BIG#1", "BIG#2"], true],
    [["BIG#1", "BIG#2", "BIG#3"], true],
    [["SMALL#1", "SMALL#2", "SMALL#3", "BIG#1", "BIG#2"], true],
    [["BIG#1", "BIG#2", "BIG#3", "SMALL#1", "SMALL#2"], true],
    [["8S#1", "BIG#1"], false],
  ] as const)("visible pattern %j closes responses: %s", (cards, expected) => {
    const play = legalLead(cards, SIX_PLAYER_CONFIGURATION, "5");

    expect(hasAutomaticResponseClosure(play)).toBe(expected);
  });
});

function evaluate(input: {
  cards: readonly string[];
  configuration: RulesConfiguration;
  trumpRank: TrumpRank;
  isFinishingPlay: boolean;
  previousPlay?: ClassifiedPlay;
}): EvaluatePlayResult {
  return evaluatePlay({
    cards: input.cards.map(decode),
    configuration: input.configuration,
    trumpRank: input.trumpRank,
    isFinishingPlay: input.isFinishingPlay,
    ...(input.previousPlay === undefined
      ? {}
      : { previousPlay: input.previousPlay }),
  });
}

function evaluateLead(
  cards: readonly string[],
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
): EvaluatePlayResult {
  return evaluate({ cards, configuration, trumpRank, isFinishingPlay: false });
}

function legalLead(
  cards: readonly string[],
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
): ClassifiedPlay {
  const result = evaluateLead(cards, configuration, trumpRank);
  if (!result.ok) {
    throw new Error(`Expected a legal test play, received: ${result.reason}`);
  }
  return result.play;
}

function evaluateResponse(
  cards: readonly string[],
  previousPlay: ClassifiedPlay,
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
): EvaluatePlayResult {
  return evaluate({
    cards,
    configuration,
    trumpRank,
    isFinishingPlay: false,
    previousPlay,
  });
}

function decode(code: string): CardInstance {
  const result = decodeCardInstance(code);
  if (!result.ok) {
    throw new Error(`Invalid test Card Instance code: ${code}`);
  }
  return result.card;
}

function playMeaning(play: ClassifiedPlay) {
  return {
    form: play.form,
    rank: play.rank,
    representedFaces: [...play.representedFaces].sort(),
    comparisonRanks: play.comparisonRanks,
  };
}

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  decodeCardInstance,
  evaluatePlay,
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

const DOCUMENTED_EXAMPLE = [
  "4C#1",
  "5D#1",
  "SMALL#1",
  "SMALL#2",
  "BIG#1",
] as const;

const FINISHING_WILDCARD_FIXTURES: readonly (readonly string[])[] = [
  DOCUMENTED_EXAMPLE,
  ["9H#1", "10H#1", "JH#1", "QH#1", "SMALL#1"],
  ["AS#1", "9S#1", "7S#1", "4S#1", "BIG#1"],
  ["8S#1", "8H#1", "9S#1", "9H#1", "SMALL#1"],
  ["2S#1", "3H#1", "4D#1", "5C#1", "SMALL#1"],
];

describe("Finishing Wildcard Interpretation", () => {
  it.each([
    ["6p3d", SIX_PLAYER_CONFIGURATION],
    ["4p2d", FOUR_PLAYER_CONFIGURATION],
  ] as const)(
    "uses the documented weakest form and rank in %s",
    (_ruleset, configuration) => {
      expect(
        evaluate(DOCUMENTED_EXAMPLE, configuration, "3", true),
      ).toMatchObject({
        ok: true,
        play: {
          form: "mixed-suit-straight",
          rank: "5",
          representedFaces: ["4C", "5D", "2S", "3S", "AS"],
        },
      });
    },
  );

  it("uses normal interpretation when the wildcard play is not finishing", () => {
    expect(
      evaluate(DOCUMENTED_EXAMPLE, SIX_PLAYER_CONFIGURATION, "3", false),
    ).toMatchObject({
      ok: true,
      play: { form: "four-plus-one", rank: "5" },
    });
  });

  it("uses normal interpretation for a finishing play under Normal", () => {
    const normal = withSharedOverrides(SIX_PLAYER_CONFIGURATION, {
      finishingWildcardInterpretation: "normal",
    });
    const normalWithWeakestRank = withSharedOverrides(normal, {
      wildcardRank: "weakest-rank",
    });

    expect(evaluate(DOCUMENTED_EXAMPLE, normal, "3", true)).toMatchObject({
      ok: true,
      play: { form: "four-plus-one", rank: "5" },
    });
    expect(
      evaluate(DOCUMENTED_EXAMPLE, normalWithWeakestRank, "3", true),
    ).toMatchObject({
      ok: true,
      play: { form: "four-plus-one", rank: "4" },
    });
  });

  it("uses the weakest rank when the weakest legal form is fixed", () => {
    expect(
      evaluate(
        ["AS#1", "9S#1", "7S#1", "4S#1", "BIG#1"],
        SIX_PLAYER_CONFIGURATION,
        "5",
        true,
      ),
    ).toMatchObject({
      ok: true,
      play: {
        form: "flush",
        rank: "A",
        representedFaces: ["AS", "9S", "7S", "4S", "2S"],
      },
    });
  });

  it("does not alter a finishing play without a wildcard", () => {
    expect(
      evaluate(
        ["10H#1", "JH#1", "QH#1", "KH#1", "AH#1"],
        SIX_PLAYER_CONFIGURATION,
        "5",
        true,
      ),
    ).toMatchObject({
      ok: true,
      play: { form: "straight-flush", rank: "A" },
    });
  });

  it("keeps the sole legal form of a two- or three-card wildcard play", () => {
    expect(
      evaluate(["8S#1", "BIG#1"], SIX_PLAYER_CONFIGURATION, "5", true),
    ).toMatchObject({ ok: true, play: { form: "pair", rank: "8" } });
    expect(
      evaluate(
        ["QH#1", "SMALL#1", "BIG#1"],
        SIX_PLAYER_CONFIGURATION,
        "5",
        true,
      ),
    ).toMatchObject({ ok: true, play: { form: "triple", rank: "Q" } });
  });

  it("uses the finishing interpretation when deciding whether a response is stronger", () => {
    const previousPlay = legalPlay(
      ["3S#1", "3H#1", "3D#1", "2S#1", "2H#1"],
      SIX_PLAYER_CONFIGURATION,
      "3",
      false,
    );
    const normal = withSharedOverrides(SIX_PLAYER_CONFIGURATION, {
      finishingWildcardInterpretation: "normal",
    });

    expect(
      evaluateResponse(DOCUMENTED_EXAMPLE, previousPlay, normal, "3", true).ok,
    ).toBe(true);
    expect(
      evaluateResponse(
        DOCUMENTED_EXAMPLE,
        previousPlay,
        SIX_PLAYER_CONFIGURATION,
        "3",
        true,
      ),
    ).toEqual({ ok: false, reason: "response-not-stronger" });
  });

  it("overrides Wildcard Rank and remains invariant under card order", () => {
    const generatedCase = fc
      .tuple(
        fc.constantFrom(...FINISHING_WILDCARD_FIXTURES),
        fc.constantFrom<RulesConfiguration>(
          SIX_PLAYER_CONFIGURATION,
          FOUR_PLAYER_CONFIGURATION,
        ),
      )
      .chain(([cards, configuration]) =>
        fc
          .shuffledSubarray([...cards], {
            minLength: cards.length,
            maxLength: cards.length,
          })
          .map((reordered) => ({ cards, configuration, reordered })),
      );

    fc.assert(
      fc.property(generatedCase, ({ cards, configuration, reordered }) => {
        const strongestRank = legalPlay(
          cards,
          withSharedOverrides(configuration, {
            wildcardRank: "strongest-rank",
          }),
          "5",
          true,
        );
        const weakestRank = legalPlay(
          reordered,
          withSharedOverrides(configuration, {
            wildcardRank: "weakest-rank",
          }),
          "5",
          true,
        );

        expect(playMeaning(weakestRank)).toEqual(playMeaning(strongestRank));
      }),
    );
  });

  it("never selects a play stronger than normal interpretation", () => {
    const generatedCase = fc.constantFrom(...FINISHING_WILDCARD_FIXTURES);

    fc.assert(
      fc.property(generatedCase, (cards) => {
        const normalConfiguration = withSharedOverrides(
          SIX_PLAYER_CONFIGURATION,
          { finishingWildcardInterpretation: "normal" },
        );
        const normalPlay = legalPlay(cards, normalConfiguration, "5", true);

        expect(
          evaluateResponse(
            cards,
            normalPlay,
            SIX_PLAYER_CONFIGURATION,
            "5",
            true,
          ).ok,
        ).toBe(false);
      }),
    );
  });
});

function withSharedOverrides(
  configuration: RulesConfiguration,
  overrides: Partial<
    Pick<
      SixPlayerRulesConfiguration,
      "finishingWildcardInterpretation" | "wildcardRank"
    >
  >,
): RulesConfiguration {
  return { ...configuration, ...overrides };
}

function evaluate(
  cards: readonly string[],
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
  isFinishingPlay: boolean,
  previousPlay?: ClassifiedPlay,
): EvaluatePlayResult {
  return evaluatePlay({
    cards: cards.map(decode),
    configuration,
    trumpRank,
    isFinishingPlay,
    ...(previousPlay === undefined ? {} : { previousPlay }),
  });
}

function legalPlay(
  cards: readonly string[],
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
  isFinishingPlay: boolean,
): ClassifiedPlay {
  const result = evaluate(cards, configuration, trumpRank, isFinishingPlay);
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
  isFinishingPlay: boolean,
): EvaluatePlayResult {
  return evaluate(
    cards,
    configuration,
    trumpRank,
    isFinishingPlay,
    previousPlay,
  );
}

function decode(code: string): CardInstance {
  const result = decodeCardInstance(code);
  if (!result.ok) {
    throw new Error(`Invalid test Card Instance code: ${code}`);
  }
  return result.card;
}

function playMeaning(play: ClassifiedPlay) {
  const representedByInstance = play.cards
    .map((card, index) => [card.code, play.representedFaces[index]] as const)
    .sort(([left], [right]) => left.localeCompare(right));

  return {
    form: play.form,
    rank: play.rank,
    comparisonRanks: play.comparisonRanks,
    representedByInstance,
  };
}

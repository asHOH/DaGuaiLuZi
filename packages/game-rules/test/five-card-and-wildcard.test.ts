import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  decodeCardInstance,
  evaluatePlay,
  type CardInstance,
  type ClassifiedPlay,
  type EvaluatePlayResult,
  type RulesConfiguration,
  type SixPlayerRulesConfiguration,
  type TrumpRank,
} from "../src/index.js";

const BASE_CONFIGURATION: SixPlayerRulesConfiguration = {
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

const FORM_FIXTURES = [
  {
    form: "mixed-suit-straight",
    rank: "5",
    cards: ["AS#1", "2H#1", "3D#1", "4C#1", "5S#1"],
  },
  {
    form: "flush",
    rank: "A",
    cards: ["AS#1", "KS#1", "9S#1", "6S#1", "2S#1"],
  },
  {
    form: "full-house",
    rank: "Q",
    cards: ["QH#1", "QD#1", "QS#1", "9H#1", "9D#1"],
  },
  {
    form: "four-plus-one",
    rank: "J",
    cards: ["JH#1", "JD#1", "JS#1", "JC#1", "3S#1"],
  },
  {
    form: "straight-flush",
    rank: "A",
    cards: ["10H#1", "JH#1", "QH#1", "KH#1", "AH#1"],
  },
  {
    form: "five-of-a-kind",
    rank: "7",
    cards: ["7S#1", "7S#2", "7H#1", "7H#2", "7D#1"],
  },
] as const;

const WILDCARD_FIXTURES: readonly (readonly string[])[] = [
  ["4C#1", "5D#1", "SMALL#1", "SMALL#2", "BIG#1"],
  ["9H#1", "10H#1", "JH#1", "QH#1", "SMALL#1"],
  ["AS#1", "9S#1", "7S#1", "4S#1", "BIG#1"],
  ["2S#1", "3H#1", "4D#1", "5C#1", "SMALL#1"],
];

describe("natural five-card plays", () => {
  it.each(FORM_FIXTURES)("classifies $form", ({ cards, form, rank }) => {
    expect(evaluateLead(cards, BASE_CONFIGURATION, "4")).toMatchObject({
      ok: true,
      play: { cardCount: 5, form, rank },
    });
  });

  it("chooses the strongest form when the same cards form a flush and full house", () => {
    expect(
      evaluateLead(
        ["7S#1", "7S#2", "7S#3", "9S#1", "9S#2"],
        BASE_CONFIGURATION,
        "4",
      ),
    ).toMatchObject({ ok: true, play: { form: "full-house", rank: "7" } });
  });

  it("rejects a five-card selection with no legal form", () => {
    expect(
      evaluateLead(
        ["2S#1", "2H#1", "3D#1", "4C#1", "6S#1"],
        BASE_CONFIGURATION,
        "5",
      ),
    ).toEqual({ ok: false, reason: "cards-do-not-form-legal-play" });
  });

  it("orders every pair of five-card forms as documented", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: FORM_FIXTURES.length - 1 }),
        fc.integer({ min: 0, max: FORM_FIXTURES.length - 1 }),
        (incumbentIndex, challengerIndex) => {
          const incumbent = FORM_FIXTURES[incumbentIndex];
          const challenger = FORM_FIXTURES[challengerIndex];
          if (incumbent === undefined || challenger === undefined) {
            throw new Error("Missing form fixture");
          }

          const previousPlay = legalLead(
            incumbent.cards,
            BASE_CONFIGURATION,
            "4",
          );
          const result = evaluateResponse(
            challenger.cards,
            previousPlay,
            BASE_CONFIGURATION,
            "4",
          );

          expect(result.ok).toBe(challengerIndex > incumbentIndex);
        },
      ),
    );
  });

  it("compares straights by natural position even when a contained rank is Trump", () => {
    const wheel = legalLead(FORM_FIXTURES[0].cards, BASE_CONFIGURATION, "2");

    expect(
      evaluateResponse(
        ["2S#2", "3H#2", "4D#2", "5C#2", "6S#1"],
        wheel,
        BASE_CONFIGURATION,
        "2",
      ).ok,
    ).toBe(true);
  });

  it.each([
    [
      "full-house",
      ["9S#1", "9H#1", "9D#1", "AS#1", "AH#1"],
      ["10S#1", "10H#1", "10D#1", "2S#1", "2H#1"],
    ],
    [
      "four-plus-one",
      ["9S#1", "9H#1", "9D#1", "9C#1", "AS#1"],
      ["10S#1", "10H#1", "10D#1", "10C#1", "2S#1"],
    ],
    [
      "five-of-a-kind",
      ["9S#1", "9S#2", "9H#1", "9H#2", "9D#1"],
      ["10S#1", "10S#2", "10H#1", "10H#2", "10D#1"],
    ],
  ])("compares %s by its repeated rank", (_form, lower, higher) => {
    expect(
      evaluateResponse(
        higher,
        legalLead(lower, BASE_CONFIGURATION, "5"),
        BASE_CONFIGURATION,
        "5",
      ).ok,
    ).toBe(true);
  });

  it("applies both Flush Tie-Breaking settings", () => {
    const incumbentCards = ["AS#1", "9S#1", "7S#1", "6S#1", "3S#1"];
    const challengerCards = ["AH#1", "10H#1", "8H#1", "5H#1", "2H#1"];
    const descending = configuration({ flushTieBreaking: "descending-ranks" });
    const highestOnly = configuration({
      flushTieBreaking: "highest-card-only",
    });

    expect(
      evaluateResponse(
        challengerCards,
        legalLead(incumbentCards, descending, "4"),
        descending,
        "4",
      ).ok,
    ).toBe(true);
    expect(
      evaluateResponse(
        challengerCards,
        legalLead(incumbentCards, highestOnly, "4"),
        highestOnly,
        "4",
      ),
    ).toEqual({ ok: false, reason: "response-not-stronger" });
  });

  it("ranks a flush containing the Trump Rank above an Ace-high flush", () => {
    const incumbent = legalLead(
      ["AS#1", "KS#1", "QS#1", "9S#1", "8S#1"],
      BASE_CONFIGURATION,
      "5",
    );

    expect(
      evaluateResponse(
        ["5H#1", "2H#1", "3H#1", "7H#1", "8H#1"],
        incumbent,
        BASE_CONFIGURATION,
        "5",
      ).ok,
    ).toBe(true);
  });
});

describe("general wildcard interpretation", () => {
  it.each([
    [["8S#1", "BIG#1"], "pair", "8", ["8S", "8S"]],
    [["QH#1", "SMALL#1", "BIG#1"], "triple", "Q", ["QH", "QS", "QS"]],
  ] as const)(
    "uses jokers as wildcards in a %s",
    (cards, form, rank, representedFaces) => {
      expect(evaluateLead(cards, BASE_CONFIGURATION, "5")).toMatchObject({
        ok: true,
        play: { form, rank, representedFaces },
      });
    },
  );

  it("chooses the strongest legal form before choosing its strongest rank", () => {
    expect(
      evaluateLead(WILDCARD_FIXTURES[0]!, BASE_CONFIGURATION, "3"),
    ).toMatchObject({
      ok: true,
      play: { form: "four-plus-one", rank: "5" },
    });
  });

  it("chooses the weakest rank within the strongest legal form when configured", () => {
    const weakest = configuration({ wildcardRank: "weakest-rank" });

    expect(evaluateLead(WILDCARD_FIXTURES[0]!, weakest, "3")).toMatchObject({
      ok: true,
      play: { form: "four-plus-one", rank: "4" },
    });
  });

  it("chooses the configured straight-flush rank", () => {
    const cards = WILDCARD_FIXTURES[1]!;

    expect(evaluateLead(cards, BASE_CONFIGURATION, "5")).toMatchObject({
      ok: true,
      play: { form: "straight-flush", rank: "K" },
    });
    expect(
      evaluateLead(cards, configuration({ wildcardRank: "weakest-rank" }), "5"),
    ).toMatchObject({
      ok: true,
      play: { form: "straight-flush", rank: "Q" },
    });
  });

  it("forms a full house with a wildcard and selects its configured triple rank", () => {
    const cards = ["8S#1", "8H#1", "9S#1", "9H#1", "SMALL#1"];

    expect(evaluateLead(cards, BASE_CONFIGURATION, "5")).toMatchObject({
      ok: true,
      play: { form: "full-house", rank: "9" },
    });
    expect(
      evaluateLead(cards, configuration({ wildcardRank: "weakest-rank" }), "5"),
    ).toMatchObject({
      ok: true,
      play: { form: "full-house", rank: "8" },
    });
  });

  it("forms five of a kind from one natural card and four wildcards", () => {
    expect(
      evaluateLead(
        ["7S#1", "SMALL#1", "SMALL#2", "BIG#1", "BIG#2"],
        BASE_CONFIGURATION,
        "5",
      ),
    ).toMatchObject({
      ok: true,
      play: {
        form: "five-of-a-kind",
        rank: "7",
        representedFaces: ["7S", "7S", "7S", "7S", "7S"],
      },
    });
  });

  it("represents every wildcard in a strongest-rank flush as the suited Trump Rank", () => {
    expect(
      evaluateLead(WILDCARD_FIXTURES[2]!, BASE_CONFIGURATION, "5"),
    ).toMatchObject({
      ok: true,
      play: {
        form: "flush",
        rank: "5",
        representedFaces: ["AS", "9S", "7S", "4S", "5S"],
      },
    });
  });

  it("uses the weakest ordinary rank for a weakest-rank flush", () => {
    expect(
      evaluateLead(
        WILDCARD_FIXTURES[2]!,
        configuration({ wildcardRank: "weakest-rank" }),
        "5",
      ),
    ).toMatchObject({
      ok: true,
      play: {
        form: "flush",
        representedFaces: ["AS", "9S", "7S", "4S", "2S"],
      },
    });
  });

  it("selects between multiple mixed-suit straight interpretations by rank", () => {
    const cards = WILDCARD_FIXTURES[3]!;

    expect(evaluateLead(cards, BASE_CONFIGURATION, "3")).toMatchObject({
      ok: true,
      play: { form: "mixed-suit-straight", rank: "6" },
    });
    expect(
      evaluateLead(cards, configuration({ wildcardRank: "weakest-rank" }), "3"),
    ).toMatchObject({
      ok: true,
      play: { form: "mixed-suit-straight", rank: "5" },
    });
  });

  it("uses normal wildcard interpretation for a finishing play when configured", () => {
    const normalFinishing = configuration({
      finishingWildcardInterpretation: "normal",
    });
    const result = evaluatePlay({
      cards: WILDCARD_FIXTURES[0]!.map(decode),
      configuration: normalFinishing,
      trumpRank: "3",
      isFinishingPlay: true,
    });

    expect(result).toMatchObject({
      ok: true,
      play: { form: "four-plus-one", rank: "5" },
    });
  });

  it("keeps classification and wildcard-to-instance assignments invariant under card order", () => {
    const fixtures = [
      ...FORM_FIXTURES.map((fixture) => fixture.cards),
      ...WILDCARD_FIXTURES,
    ];
    const reorderedFixture = fc.constantFrom(...fixtures).chain((cards) =>
      fc
        .shuffledSubarray([...cards], {
          minLength: cards.length,
          maxLength: cards.length,
        })
        .map((reordered) => ({ cards, reordered })),
    );

    fc.assert(
      fc.property(reorderedFixture, ({ cards, reordered }) => {
        const original = legalLead(cards, BASE_CONFIGURATION, "4");
        const permuted = legalLead(reordered, BASE_CONFIGURATION, "4");

        expect(playMeaning(permuted)).toEqual(playMeaning(original));
      }),
    );
  });
});

function configuration(
  overrides: Partial<SixPlayerRulesConfiguration>,
): SixPlayerRulesConfiguration {
  return { ...BASE_CONFIGURATION, ...overrides };
}

function decode(code: string): CardInstance {
  const result = decodeCardInstance(code);
  if (!result.ok) {
    throw new Error(`Invalid test Card Instance code: ${code}`);
  }
  return result.card;
}

function evaluateLead(
  codes: readonly string[],
  rulesConfiguration: RulesConfiguration,
  trumpRank: TrumpRank,
): EvaluatePlayResult {
  return evaluatePlay({
    cards: codes.map(decode),
    configuration: rulesConfiguration,
    trumpRank,
    isFinishingPlay: false,
  });
}

function legalLead(
  codes: readonly string[],
  rulesConfiguration: RulesConfiguration,
  trumpRank: TrumpRank,
): ClassifiedPlay {
  const result = evaluateLead(codes, rulesConfiguration, trumpRank);
  if (!result.ok) {
    throw new Error(`Expected a legal test play, received: ${result.reason}`);
  }
  return result.play;
}

function evaluateResponse(
  codes: readonly string[],
  previousPlay: ClassifiedPlay,
  rulesConfiguration: RulesConfiguration,
  trumpRank: TrumpRank,
): EvaluatePlayResult {
  return evaluatePlay({
    cards: codes.map(decode),
    configuration: rulesConfiguration,
    trumpRank,
    isFinishingPlay: false,
    previousPlay,
  });
}

function playMeaning(play: ClassifiedPlay) {
  const wildcardAssignments = play.cards
    .map((card, index) => [card.code, play.representedFaces[index]] as const)
    .filter(([code]) => code.startsWith("SMALL") || code.startsWith("BIG"))
    .sort(([left], [right]) => left.localeCompare(right));

  return {
    form: play.form,
    rank: play.rank,
    comparisonRanks: play.comparisonRanks,
    wildcardAssignments,
  };
}

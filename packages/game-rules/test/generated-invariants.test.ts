import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  decodeCardInstance,
  evaluatePlay,
  type CardFaceCode,
  type CardInstance,
  type ClassifiedPlay,
  type FourPlayerRulesConfiguration,
  type RulesConfiguration,
  type SixPlayerRulesConfiguration,
  type StandardRank,
  type Suit,
  type TrumpRank,
} from "../src/index.js";

const RANKS: readonly StandardRank[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
];
const SUITS: readonly Suit[] = ["S", "H", "D", "C"];
const TRUMP_RANKS: readonly TrumpRank[] = ["2", "3", "4", "5"];
const STRAIGHTS: readonly (readonly StandardRank[])[] = [
  ["A", "2", "3", "4", "5"],
  ["2", "3", "4", "5", "6"],
  ["3", "4", "5", "6", "7"],
  ["4", "5", "6", "7", "8"],
  ["5", "6", "7", "8", "9"],
  ["6", "7", "8", "9", "10"],
  ["7", "8", "9", "10", "J"],
  ["8", "9", "10", "J", "Q"],
  ["9", "10", "J", "Q", "K"],
  ["10", "J", "Q", "K", "A"],
];
const NON_STRAIGHT_FLUSH_RANKS: readonly (readonly StandardRank[])[] = [
  ["2", "4", "7", "9", "K"],
  ["3", "6", "8", "J", "A"],
  ["2", "5", "8", "10", "Q"],
];

const SIX_PLAYER_JOKERS = [
  "SMALL#1",
  "SMALL#2",
  "SMALL#3",
  "BIG#1",
  "BIG#2",
  "BIG#3",
] as const;
const FOUR_PLAYER_JOKERS = ["SMALL#1", "SMALL#2", "BIG#1", "BIG#2"] as const;

const SIX_PLAYER_CONFIGURATIONS = createSixPlayerConfigurations();
const FOUR_PLAYER_CONFIGURATIONS = createFourPlayerConfigurations();

const sixPlayerPlayArbitraries = createPlayArbitraries(3, SIX_PLAYER_JOKERS);
const fourPlayerPlayArbitraries = createPlayArbitraries(2, FOUR_PLAYER_JOKERS);

type GeneratedCase = Readonly<{
  cards: readonly string[];
  configuration: RulesConfiguration;
  trumpRank: TrumpRank;
  isFinishingPlay: boolean;
}>;

const generatedCaseArbitrary: fc.Arbitrary<GeneratedCase> = fc.oneof(
  createGeneratedCaseArbitrary(
    SIX_PLAYER_CONFIGURATIONS,
    sixPlayerPlayArbitraries.any,
  ),
  createGeneratedCaseArbitrary(
    FOUR_PLAYER_CONFIGURATIONS,
    fourPlayerPlayArbitraries.any,
  ),
);

const reorderedCaseArbitrary = generatedCaseArbitrary.chain((generated) =>
  fc
    .shuffledSubarray([...generated.cards], {
      minLength: generated.cards.length,
      maxLength: generated.cards.length,
    })
    .map((reordered) => ({ generated, reordered })),
);

describe("generated game-rule invariants", () => {
  it("conserves cards, returns a valid declared form, and ignores input order", () => {
    fc.assert(
      fc.property(reorderedCaseArbitrary, ({ generated, reordered }) => {
        const originalCards = generated.cards.map(decode);
        const originalSnapshot = JSON.stringify(originalCards);
        const original = requireLegalPlay(
          originalCards,
          generated.configuration,
          generated.trumpRank,
          generated.isFinishingPlay,
        );

        expect(JSON.stringify(originalCards)).toBe(originalSnapshot);
        expectPhysicalAndRepresentedCards(
          original,
          generated.cards,
          generated.configuration,
        );
        expectDeclaredForm(original);

        const permuted = requireLegalPlay(
          reordered.map(decode),
          generated.configuration,
          generated.trumpRank,
          generated.isFinishingPlay,
        );
        expectPhysicalAndRepresentedCards(
          permuted,
          reordered,
          generated.configuration,
        );
        expectDeclaredForm(permuted);
        expect(playMeaning(permuted)).toEqual(playMeaning(original));
      }),
      { numRuns: 300 },
    );
  });

  it("keeps comparison irreflexive, asymmetric, and transitive", () => {
    fc.assert(
      fc.property(comparisonCaseArbitrary(), (generated) => {
        const plays = generated.cardSets.map((cards) =>
          requireLegalPlay(
            cards.map(decode),
            generated.configuration,
            generated.trumpRank,
            false,
          ),
        );
        const beatsMatrix = generated.cardSets.map((challengerCards) =>
          plays.map((incumbent) =>
            responseIsStronger(
              challengerCards,
              incumbent,
              generated.configuration,
              generated.trumpRank,
            ),
          ),
        );

        for (let left = 0; left < plays.length; left += 1) {
          expect(beatsMatrix[left]?.[left]).toBe(false);

          for (let right = 0; right < plays.length; right += 1) {
            expect(
              beatsMatrix[left]?.[right] && beatsMatrix[right]?.[left],
            ).toBe(false);

            for (let last = 0; last < plays.length; last += 1) {
              expect(
                !beatsMatrix[left]?.[right] ||
                  !beatsMatrix[right]?.[last] ||
                  beatsMatrix[left]?.[last],
              ).toBe(true);
            }
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});

function createPlayArbitraries(
  maximumCopy: 2 | 3,
  jokerCodes: readonly string[],
): Readonly<{
  byCount: Readonly<Record<1 | 2 | 3 | 5, fc.Arbitrary<readonly string[]>>>;
  any: fc.Arbitrary<readonly string[]>;
}> {
  const naturalByCount = {
    1: naturalSingleArbitrary(maximumCopy),
    2: repeatedRankArbitrary(2, maximumCopy),
    3: repeatedRankArbitrary(3, maximumCopy),
    5: fc.oneof(
      mixedSuitStraightArbitrary(maximumCopy),
      flushArbitrary(maximumCopy),
      fullHouseArbitrary(maximumCopy),
      fourPlusOneArbitrary(maximumCopy),
      straightFlushArbitrary(maximumCopy),
      repeatedRankArbitrary(5, maximumCopy),
    ),
  } as const;

  const byCount = {
    1: naturalByCount[1].chain((cards) =>
      replaceWithWildcardsArbitrary(cards, jokerCodes),
    ),
    2: naturalByCount[2].chain((cards) =>
      replaceWithWildcardsArbitrary(cards, jokerCodes),
    ),
    3: naturalByCount[3].chain((cards) =>
      replaceWithWildcardsArbitrary(cards, jokerCodes),
    ),
    5: naturalByCount[5].chain((cards) =>
      replaceWithWildcardsArbitrary(cards, jokerCodes),
    ),
  } as const;

  return {
    byCount,
    any: fc.oneof(byCount[1], byCount[2], byCount[3], byCount[5]),
  };
}

function naturalSingleArbitrary(
  maximumCopy: 2 | 3,
): fc.Arbitrary<readonly string[]> {
  return fc
    .tuple(rankArbitrary(), suitArbitrary(), copyArbitrary(maximumCopy))
    .map(([rank, suit, copy]) => [`${rank}${suit}#${copy}`]);
}

function repeatedRankArbitrary(
  count: 2 | 3 | 5,
  maximumCopy: 2 | 3,
): fc.Arbitrary<readonly string[]> {
  return rankArbitrary().chain((rank) =>
    exactShuffledSubset(physicalCardsOfRank(rank, maximumCopy), count),
  );
}

function mixedSuitStraightArbitrary(
  maximumCopy: 2 | 3,
): fc.Arbitrary<readonly string[]> {
  return fc
    .tuple(
      fc.constantFrom(...STRAIGHTS),
      fc.integer({ min: 0, max: SUITS.length - 1 }),
      copyArbitrary(maximumCopy),
    )
    .map(([ranks, suitOffset, copy]) =>
      ranks.map((rank, index) => {
        const suit = SUITS[(suitOffset + index) % SUITS.length];
        if (suit === undefined) {
          throw new Error("Missing generated suit");
        }
        return `${rank}${suit}#${copy}`;
      }),
    );
}

function flushArbitrary(maximumCopy: 2 | 3): fc.Arbitrary<readonly string[]> {
  return fc
    .tuple(
      fc.constantFrom(...NON_STRAIGHT_FLUSH_RANKS),
      suitArbitrary(),
      copyArbitrary(maximumCopy),
    )
    .map(([ranks, suit, copy]) =>
      ranks.map((rank) => `${rank}${suit}#${copy}`),
    );
}

function fullHouseArbitrary(
  maximumCopy: 2 | 3,
): fc.Arbitrary<readonly string[]> {
  return distinctRankPairArbitrary().chain(([tripleRank, pairRank]) =>
    fc
      .tuple(
        exactShuffledSubset(physicalCardsOfRank(tripleRank, maximumCopy), 3),
        exactShuffledSubset(physicalCardsOfRank(pairRank, maximumCopy), 2),
      )
      .map(([triple, pair]) => [...triple, ...pair]),
  );
}

function fourPlusOneArbitrary(
  maximumCopy: 2 | 3,
): fc.Arbitrary<readonly string[]> {
  return distinctRankPairArbitrary().chain(([fourRank, kickerRank]) =>
    fc
      .tuple(
        exactShuffledSubset(physicalCardsOfRank(fourRank, maximumCopy), 4),
        fc.constantFrom(...physicalCardsOfRank(kickerRank, maximumCopy)),
      )
      .map(([four, kicker]) => [...four, kicker]),
  );
}

function straightFlushArbitrary(
  maximumCopy: 2 | 3,
): fc.Arbitrary<readonly string[]> {
  return fc
    .tuple(
      fc.constantFrom(...STRAIGHTS),
      suitArbitrary(),
      copyArbitrary(maximumCopy),
    )
    .map(([ranks, suit, copy]) =>
      ranks.map((rank) => `${rank}${suit}#${copy}`),
    );
}

function replaceWithWildcardsArbitrary(
  naturalCards: readonly string[],
  jokerCodes: readonly string[],
): fc.Arbitrary<readonly string[]> {
  const indices = naturalCards.map((_, index) => index);
  const maximumReplacements = Math.min(naturalCards.length, jokerCodes.length);

  return fc
    .shuffledSubarray(indices, {
      minLength: 0,
      maxLength: maximumReplacements,
    })
    .chain((replacementIndices) =>
      exactShuffledSubset(jokerCodes, replacementIndices.length).map(
        (selectedJokers) => {
          const jokerByIndex = new Map(
            replacementIndices.map((index, jokerIndex) => [
              index,
              selectedJokers[jokerIndex],
            ]),
          );
          return naturalCards.map(
            (card, index) => jokerByIndex.get(index) ?? card,
          );
        },
      ),
    );
}

function createGeneratedCaseArbitrary(
  configurations: readonly RulesConfiguration[],
  playArbitrary: fc.Arbitrary<readonly string[]>,
): fc.Arbitrary<GeneratedCase> {
  return fc
    .tuple(
      fc.constantFrom(...configurations),
      fc.constantFrom(...TRUMP_RANKS),
      fc.boolean(),
      playArbitrary,
    )
    .map(([configuration, trumpRank, isFinishingPlay, cards]) => ({
      cards,
      configuration,
      trumpRank,
      isFinishingPlay,
    }));
}

function comparisonCaseArbitrary(): fc.Arbitrary<
  Readonly<{
    cardSets: readonly [
      readonly string[],
      readonly string[],
      readonly string[],
    ];
    configuration: RulesConfiguration;
    trumpRank: TrumpRank;
  }>
> {
  return fc.oneof(
    comparisonCaseForRuleset(
      SIX_PLAYER_CONFIGURATIONS,
      sixPlayerPlayArbitraries.byCount,
    ),
    comparisonCaseForRuleset(
      FOUR_PLAYER_CONFIGURATIONS,
      fourPlayerPlayArbitraries.byCount,
    ),
  );
}

function comparisonCaseForRuleset(
  configurations: readonly RulesConfiguration[],
  playsByCount: Readonly<
    Record<1 | 2 | 3 | 5, fc.Arbitrary<readonly string[]>>
  >,
): ReturnType<typeof comparisonCaseArbitrary> {
  return fc.constantFrom<1 | 2 | 3 | 5>(1, 2, 3, 5).chain((cardCount) =>
    fc
      .tuple(
        fc.constantFrom(...configurations),
        fc.constantFrom(...TRUMP_RANKS),
        playsByCount[cardCount],
        playsByCount[cardCount],
        playsByCount[cardCount],
      )
      .map(([configuration, trumpRank, first, second, third]) => ({
        cardSets: [first, second, third],
        configuration,
        trumpRank,
      })),
  );
}

function createSixPlayerConfigurations(): readonly SixPlayerRulesConfiguration[] {
  const configurations: SixPlayerRulesConfiguration[] = [];
  for (const jokerPairComparison of [
    "two-small-and-mixed-are-equal",
    "two-small-jokers-win",
  ] as const) {
    for (const wildcardRank of ["weakest-rank", "strongest-rank"] as const) {
      for (const finishingWildcardInterpretation of [
        "normal",
        "weakest-form-and-rank",
      ] as const) {
        for (const flushTieBreaking of [
          "highest-card-only",
          "descending-ranks",
        ] as const) {
          configurations.push({
            rulesetId: "dglz-6p-3d-v1",
            jokerPairComparison,
            wildcardRank,
            finishingWildcardInterpretation,
            flushTieBreaking,
            nextHandLeader: "first-finisher",
            tributeCardSelection: "fair-random",
            returnCardSelection: "recipient-choice",
            tributeRecipientPairing: "adjacent-first-automatic",
            matchEnding: "no-failure-limit-at-5",
          });
        }
      }
    }
  }
  return configurations;
}

function createFourPlayerConfigurations(): readonly FourPlayerRulesConfiguration[] {
  const configurations: FourPlayerRulesConfiguration[] = [];
  for (const wildcardRank of ["weakest-rank", "strongest-rank"] as const) {
    for (const finishingWildcardInterpretation of [
      "normal",
      "weakest-form-and-rank",
    ] as const) {
      for (const flushTieBreaking of [
        "highest-card-only",
        "descending-ranks",
      ] as const) {
        configurations.push({
          rulesetId: "dglz-4p-2d-v1",
          wildcardRank,
          finishingWildcardInterpretation,
          flushTieBreaking,
          nextHandLeader: "first-finisher",
          tributeCardSelection: "fair-random",
          tributeRecipientPairing: "adjacent-first-automatic",
          matchEnding: "no-failure-limit-at-5",
        });
      }
    }
  }
  return configurations;
}

function exactShuffledSubset<T>(
  values: readonly T[],
  length: number,
): fc.Arbitrary<readonly T[]> {
  return fc.shuffledSubarray([...values], {
    minLength: length,
    maxLength: length,
  });
}

function physicalCardsOfRank(
  rank: StandardRank,
  maximumCopy: 2 | 3,
): readonly string[] {
  return SUITS.flatMap((suit) =>
    Array.from(
      { length: maximumCopy },
      (_, copyIndex) => `${rank}${suit}#${copyIndex + 1}`,
    ),
  );
}

function distinctRankPairArbitrary(): fc.Arbitrary<
  readonly [StandardRank, StandardRank]
> {
  return rankArbitrary().chain((first) =>
    fc
      .constantFrom(...RANKS.filter((rank) => rank !== first))
      .map((second) => [first, second] as const),
  );
}

function rankArbitrary(): fc.Arbitrary<StandardRank> {
  return fc.constantFrom(...RANKS);
}

function suitArbitrary(): fc.Arbitrary<Suit> {
  return fc.constantFrom(...SUITS);
}

function copyArbitrary(maximumCopy: 2 | 3): fc.Arbitrary<number> {
  return fc.integer({ min: 1, max: maximumCopy });
}

function requireLegalPlay(
  cards: readonly CardInstance[],
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
  isFinishingPlay: boolean,
): ClassifiedPlay {
  const result = evaluatePlay({
    cards,
    configuration,
    trumpRank,
    isFinishingPlay,
  });
  if (!result.ok) {
    throw new Error(`Generated legal play was rejected: ${result.reason}`);
  }
  return result.play;
}

function responseIsStronger(
  cards: readonly string[],
  previousPlay: ClassifiedPlay,
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
): boolean {
  return evaluatePlay({
    cards: cards.map(decode),
    configuration,
    trumpRank,
    isFinishingPlay: false,
    previousPlay,
  }).ok;
}

function expectPhysicalAndRepresentedCards(
  play: ClassifiedPlay,
  inputCodes: readonly string[],
  configuration: RulesConfiguration,
): void {
  expect(play.cardCount).toBe(inputCodes.length);
  expect(play.cards.map((card) => card.code)).toEqual(inputCodes);
  expect(play.representedFaces).toHaveLength(inputCodes.length);
  expect(new Set(inputCodes).size).toBe(inputCodes.length);

  const maximumCopy = configuration.rulesetId === "dglz-6p-3d-v1" ? 3 : 2;
  const containsNaturalCard = play.cards.some(
    (card) => card.face.kind === "suited",
  );
  const representationErrors = play.cards.flatMap((card, index) => {
    const representedFace = play.representedFaces[index];
    const errors: string[] = [];

    if (card.copyNumber > maximumCopy) {
      errors.push(`${card.code} exceeds Ruleset copy count`);
    }
    if (representedFace === undefined) {
      errors.push(`${card.code} has no represented face`);
    } else if (
      card.face.kind === "suited" &&
      representedFace !== card.face.code
    ) {
      errors.push(`${card.code} changed its natural face`);
    } else if (
      card.face.kind === "joker" &&
      containsNaturalCard &&
      (representedFace === "SMALL" || representedFace === "BIG")
    ) {
      errors.push(`${card.code} did not receive a wildcard face`);
    }

    return errors;
  });

  expect(representationErrors).toEqual([]);
}

function expectDeclaredForm(play: ClassifiedPlay): void {
  const faces = play.representedFaces.map(parseFace);
  const ranks = faces.map((face) => face.rank);
  const suits = faces.flatMap((face) =>
    face.suit === undefined ? [] : [face.suit],
  );
  const rankCounts = [...countValues(ranks).values()].sort(
    (left, right) => left - right,
  );

  expect(play.comparisonRanks[0]).toBe(play.rank);
  expect(declaredFormIsValid(play.form, faces, ranks, suits, rankCounts)).toBe(
    true,
  );
}

function declaredFormIsValid(
  form: ClassifiedPlay["form"],
  faces: readonly ParsedFace[],
  ranks: readonly string[],
  suits: readonly Suit[],
  rankCounts: readonly number[],
): boolean {
  switch (form) {
    case "single":
      return faces.length === 1;
    case "pair":
      return valuesEqual(rankCounts, [2]);
    case "triple":
      return valuesEqual(rankCounts, [3]);
    case "mixed-suit-straight":
      return (
        faces.every(isSuitedFace) &&
        isStraight(ranks) &&
        new Set(suits).size > 1
      );
    case "flush":
      return (
        faces.every(isSuitedFace) &&
        new Set(suits).size === 1 &&
        !isStraight(ranks)
      );
    case "full-house":
      return valuesEqual(rankCounts, [2, 3]);
    case "four-plus-one":
      return valuesEqual(rankCounts, [1, 4]);
    case "straight-flush":
      return (
        faces.every(isSuitedFace) &&
        isStraight(ranks) &&
        new Set(suits).size === 1
      );
    case "five-of-a-kind":
      return valuesEqual(rankCounts, [5]);
  }
}

function valuesEqual(
  left: readonly (number | string)[],
  right: readonly (number | string)[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

type ParsedFace = Readonly<{ rank: string; suit?: Suit }>;

function parseFace(face: CardFaceCode): ParsedFace {
  if (face === "SMALL" || face === "BIG") {
    return { rank: face };
  }
  return {
    rank: face.slice(0, -1),
    suit: face.slice(-1) as Suit,
  };
}

function isSuitedFace(face: ParsedFace): face is ParsedFace & { suit: Suit } {
  return face.suit !== undefined;
}

function isStraight(ranks: readonly string[]): boolean {
  return (
    new Set(ranks).size === 5 &&
    STRAIGHTS.some((straight) => straight.every((rank) => ranks.includes(rank)))
  );
}

function countValues(values: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
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

function decode(code: string): CardInstance {
  const result = decodeCardInstance(code);
  if (!result.ok) {
    throw new Error(`Invalid generated Card Instance code: ${code}`);
  }
  return result.card;
}

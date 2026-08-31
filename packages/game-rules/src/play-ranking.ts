import type {
  CardInstance,
  PlayRank,
  StandardRank,
  TrumpRank,
} from "./cards.js";
import type { RulesConfiguration } from "./configuration.js";
import type {
  FiveCardPlayForm,
  PlayCandidate,
  PlayForm,
} from "./play-types.js";

export const STANDARD_RANKS_LOW_TO_HIGH: readonly StandardRank[] = [
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

const FIVE_CARD_FORM_STRENGTH: Readonly<Record<FiveCardPlayForm, number>> = {
  "mixed-suit-straight": 0,
  flush: 1,
  "full-house": 2,
  "four-plus-one": 3,
  "straight-flush": 4,
  "five-of-a-kind": 5,
};

type ComparablePlay = Pick<
  PlayCandidate,
  "cardCount" | "comparisonRanks" | "form" | "rank"
> &
  Readonly<{ cards?: readonly CardInstance[] }>;

export function comparePlayValues(
  challenger: ComparablePlay,
  incumbent: ComparablePlay,
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
): number {
  const jokerPairComparison = compareJokerOnlyPairs(
    challenger,
    incumbent,
    configuration,
  );
  if (jokerPairComparison !== undefined) {
    return jokerPairComparison;
  }

  if (challenger.cardCount === 5 && incumbent.cardCount === 5) {
    const formDifference =
      fiveCardFormStrength(challenger.form) -
      fiveCardFormStrength(incumbent.form);
    if (formDifference !== 0) {
      return formDifference;
    }
  }

  if (challenger.form === "flush" && incumbent.form === "flush") {
    const ranksToCompare =
      configuration.flushTieBreaking === "highest-card-only" ? 1 : 5;
    return compareRankSequences(
      challenger.comparisonRanks,
      incumbent.comparisonRanks,
      trumpRank,
      ranksToCompare,
    );
  }

  if (isStraightForm(challenger.form) && isStraightForm(incumbent.form)) {
    return (
      straightRankStrength(challenger.rank) -
      straightRankStrength(incumbent.rank)
    );
  }

  return (
    rankStrength(challenger.rank, trumpRank) -
    rankStrength(incumbent.rank, trumpRank)
  );
}

function compareJokerOnlyPairs(
  challenger: ComparablePlay,
  incumbent: ComparablePlay,
  configuration: RulesConfiguration,
): number | undefined {
  if (!isJokerOnlyPair(challenger) || !isJokerOnlyPair(incumbent)) {
    return undefined;
  }

  if (challenger.rank !== incumbent.rank) {
    return challenger.rank === "BIG" ? 1 : -1;
  }

  if (
    challenger.rank === "BIG" ||
    configuration.rulesetId === "dglz-4p-2d-v1" ||
    configuration.jokerPairComparison === "two-small-and-mixed-are-equal"
  ) {
    return 0;
  }

  return (
    countPhysicalSmallJokers(challenger.cards) -
    countPhysicalSmallJokers(incumbent.cards)
  );
}

function isJokerOnlyPair(
  play: ComparablePlay,
): play is ComparablePlay & { cards: readonly CardInstance[] } {
  return (
    play.cardCount === 2 &&
    play.cards !== undefined &&
    play.cards.every((card) => card.face.kind === "joker")
  );
}

function countPhysicalSmallJokers(cards: readonly CardInstance[]): number {
  return cards.filter((card) => card.face.rank === "SMALL").length;
}

export function fiveCardFormStrength(form: PlayForm): number {
  if (form === "single" || form === "pair" || form === "triple") {
    throw new Error(`Not a five-card form: ${form}`);
  }
  return FIVE_CARD_FORM_STRENGTH[form];
}

export function rankStrength(rank: PlayRank, trumpRank: TrumpRank): number {
  if (rank === "BIG") {
    return 16;
  }
  if (rank === "SMALL") {
    return 15;
  }
  if (rank === trumpRank) {
    return 14;
  }

  const strength = STANDARD_RANKS_LOW_TO_HIGH.indexOf(rank);
  if (strength < 0) {
    throw new Error(`Unknown rank: ${rank}`);
  }
  return strength;
}

export function sortRanksStrongestFirst(
  ranks: readonly StandardRank[],
  trumpRank: TrumpRank,
): readonly StandardRank[] {
  return [...ranks].sort(
    (left, right) =>
      rankStrength(right, trumpRank) - rankStrength(left, trumpRank),
  );
}

export function weakestOrdinaryRank(trumpRank: TrumpRank): StandardRank {
  const rank = STANDARD_RANKS_LOW_TO_HIGH.find(
    (candidate) => candidate !== trumpRank,
  );
  if (rank === undefined) {
    throw new Error("No ordinary rank available");
  }
  return rank;
}

function compareRankSequences(
  challenger: readonly PlayRank[],
  incumbent: readonly PlayRank[],
  trumpRank: TrumpRank,
  limit: number,
): number {
  for (let index = 0; index < limit; index += 1) {
    const challengerRank = challenger[index];
    const incumbentRank = incumbent[index];
    if (challengerRank === undefined || incumbentRank === undefined) {
      throw new Error("Incomplete comparison ranks");
    }

    const difference =
      rankStrength(challengerRank, trumpRank) -
      rankStrength(incumbentRank, trumpRank);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function isStraightForm(form: PlayForm): boolean {
  return form === "mixed-suit-straight" || form === "straight-flush";
}

function straightRankStrength(rank: PlayRank): number {
  if (rank === "SMALL" || rank === "BIG") {
    throw new Error(`Joker cannot rank a straight: ${rank}`);
  }
  if (rank === "5") {
    return 0;
  }

  const strength = STANDARD_RANKS_LOW_TO_HIGH.indexOf(rank);
  if (strength < STANDARD_RANKS_LOW_TO_HIGH.indexOf("6")) {
    throw new Error(`Invalid straight high rank: ${rank}`);
  }
  return strength;
}

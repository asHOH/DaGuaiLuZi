import type {
  CardFaceCode,
  CardInstance,
  StandardRank,
  Suit,
  SuitedCardFaceCode,
  TrumpRank,
} from "./cards.js";
import type { RulesConfiguration } from "./configuration.js";
import {
  comparePlayValues,
  fiveCardFormStrength,
  sortRanksStrongestFirst,
  STANDARD_RANKS_LOW_TO_HIGH,
  weakestOrdinaryRank,
} from "./play-ranking.js";
import type {
  BasicPlayForm,
  ClassifiedPlay,
  EvaluatePlayResult,
  PlayCandidate,
} from "./play-types.js";

const SUITS: readonly Suit[] = ["S", "H", "D", "C"];

const STRAIGHTS_LOW_TO_HIGH: readonly Readonly<{
  ranks: readonly StandardRank[];
  highRank: StandardRank;
}>[] = [
  { ranks: ["A", "2", "3", "4", "5"], highRank: "5" },
  ...Array.from({ length: 9 }, (_, index) => {
    const ranks = STANDARD_RANKS_LOW_TO_HIGH.slice(index, index + 5);
    const highRank = ranks[4];
    if (highRank === undefined) {
      throw new Error("Incomplete straight definition");
    }
    return { ranks, highRank };
  }),
];

type SuitedCardInstance = CardInstance & {
  face: {
    kind: "suited";
    rank: StandardRank;
    suit: Suit;
    code: SuitedCardFaceCode;
  };
};

export function classifyPlay(
  cards: readonly CardInstance[],
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
  isFinishingPlay: boolean,
): EvaluatePlayResult {
  const hasWildcard = cards.some((card) => card.face.kind === "joker");
  if (hasWildcard && cards.every((card) => card.face.kind === "joker")) {
    return { ok: false, reason: "play-category-not-implemented" };
  }

  if (
    hasWildcard &&
    isFinishingPlay &&
    configuration.finishingWildcardInterpretation === "weakest-form-and-rank"
  ) {
    return { ok: false, reason: "play-category-not-implemented" };
  }

  switch (cards.length) {
    case 1:
      return classifySingle(cards);
    case 2:
      return classifyRepeatedRank(cards, "pair", 2);
    case 3:
      return classifyRepeatedRank(cards, "triple", 3);
    case 5:
      return classifyFiveCardPlay(cards, configuration, trumpRank);
    default:
      return { ok: false, reason: "unsupported-card-count" };
  }
}

function classifySingle(cards: readonly CardInstance[]): EvaluatePlayResult {
  const card = cards[0];
  if (card === undefined || card.face.kind !== "suited") {
    return { ok: false, reason: "cards-do-not-form-legal-play" };
  }

  return {
    ok: true,
    play: createClassifiedPlay(cards, {
      representedFaces: [card.face.code],
      comparisonRanks: [card.face.rank],
      cardCount: 1,
      form: "single",
      rank: card.face.rank,
    }),
  };
}

function classifyRepeatedRank(
  cards: readonly CardInstance[],
  form: BasicPlayForm,
  cardCount: 2 | 3,
): EvaluatePlayResult {
  const naturalCards = suitedCards(cards);
  const rank = naturalCards[0]?.face.rank;
  if (
    rank === undefined ||
    naturalCards.some((card) => card.face.rank !== rank)
  ) {
    return { ok: false, reason: "cards-do-not-form-legal-play" };
  }

  const wildcardFaces = cards
    .filter((card) => card.face.kind === "joker")
    .map(() => suitedFace(rank, "S"));

  return {
    ok: true,
    play: createClassifiedPlay(cards, {
      representedFaces: assignWildcardFaces(cards, wildcardFaces),
      comparisonRanks: [rank],
      cardCount,
      form,
      rank,
    }),
  };
}

function classifyFiveCardPlay(
  cards: readonly CardInstance[],
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
): EvaluatePlayResult {
  const candidates = [
    ...repeatedPatternCandidates(cards, "five-of-a-kind", [5]),
    ...straightFlushCandidates(cards),
    ...repeatedPatternCandidates(cards, "four-plus-one", [4, 1]),
    ...repeatedPatternCandidates(cards, "full-house", [3, 2]),
    ...flushCandidates(cards, configuration, trumpRank),
    ...mixedSuitStraightCandidates(cards),
  ];

  if (candidates.length === 0) {
    return { ok: false, reason: "cards-do-not-form-legal-play" };
  }

  const strongestForm = Math.max(
    ...candidates.map((candidate) => fiveCardFormStrength(candidate.form)),
  );
  const contenders = candidates.filter(
    (candidate) => fiveCardFormStrength(candidate.form) === strongestForm,
  );
  const selected = selectRankedCandidate(contenders, configuration, trumpRank);

  return {
    ok: true,
    play: createClassifiedPlay(cards, selected),
  };
}

function repeatedPatternCandidates(
  cards: readonly CardInstance[],
  form: "five-of-a-kind" | "four-plus-one" | "full-house",
  targetCounts: readonly [number] | readonly [number, number],
): readonly PlayCandidate[] {
  const naturalCards = suitedCards(cards);
  const naturalRankCounts = countRanks(naturalCards);
  const candidates: PlayCandidate[] = [];

  for (const primaryRank of STANDARD_RANKS_LOW_TO_HIGH) {
    const secondaryRanks: readonly (StandardRank | undefined)[] =
      targetCounts.length === 1
        ? [undefined]
        : STANDARD_RANKS_LOW_TO_HIGH.filter((rank) => rank !== primaryRank);

    for (const secondaryRank of secondaryRanks) {
      const targets = new Map<StandardRank, number>([
        [primaryRank, targetCounts[0]],
      ]);
      if (secondaryRank !== undefined) {
        const secondaryCount = targetCounts[1];
        if (secondaryCount === undefined) {
          throw new Error("Missing secondary target count");
        }
        targets.set(secondaryRank, secondaryCount);
      }

      if (!naturalRanksFitTargets(naturalRankCounts, targets)) {
        continue;
      }

      const wildcardFaces: SuitedCardFaceCode[] = [];
      for (const [rank, targetCount] of targets) {
        const naturalCount = naturalRankCounts.get(rank) ?? 0;
        for (let index = naturalCount; index < targetCount; index += 1) {
          wildcardFaces.push(suitedFace(rank, "S"));
        }
      }

      if (wildcardFaces.length !== cards.length - naturalCards.length) {
        continue;
      }

      candidates.push({
        representedFaces: assignWildcardFaces(cards, wildcardFaces),
        comparisonRanks: [primaryRank],
        cardCount: 5,
        form,
        rank: primaryRank,
      });
    }
  }

  return candidates;
}

function straightFlushCandidates(
  cards: readonly CardInstance[],
): readonly PlayCandidate[] {
  const naturalCards = suitedCards(cards);
  const suit = naturalCards[0]?.face.suit;
  if (
    suit === undefined ||
    naturalCards.some((card) => card.face.suit !== suit) ||
    new Set(naturalCards.map((card) => card.face.rank)).size !==
      naturalCards.length
  ) {
    return [];
  }

  return straightCandidates(cards, (missingRanks) =>
    missingRanks.map((rank) => suitedFace(rank, suit)),
  ).map((candidate) => ({ ...candidate, form: "straight-flush" }));
}

function mixedSuitStraightCandidates(
  cards: readonly CardInstance[],
): readonly PlayCandidate[] {
  const naturalCards = suitedCards(cards);
  if (
    naturalCards.length === 0 ||
    new Set(naturalCards.map((card) => card.face.rank)).size !==
      naturalCards.length
  ) {
    return [];
  }

  const naturalSuits = new Set(naturalCards.map((card) => card.face.suit));
  const candidates = straightCandidates(cards, (missingRanks) => {
    if (missingRanks.length === 0 && naturalSuits.size === 1) {
      return undefined;
    }

    const onlyNaturalSuit =
      naturalSuits.size === 1 ? naturalCards[0]?.face.suit : undefined;
    const differentSuit = SUITS.find((suit) => suit !== onlyNaturalSuit) ?? "S";

    return missingRanks.map((rank, index) =>
      suitedFace(rank, index === 0 ? differentSuit : "S"),
    );
  });

  return candidates.map((candidate) => ({
    ...candidate,
    form: "mixed-suit-straight",
  }));
}

function straightCandidates(
  cards: readonly CardInstance[],
  assignMissing: (
    missingRanks: readonly StandardRank[],
  ) => readonly SuitedCardFaceCode[] | undefined,
): readonly PlayCandidate[] {
  const naturalRanks = suitedCards(cards).map((card) => card.face.rank);
  const candidates: PlayCandidate[] = [];

  for (const straight of STRAIGHTS_LOW_TO_HIGH) {
    if (naturalRanks.some((rank) => !straight.ranks.includes(rank))) {
      continue;
    }

    const missingRanks = straight.ranks.filter(
      (rank) => !naturalRanks.includes(rank),
    );
    if (missingRanks.length !== cards.length - naturalRanks.length) {
      continue;
    }

    const wildcardFaces = assignMissing(missingRanks);
    if (wildcardFaces === undefined) {
      continue;
    }

    candidates.push({
      representedFaces: assignWildcardFaces(cards, wildcardFaces),
      comparisonRanks: [straight.highRank],
      cardCount: 5,
      form: "mixed-suit-straight",
      rank: straight.highRank,
    });
  }

  return candidates;
}

function flushCandidates(
  cards: readonly CardInstance[],
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
): readonly PlayCandidate[] {
  const naturalCards = suitedCards(cards);
  const suit = naturalCards[0]?.face.suit;
  if (
    suit === undefined ||
    naturalCards.some((card) => card.face.suit !== suit)
  ) {
    return [];
  }

  const wildcardRank =
    configuration.wildcardRank === "strongest-rank"
      ? trumpRank
      : weakestOrdinaryRank(trumpRank);
  const wildcardFaces = cards
    .filter((card) => card.face.kind === "joker")
    .map(() => suitedFace(wildcardRank, suit));
  const representedFaces = assignWildcardFaces(cards, wildcardFaces);
  const representedRanks = representedFaces.map(standardRankOfFace);
  const comparisonRanks = sortRanksStrongestFirst(representedRanks, trumpRank);
  const rank = comparisonRanks[0];
  if (rank === undefined) {
    throw new Error("Flush has no comparison rank");
  }

  return [
    {
      representedFaces,
      comparisonRanks,
      cardCount: 5,
      form: "flush",
      rank,
    },
  ];
}

function selectRankedCandidate(
  candidates: readonly PlayCandidate[],
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
): PlayCandidate {
  const first = candidates[0];
  if (first === undefined) {
    throw new Error("No candidate to select");
  }

  const direction = configuration.wildcardRank === "strongest-rank" ? 1 : -1;
  return candidates.slice(1).reduce((selected, candidate) => {
    const comparison = comparePlayValues(
      candidate,
      selected,
      configuration,
      trumpRank,
    );
    return comparison * direction > 0 ? candidate : selected;
  }, first);
}

function createClassifiedPlay(
  cards: readonly CardInstance[],
  candidate: PlayCandidate,
): ClassifiedPlay {
  return Object.freeze({
    cards: Object.freeze([...cards]),
    representedFaces: Object.freeze([...candidate.representedFaces]),
    comparisonRanks: Object.freeze([...candidate.comparisonRanks]),
    cardCount: candidate.cardCount,
    form: candidate.form,
    rank: candidate.rank,
  });
}

function assignWildcardFaces(
  cards: readonly CardInstance[],
  wildcardFaces: readonly SuitedCardFaceCode[],
): readonly CardFaceCode[] {
  const wildcardCards = cards
    .filter((card) => card.face.kind === "joker")
    .sort((left, right) => left.code.localeCompare(right.code));
  const representationByCode = new Map(
    wildcardCards.map((card, index) => [card.code, wildcardFaces[index]]),
  );

  return cards.map((card) => {
    if (card.face.kind === "suited") {
      return card.face.code;
    }

    const representedFace = representationByCode.get(card.code);
    if (representedFace === undefined) {
      throw new Error("Missing wildcard representation");
    }
    return representedFace;
  });
}

function suitedCards(
  cards: readonly CardInstance[],
): readonly SuitedCardInstance[] {
  return cards.filter(
    (card): card is SuitedCardInstance => card.face.kind === "suited",
  );
}

function countRanks(
  cards: readonly SuitedCardInstance[],
): ReadonlyMap<StandardRank, number> {
  const counts = new Map<StandardRank, number>();
  for (const card of cards) {
    counts.set(card.face.rank, (counts.get(card.face.rank) ?? 0) + 1);
  }
  return counts;
}

function naturalRanksFitTargets(
  naturalCounts: ReadonlyMap<StandardRank, number>,
  targets: ReadonlyMap<StandardRank, number>,
): boolean {
  for (const [rank, count] of naturalCounts) {
    if (count > (targets.get(rank) ?? 0)) {
      return false;
    }
  }
  return true;
}

function suitedFace(rank: StandardRank, suit: Suit): SuitedCardFaceCode {
  return `${rank}${suit}`;
}

function standardRankOfFace(face: CardFaceCode): StandardRank {
  if (face === "SMALL" || face === "BIG") {
    throw new Error(`Expected a suited Card Face: ${face}`);
  }
  return face.slice(0, -1) as StandardRank;
}

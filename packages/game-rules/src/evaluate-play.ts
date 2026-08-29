import type {
  CardInstance,
  PlayRank,
  StandardRank,
  TrumpRank,
} from "./cards.js";
import type { RulesConfiguration } from "./configuration.js";

export type BasicPlayForm = "single" | "pair" | "triple";

export type ClassifiedPlay = Readonly<{
  cards: readonly CardInstance[];
  cardCount: 1 | 2 | 3;
  form: BasicPlayForm;
  rank: PlayRank;
}>;

export type PlayRejectionReason =
  | "duplicate-card-instance"
  | "card-not-in-ruleset"
  | "unsupported-card-count"
  | "cards-do-not-form-legal-play"
  | "response-card-count-mismatch"
  | "response-not-stronger"
  | "play-category-not-implemented";

export type EvaluatePlayResult =
  | Readonly<{ ok: true; play: ClassifiedPlay }>
  | Readonly<{ ok: false; reason: PlayRejectionReason }>;

export type EvaluatePlayRequest = Readonly<{
  cards: readonly CardInstance[];
  configuration: RulesConfiguration;
  trumpRank: TrumpRank;
  isFinishingPlay: boolean;
  previousPlay?: ClassifiedPlay;
}>;

const STANDARD_RANKS_LOW_TO_HIGH: readonly StandardRank[] = [
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

export function evaluatePlay(request: EvaluatePlayRequest): EvaluatePlayResult {
  const validationFailure = validateCardInstances(
    request.cards,
    request.configuration,
  );
  if (validationFailure !== undefined) {
    return { ok: false, reason: validationFailure };
  }

  if (![1, 2, 3, 5].includes(request.cards.length)) {
    return { ok: false, reason: "unsupported-card-count" };
  }

  if (request.previousPlay?.cardCount !== undefined) {
    if (request.previousPlay.cardCount !== request.cards.length) {
      return { ok: false, reason: "response-card-count-mismatch" };
    }
  }

  const classification = classifyImplementedPlay(request.cards);
  if (!classification.ok) {
    return classification;
  }

  if (request.previousPlay === undefined) {
    return classification;
  }

  if (
    compareRanks(
      classification.play.rank,
      request.previousPlay.rank,
      request.trumpRank,
    ) <= 0
  ) {
    return { ok: false, reason: "response-not-stronger" };
  }

  return classification;
}

function validateCardInstances(
  cards: readonly CardInstance[],
  configuration: RulesConfiguration,
): PlayRejectionReason | undefined {
  const maximumCopyNumber = configuration.rulesetId === "dglz-6p-3d-v1" ? 3 : 2;
  const seenCodes = new Set<string>();

  for (const card of cards) {
    if (seenCodes.has(card.code)) {
      return "duplicate-card-instance";
    }
    seenCodes.add(card.code);

    if (card.copyNumber > maximumCopyNumber) {
      return "card-not-in-ruleset";
    }
  }

  return undefined;
}

function classifyImplementedPlay(
  cards: readonly CardInstance[],
): EvaluatePlayResult {
  if (cards.length === 5 || cards.some((card) => card.face.kind === "joker")) {
    return { ok: false, reason: "play-category-not-implemented" };
  }

  const firstCard = cards[0];
  if (firstCard === undefined || firstCard.face.kind !== "suited") {
    return { ok: false, reason: "cards-do-not-form-legal-play" };
  }

  const rank = firstCard.face.rank;
  if (
    cards.length > 1 &&
    cards.some((card) => card.face.kind !== "suited" || card.face.rank !== rank)
  ) {
    return { ok: false, reason: "cards-do-not-form-legal-play" };
  }

  switch (cards.length) {
    case 1:
      return { ok: true, play: createPlay(cards, "single", rank, 1) };
    case 2:
      return { ok: true, play: createPlay(cards, "pair", rank, 2) };
    case 3:
      return { ok: true, play: createPlay(cards, "triple", rank, 3) };
    default:
      return { ok: false, reason: "unsupported-card-count" };
  }
}

function createPlay(
  cards: readonly CardInstance[],
  form: BasicPlayForm,
  rank: StandardRank,
  cardCount: 1 | 2 | 3,
): ClassifiedPlay {
  return Object.freeze({
    cards: Object.freeze([...cards]),
    cardCount,
    form,
    rank,
  });
}

function compareRanks(
  challenger: PlayRank,
  incumbent: PlayRank,
  trumpRank: TrumpRank,
): number {
  return (
    rankStrength(challenger, trumpRank) - rankStrength(incumbent, trumpRank)
  );
}

function rankStrength(rank: PlayRank, trumpRank: TrumpRank): number {
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

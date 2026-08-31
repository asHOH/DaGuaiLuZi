import type {
  CardFaceCode,
  CardInstance,
  PlayRank,
  TrumpRank,
} from "./cards.js";
import type { RulesConfiguration } from "./configuration.js";

export type BasicPlayForm = "single" | "pair" | "triple";

export type FiveCardPlayForm =
  | "mixed-suit-straight"
  | "flush"
  | "full-house"
  | "four-plus-one"
  | "straight-flush"
  | "five-of-a-kind";

export type PlayForm = BasicPlayForm | FiveCardPlayForm;
export type LegalCardCount = 1 | 2 | 3 | 5;

export type ClassifiedPlay = Readonly<{
  cards: readonly CardInstance[];
  representedFaces: readonly CardFaceCode[];
  comparisonRanks: readonly PlayRank[];
  cardCount: LegalCardCount;
  form: PlayForm;
  rank: PlayRank;
}>;

export type PlayRejectionReason =
  | "duplicate-card-instance"
  | "card-not-in-ruleset"
  | "unsupported-card-count"
  | "cards-do-not-form-legal-play"
  | "response-card-count-mismatch"
  | "response-not-stronger";

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

export type PlayCandidate = Readonly<{
  representedFaces: readonly CardFaceCode[];
  comparisonRanks: readonly PlayRank[];
  cardCount: LegalCardCount;
  form: PlayForm;
  rank: PlayRank;
}>;

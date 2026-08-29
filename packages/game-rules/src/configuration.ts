export type RulesetId = "dglz-6p-3d-v1" | "dglz-4p-2d-v1";

type SharedRulesConfiguration = Readonly<{
  wildcardRank: "weakest-rank" | "strongest-rank";
  finishingWildcardInterpretation: "normal" | "weakest-form-and-rank";
  flushTieBreaking: "highest-card-only" | "descending-ranks";
  nextHandLeader: "first-finisher" | "highest-tribute";
  tributeCardSelection: "fair-random" | "giver-choice";
  tributeRecipientPairing:
    | "finish-position-by-tribute-rank"
    | "adjacent-first-automatic";
  matchEnding: "no-failure-limit-at-5" | "three-failure-limit-at-5";
}>;

export type SixPlayerRulesConfiguration = SharedRulesConfiguration &
  Readonly<{
    rulesetId: "dglz-6p-3d-v1";
    jokerPairComparison:
      | "two-small-and-mixed-are-equal"
      | "two-small-jokers-win";
    returnCardSelection: "recipient-choice" | "giver-choice-from-candidates";
  }>;

export type FourPlayerRulesConfiguration = SharedRulesConfiguration &
  Readonly<{
    rulesetId: "dglz-4p-2d-v1";
  }>;

export type RulesConfiguration =
  | SixPlayerRulesConfiguration
  | FourPlayerRulesConfiguration;


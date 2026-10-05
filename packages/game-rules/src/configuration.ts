export type RulesetId = "dglz-6p-3d-v1" | "dglz-4p-2d-v1";

const ruleVariantValues = {
  jokerPairComparison: [
    "two-small-and-mixed-are-equal",
    "two-small-jokers-win",
  ],
  wildcardRank: ["weakest-rank", "strongest-rank"],
  finishingWildcardInterpretation: ["normal", "weakest-form-and-rank"],
  flushTieBreaking: ["highest-card-only", "descending-ranks"],
  nextHandLeader: ["first-finisher", "highest-tribute"],
  tributeCardSelection: ["fair-random", "giver-choice"],
  returnCardSelection: ["recipient-choice", "giver-choice-from-candidates"],
  tributeRecipientPairing: [
    "finish-position-by-tribute-rank",
    "adjacent-first-automatic",
  ],
  matchEnding: ["no-failure-limit-at-5", "three-failure-limit-at-5"],
} as const;

export const RULE_VARIANT_VALUES: typeof ruleVariantValues =
  Object.freeze(ruleVariantValues);
for (const values of Object.values(RULE_VARIANT_VALUES)) Object.freeze(values);

export type RuleVariantName = keyof typeof RULE_VARIANT_VALUES;

type RuleVariantSettings = {
  readonly [
    Name in RuleVariantName
  ]: (typeof RULE_VARIANT_VALUES)[Name][number];
};

export type SixPlayerRulesConfiguration = RuleVariantSettings &
  Readonly<{
    rulesetId: "dglz-6p-3d-v1";
  }>;

export type FourPlayerRulesConfiguration = Omit<
  RuleVariantSettings,
  "jokerPairComparison" | "returnCardSelection"
> &
  Readonly<{
    rulesetId: "dglz-4p-2d-v1";
  }>;

export type RulesConfiguration =
  SixPlayerRulesConfiguration | FourPlayerRulesConfiguration;

import type { RulesetId } from "./configuration.js";

export type RuleVariantName =
  | "jokerPairComparison"
  | "wildcardRank"
  | "finishingWildcardInterpretation"
  | "flushTieBreaking"
  | "nextHandLeader"
  | "tributeCardSelection"
  | "returnCardSelection"
  | "tributeRecipientPairing"
  | "matchEnding";

export type RulesetDefinition = Readonly<{
  rulesetId: RulesetId;
  playerCount: number;
  teamSize: number;
  deckCount: number;
  supportedRuleVariants: readonly RuleVariantName[];
}>;

const SIX_PLAYER_RULE_VARIANTS: readonly RuleVariantName[] = Object.freeze([
  "jokerPairComparison",
  "wildcardRank",
  "finishingWildcardInterpretation",
  "flushTieBreaking",
  "nextHandLeader",
  "tributeCardSelection",
  "returnCardSelection",
  "tributeRecipientPairing",
  "matchEnding",
]);

const FOUR_PLAYER_RULE_VARIANTS: readonly RuleVariantName[] = Object.freeze([
  "wildcardRank",
  "finishingWildcardInterpretation",
  "flushTieBreaking",
  "nextHandLeader",
  "tributeCardSelection",
  "tributeRecipientPairing",
  "matchEnding",
]);

export const RULESET_DEFINITIONS: Readonly<
  Record<RulesetId, RulesetDefinition>
> = Object.freeze({
  "dglz-6p-3d-v1": Object.freeze({
    rulesetId: "dglz-6p-3d-v1",
    playerCount: 6,
    teamSize: 3,
    deckCount: 3,
    supportedRuleVariants: SIX_PLAYER_RULE_VARIANTS,
  }),
  "dglz-4p-2d-v1": Object.freeze({
    rulesetId: "dglz-4p-2d-v1",
    playerCount: 4,
    teamSize: 2,
    deckCount: 2,
    supportedRuleVariants: FOUR_PLAYER_RULE_VARIANTS,
  }),
});

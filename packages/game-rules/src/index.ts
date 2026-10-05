export {
  decodeCardInstance,
  type CardFace,
  type CardFaceCode,
  type CardInstance,
  type CardInstanceCode,
  type CopyNumber,
  type DecodeCardInstanceResult,
  type JokerRank,
  type PlayRank,
  type StandardRank,
  type Suit,
  type SuitedCardFaceCode,
  type TrumpRank,
} from "./cards.js";

export {
  RULE_VARIANT_VALUES,
  type FourPlayerRulesConfiguration,
  type RulesConfiguration,
  type RulesetId,
  type SixPlayerRulesConfiguration,
} from "./configuration.js";

export {
  RULESET_DEFINITIONS,
  type RulesetDefinition,
  type RuleVariantName,
} from "./rulesets.js";

export { evaluatePlay } from "./evaluate-play.js";
export { rankStrength } from "./play-ranking.js";
export { hasAutomaticResponseClosure } from "./automatic-response-closure.js";

export type {
  BasicPlayForm,
  ClassifiedPlay,
  EvaluatePlayRequest,
  EvaluatePlayResult,
  FiveCardPlayForm,
  LegalCardCount,
  PlayForm,
  PlayRejectionReason,
} from "./play-types.js";

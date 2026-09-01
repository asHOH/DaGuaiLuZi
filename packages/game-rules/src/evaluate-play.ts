import type { CardInstance } from "./cards.js";
import { classifyPlay } from "./classify-play.js";
import type { RulesConfiguration } from "./configuration.js";
import { comparePlayValues } from "./play-ranking.js";
import type {
  EvaluatePlayRequest,
  EvaluatePlayResult,
  PlayRejectionReason,
} from "./play-types.js";
import { RULESET_DEFINITIONS } from "./rulesets.js";

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

  if (
    request.previousPlay !== undefined &&
    request.previousPlay.cardCount !== request.cards.length
  ) {
    return { ok: false, reason: "response-card-count-mismatch" };
  }

  const classification = classifyPlay(
    request.cards,
    request.configuration,
    request.trumpRank,
    request.isFinishingPlay,
  );
  if (!classification.ok || request.previousPlay === undefined) {
    return classification;
  }

  if (
    comparePlayValues(
      classification.play,
      request.previousPlay,
      request.configuration,
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
  const maximumCopyNumber =
    RULESET_DEFINITIONS[configuration.rulesetId].deckCount;
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

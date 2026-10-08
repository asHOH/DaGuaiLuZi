import assert from "node:assert/strict";
import type { PlayerView } from "@dglz/game-core";
import {
  decodeCardInstance,
  evaluatePlay,
  type CardInstance,
  type LegalCardCount,
} from "@dglz/game-rules";
import type { PolicyAction } from "./policy.js";

function decode(code: string): CardInstance {
  const card = decodeCardInstance(code);
  assert(card.ok, "观察中的牌编号无效。");
  return card.card;
}

function* combinations<T>(
  items: readonly T[],
  count: number,
  start = 0,
  prefix: readonly T[] = [],
): Generator<readonly T[]> {
  if (count === 0) {
    yield prefix;
    return;
  }
  for (let i = start; i <= items.length - count; i++) {
    yield* combinations(items, count - 1, i + 1, [...prefix, items[i]!]);
  }
}

/** Complete unordered card choices from this player's permitted view only. */
export function legalActions(
  view: PlayerView,
  playerId: string,
): readonly PolicyAction[] {
  const actions = [...choices(view, playerId)];
  for (const action of actions) {
    if (action.type === "Play") Object.freeze(action.cards);
    if (action.type === "OfferReturnCandidates")
      Object.freeze(action.candidateCards);
    Object.freeze(action);
  }
  return Object.freeze(actions);
}

function* choices(view: PlayerView, playerId: string): Generator<PolicyAction> {
  if (view.lifecycle !== "ACTIVE" || view.handResult !== undefined) return;
  const configuration =
    view.effectiveRulesConfiguration ?? view.rulesConfiguration;
  const hand = [...(view.hand ?? [])].sort().map(decode);
  if (view.setupStage === "play") {
    if (view.currentActor !== playerId) return;
    assert(view.trumpRank !== undefined, "观察缺少主牌点数。");
    const previous = view.unbeatenPlay;
    const previousPlay =
      previous === undefined
        ? undefined
        : {
            ...previous,
            cards: previous.cards.map(decode),
            cardCount: previous.cards.length as LegalCardCount,
          };
    if (previous !== undefined) yield { type: "Pass" };
    // ponytail: enumerate at most C(27,5) five-card subsets; replace with a parity-tested generator if profiling requires it.
    const counts =
      previous === undefined ? [1, 2, 3, 5] : [previous.cards.length];
    for (const count of counts) {
      for (const cards of combinations(hand, count)) {
        if (
          evaluatePlay({
            cards,
            configuration,
            trumpRank: view.trumpRank,
            isFinishingPlay: cards.length === hand.length,
            ...(previousPlay === undefined ? {} : { previousPlay }),
          }).ok
        )
          yield { type: "Play", cards: cards.map((card) => card.code) };
      }
    }
    return;
  }
  if (!view.pendingPlayerIds?.includes(playerId)) return;
  if (view.tieKind !== undefined && view.tieRound !== undefined) {
    for (const candidateId of [null, ...(view.tieCandidateIds ?? [])]) {
      yield {
        type: "SubmitTieChoiceBallot",
        tieKind: view.tieKind,
        round: view.tieRound,
        candidateId,
      };
    }
    return;
  }
  if (view.setupStage === "tribute-selection") {
    for (const card of [...(view.eligibleTributeCards ?? [])].sort())
      yield { type: "SelectTributeCard", card };
    return;
  }
  if (view.setupStage !== "return-card-selection") return;
  const offer = view.returnCandidates?.find(
    (candidate) => candidate.giverId === playerId,
  );
  if (offer !== undefined) {
    for (const card of [...offer.candidateCards].sort())
      yield { type: "SelectReturnCard", card };
    return;
  }
  const transfer = view.tributeTransfers?.find(
    (candidate) => candidate.recipientId === playerId,
  );
  assert(transfer !== undefined, "观察缺少进贡记录。");
  const tribute = decode(transfer.card);
  if (
    configuration.rulesetId === "dglz-6p-3d-v1" &&
    configuration.returnCardSelection === "giver-choice-from-candidates" &&
    tribute.face.kind === "joker"
  ) {
    const count = tribute.face.rank === "SMALL" ? 2 : 3;
    for (const cards of combinations(hand, count)) {
      if (new Set(cards.map((card) => card.face.rank)).size === count) {
        yield {
          type: "OfferReturnCandidates",
          candidateCards: cards.map((card) => card.code),
        };
      }
    }
  } else {
    for (const card of hand)
      yield { type: "SelectReturnCard", card: card.code };
  }
}

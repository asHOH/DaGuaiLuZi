import assert from "node:assert/strict";
import { decodeCardInstance } from "@dglz/game-rules";
import type {
  OfferReturnCandidates,
  Pass,
  Play,
  PlayerView,
  PlayerViewTributeTransfer,
  SelectReturnCard,
  SelectTributeCard,
  SubmitTieChoiceBallot,
} from "@dglz/game-core";

export type PolicyAction =
  | Omit<Play, "playerId">
  | Omit<Pass, "playerId">
  | Omit<SelectTributeCard, "playerId">
  | Omit<OfferReturnCandidates, "playerId">
  | Omit<SelectReturnCard, "playerId">
  | Omit<SubmitTieChoiceBallot, "playerId">;

export type Policy = (
  view: PlayerView,
  playerId: string,
) => PolicyAction | undefined;

// Only fields used by the passive policy; also accepts serialized app views.
export type PassiveObservation = Readonly<{
  lifecycle: PlayerView["lifecycle"];
  rulesConfiguration: PlayerView["rulesConfiguration"];
  effectiveRulesConfiguration?: PlayerView["effectiveRulesConfiguration"];
  setupStage?: PlayerView["setupStage"];
  currentActor?: PlayerView["currentActor"];
  unbeatenPlay?: PlayerView["unbeatenPlay"];
  hand?: PlayerView["hand"];
  pendingPlayerIds?: PlayerView["pendingPlayerIds"];
  tieKind?: PlayerView["tieKind"];
  tieRound?: PlayerView["tieRound"];
  eligibleTributeCards?: PlayerView["eligibleTributeCards"];
  returnCandidates?: PlayerView["returnCandidates"];
  tributeTransfers?:
    | readonly Pick<PlayerViewTributeTransfer, "recipientId" | "card">[]
    | undefined;
}>;

// ponytail: passive completion policy; use a separate policy for strategic play.
export function passivePolicy(
  own: PassiveObservation,
  playerId: string,
): PolicyAction | undefined {
  if (own.lifecycle !== "ACTIVE") return;
  if (own.setupStage === "play") {
    if (own.currentActor !== playerId) return;
    if (own.unbeatenPlay !== undefined) return { type: "Pass" };
    const card = own.hand?.[0];
    assert(card !== undefined, "缺少首出牌。");
    return { type: "Play", cards: [card] };
  }
  if (!own.pendingPlayerIds?.includes(playerId)) return;
  if (own.tieKind !== undefined && own.tieRound !== undefined) {
    return {
      type: "SubmitTieChoiceBallot",
      tieKind: own.tieKind,
      round: own.tieRound,
      candidateId: null,
    };
  }
  if (own.setupStage === "tribute-selection") {
    const card = own.eligibleTributeCards?.[0];
    assert(card !== undefined, "缺少可选贡牌。");
    return { type: "SelectTributeCard", card };
  }
  const offer = own.returnCandidates?.find(
    (entry) => entry.giverId === playerId,
  );
  if (offer !== undefined) {
    const card = offer.candidateCards[0];
    assert(card !== undefined, "缺少还贡候选牌。");
    return { type: "SelectReturnCard", card };
  }
  const transfer = own.tributeTransfers?.find(
    (entry) => entry.recipientId === playerId,
  );
  const tribute =
    transfer === undefined ? undefined : decodeCardInstance(transfer.card);
  const configuration =
    own.effectiveRulesConfiguration ?? own.rulesConfiguration;
  if (
    configuration.rulesetId === "dglz-6p-3d-v1" &&
    configuration.returnCardSelection === "giver-choice-from-candidates" &&
    tribute?.ok &&
    tribute.card.face.kind === "joker"
  ) {
    const count = tribute.card.face.rank === "SMALL" ? 2 : 3;
    const ranks = new Set<string>();
    const candidateCards = (own.hand ?? [])
      .filter((code) => {
        const decoded = decodeCardInstance(code);
        if (!decoded.ok || ranks.has(decoded.card.face.rank)) return false;
        ranks.add(decoded.card.face.rank);
        return true;
      })
      .slice(0, count);
    assert.equal(candidateCards.length, count, "还贡候选牌点数不足。");
    return { type: "OfferReturnCandidates", candidateCards };
  }
  const card = own.hand?.[0];
  assert(card !== undefined, "缺少还贡牌。");
  return { type: "SelectReturnCard", card };
}

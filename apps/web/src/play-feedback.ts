import {
  decodeCardInstance,
  evaluatePlay,
  type CardInstance,
  type EvaluatePlayResult,
  type LegalCardCount,
  type PlayForm,
} from "@dglz/game-rules";
import type { PlayerView } from "@dglz/protocol";

export const PLAY_FORM_LABELS: Record<PlayForm, string> = {
  single: "单张",
  pair: "对子",
  triple: "三张",
  "mixed-suit-straight": "顺子",
  flush: "同花",
  "full-house": "三带二",
  "four-plus-one": "四带一",
  "straight-flush": "同花顺",
  "five-of-a-kind": "五同张",
};

function cardsFromCodes(codes: readonly string[]): CardInstance[] {
  return codes.map((code) => {
    const decoded = decodeCardInstance(code);
    if (!decoded.ok) throw new Error("invalid-card-instance-code");
    return decoded.card;
  });
}

export function selectionFeedback(
  view: Pick<
    Extract<PlayerView, { lifecycle: "ACTIVE" }>,
    "hand" | "rulesConfiguration" | "trumpRank" | "unbeatenPlay"
  >,
  selection: readonly string[],
): EvaluatePlayResult {
  const previous = view.unbeatenPlay;
  return evaluatePlay({
    cards: cardsFromCodes(selection),
    configuration: view.rulesConfiguration,
    trumpRank: view.trumpRank,
    isFinishingPlay: selection.length === view.hand.length,
    ...(previous === undefined
      ? {}
      : {
          previousPlay: {
            ...previous,
            cards: cardsFromCodes(previous.cards),
            cardCount: previous.cards.length as LegalCardCount,
          },
        }),
  });
}

import type { ClassifiedPlay } from "./play-types.js";

export function hasAutomaticResponseClosure(play: ClassifiedPlay): boolean {
  if (!play.cards.every((card) => card.face.kind === "joker")) {
    return false;
  }

  switch (play.cardCount) {
    case 1:
    case 2:
      return play.cards.every((card) => card.face.rank === "BIG");
    case 3:
      return play.cards.some((card) => card.face.rank === "BIG");
    case 5:
      return true;
  }
}

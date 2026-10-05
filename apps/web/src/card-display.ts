import {
  decodeCardInstance,
  rankStrength,
  type CardInstanceCode,
  type ClassifiedPlay,
  type PlayRank,
  type TrumpRank,
} from "@dglz/game-rules";

const SUITS = {
  S: { name: "黑桃", order: 0 },
  H: { name: "红桃", order: 1 },
  C: { name: "梅花", order: 2 },
  D: { name: "方块", order: 3 },
};

export function cardLabel(code: string) {
  const decoded = decodeCardInstance(code);
  if (!decoded.ok) throw new Error("invalid-display-card");
  const { face, copyNumber } = decoded.card;
  const joker = face.rank === "BIG" ? "大王" : "小王";
  const suit = face.kind === "suited" ? SUITS[face.suit] : undefined;
  return {
    rank: suit === undefined ? joker : face.rank,
    suit: face.kind === "suited" ? face.suit : undefined,
    display: suit === undefined ? joker : `${suit.name}${face.rank}`,
    aria: `${suit === undefined ? joker : `${suit.name}${face.rank}`}，第${copyNumber}张`,
    tone:
      face.kind === "joker"
        ? ("joker" as const)
        : face.suit === "H" || face.suit === "D"
          ? ("red" as const)
          : ("black" as const),
    red:
      face.kind === "joker"
        ? face.rank === "BIG"
        : face.suit === "H" || face.suit === "D",
  };
}

export function groupCards(
  codes: readonly CardInstanceCode[],
  trumpRank: TrumpRank,
) {
  const cards = codes
    .map((code) => {
      const decoded = decodeCardInstance(code);
      if (!decoded.ok) throw new Error("invalid-display-card");
      return decoded.card;
    })
    .sort(
      (a, b) =>
        rankStrength(b.face.rank, trumpRank) -
          rankStrength(a.face.rank, trumpRank) ||
        (a.face.kind === "suited" ? SUITS[a.face.suit].order : 0) -
          (b.face.kind === "suited" ? SUITS[b.face.suit].order : 0) ||
        a.copyNumber - b.copyNumber,
    );
  const groups = new Map<PlayRank, CardInstanceCode[]>();
  for (const card of cards) {
    const group = groups.get(card.face.rank) ?? [];
    group.push(card.code);
    groups.set(card.face.rank, group);
  }
  return [...groups].map(([rank, cards]) => ({ rank, cards }));
}

export function sortPlayedCards(
  codes: readonly CardInstanceCode[],
  trumpRank: TrumpRank,
  play: Pick<ClassifiedPlay, "form" | "rank" | "representedFaces">,
) {
  // Joker-only interpretations describe the whole play, not substitutions.
  if (play.rank === "BIG" || play.rank === "SMALL") {
    return groupCards(codes, trumpRank).flatMap((group) => group.cards);
  }
  const straight =
    play.form === "mixed-suit-straight" || play.form === "straight-flush";
  const primaryGroup =
    play.form === "full-house" || play.form === "four-plus-one";
  const sequence = [
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
    "A",
  ];

  return codes
    .map((code, index) => {
      const decoded = decodeCardInstance(code);
      const represented = decodeCardInstance(
        `${play.representedFaces[index]}#1`,
      );
      if (!decoded.ok || !represented.ok)
        throw new Error("invalid-display-card");
      const rank = represented.card.face.rank;
      return {
        card: decoded.card,
        primary: Number(primaryGroup && rank === play.rank),
        strength: straight
          ? rank === "A" && play.rank === "5"
            ? -1
            : sequence.indexOf(rank)
          : rankStrength(rank, trumpRank),
      };
    })
    .sort(
      (a, b) =>
        b.primary - a.primary ||
        b.strength - a.strength ||
        Number(a.card.face.kind === "joker") -
          Number(b.card.face.kind === "joker") ||
        rankStrength(b.card.face.rank, trumpRank) -
          rankStrength(a.card.face.rank, trumpRank) ||
        (a.card.face.kind === "suited" ? SUITS[a.card.face.suit].order : 0) -
          (b.card.face.kind === "suited" ? SUITS[b.card.face.suit].order : 0) ||
        a.card.copyNumber - b.card.copyNumber,
    )
    .map(({ card }) => card.code);
}

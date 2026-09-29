import {
  decodeCardInstance,
  rankStrength,
  type CardInstanceCode,
  type PlayRank,
  type TrumpRank,
} from "@dglz/game-rules";

const SUITS = {
  S: { name: "黑桃", symbol: "♠", order: 0 },
  H: { name: "红桃", symbol: "♥", order: 1 },
  C: { name: "梅花", symbol: "♣", order: 2 },
  D: { name: "方块", symbol: "♦", order: 3 },
};

export function cardLabel(code: string) {
  const decoded = decodeCardInstance(code);
  if (!decoded.ok) throw new Error("invalid-display-card");
  const { face, copyNumber } = decoded.card;
  const joker = face.rank === "BIG" ? "大王" : "小王";
  const suit = face.kind === "suited" ? SUITS[face.suit] : undefined;
  return {
    rank: suit === undefined ? joker : face.rank,
    symbol: suit?.symbol ?? "",
    display: suit === undefined ? joker : `${face.rank}${suit.symbol}`,
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

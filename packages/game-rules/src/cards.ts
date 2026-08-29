export type Suit = "S" | "H" | "D" | "C";

export type StandardRank =
  "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export type JokerRank = "SMALL" | "BIG";
export type PlayRank = StandardRank | JokerRank;
export type TrumpRank = "2" | "3" | "4" | "5";
export type CopyNumber = 1 | 2 | 3;
export type SuitedCardFaceCode = `${StandardRank}${Suit}`;
export type CardFaceCode = SuitedCardFaceCode | JokerRank;
export type CardInstanceCode = `${CardFaceCode}#${CopyNumber}`;

export type CardFace =
  | Readonly<{
      kind: "suited";
      code: SuitedCardFaceCode;
      rank: StandardRank;
      suit: Suit;
    }>
  | Readonly<{
      kind: "joker";
      code: JokerRank;
      rank: JokerRank;
    }>;

export type CardInstance = Readonly<{
  code: CardInstanceCode;
  face: CardFace;
  copyNumber: CopyNumber;
}>;

export type DecodeCardInstanceResult =
  | Readonly<{ ok: true; card: CardInstance }>
  | Readonly<{ ok: false; reason: "invalid-card-instance-code" }>;

const CARD_INSTANCE_PATTERN =
  /^(?:(10|[2-9JQKA])([SHDC])|(SMALL|BIG))#([1-3])$/;

export function decodeCardInstance(code: string): DecodeCardInstanceResult {
  const match = CARD_INSTANCE_PATTERN.exec(code);
  if (match === null) {
    return { ok: false, reason: "invalid-card-instance-code" };
  }

  const copyNumber = Number(match[4]) as CopyNumber;
  const jokerRank = match[3] as JokerRank | undefined;

  if (jokerRank !== undefined) {
    const face: CardFace = Object.freeze({
      kind: "joker",
      code: jokerRank,
      rank: jokerRank,
    });

    return {
      ok: true,
      card: Object.freeze({
        code: code as CardInstanceCode,
        face,
        copyNumber,
      }),
    };
  }

  const rank = match[1] as StandardRank;
  const suit = match[2] as Suit;
  const faceCode = `${rank}${suit}` as SuitedCardFaceCode;
  const face: CardFace = Object.freeze({
    kind: "suited",
    code: faceCode,
    rank,
    suit,
  });

  return {
    ok: true,
    card: Object.freeze({
      code: code as CardInstanceCode,
      face,
      copyNumber,
    }),
  };
}

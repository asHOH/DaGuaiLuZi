import { describe, expect, it } from "vitest";

import {
  decodeCardInstance,
  type CardFaceCode,
  type CopyNumber,
  type StandardRank,
  type Suit,
} from "../src/index.js";

const STANDARD_RANKS: readonly StandardRank[] = [
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
const SUITS: readonly Suit[] = ["S", "H", "D", "C"];
const COPY_NUMBERS: readonly CopyNumber[] = [1, 2, 3];
const CARD_FACE_CODES: readonly CardFaceCode[] = [
  ...STANDARD_RANKS.flatMap((rank) =>
    SUITS.map((suit) => `${rank}${suit}` as const),
  ),
  "SMALL",
  "BIG",
];

describe("decodeCardInstance", () => {
  it.each([
    ["AS#1", "suited", "A", "S", 1],
    ["10D#2", "suited", "10", "D", 2],
    ["SMALL#3", "joker", "SMALL", undefined, 3],
    ["BIG#1", "joker", "BIG", undefined, 1],
  ] as const)(
    "decodes canonical Card Instance code %s",
    (code, kind, rank, suit, copyNumber) => {
      const result = decodeCardInstance(code);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      expect(result.card).toMatchObject({
        code,
        copyNumber,
        face: {
          kind,
          code: code.slice(0, code.indexOf("#")),
          rank,
          ...(suit === undefined ? {} : { suit }),
        },
      });
    },
  );

  it.each([
    "AS",
    "AS#0",
    "AS#4",
    "SA#1",
    "TS#1",
    "1S#1",
    "as#1",
    "SMALLS#1",
    "BIG#01",
  ])("rejects non-canonical Card Instance code %s", (code) => {
    expect(decodeCardInstance(code)).toEqual({
      ok: false,
      reason: "invalid-card-instance-code",
    });
  });

  it("decodes every canonical Card Instance code without changing it", () => {
    for (const faceCode of CARD_FACE_CODES) {
      for (const copyNumber of COPY_NUMBERS) {
        const code = `${faceCode}#${copyNumber}`;
        const result = decodeCardInstance(code);

        expect(result.ok).toBe(true);
        if (!result.ok) {
          continue;
        }

        expect(result.card).toMatchObject({
          code,
          copyNumber,
          face: { code: faceCode },
        });
      }
    }
  });
});

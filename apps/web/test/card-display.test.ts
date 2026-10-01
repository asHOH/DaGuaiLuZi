import { expect, it } from "vitest";
import { type CardInstanceCode } from "@dglz/game-rules";
import { cardLabel, groupCards } from "../src/card-display";

it("sorts by rule strength, then SHCD, then copy without mutating the hand", () => {
  const hand: CardInstanceCode[] = [
    "AD#1",
    "AS#2",
    "AC#1",
    "AH#2",
    "AS#1",
    "3H#1",
    "2S#1",
    "SMALL#1",
    "BIG#1",
    "AH#1",
  ];
  const original = [...hand];
  expect(groupCards(hand, "3")).toEqual([
    { rank: "BIG", cards: ["BIG#1"] },
    { rank: "SMALL", cards: ["SMALL#1"] },
    { rank: "3", cards: ["3H#1"] },
    { rank: "A", cards: ["AS#1", "AS#2", "AH#1", "AH#2", "AC#1", "AD#1"] },
    { rank: "2", cards: ["2S#1"] },
  ]);
  expect(hand).toEqual(original);
  expect(cardLabel("10H#2")).toMatchObject({
    rank: "10",
    suit: "H",
    display: "红桃10",
    aria: "红桃10，第2张",
    red: true,
  });
  expect(cardLabel("BIG#1").red).toBe(true);
  expect(cardLabel("SMALL#1").red).toBe(false);
});

it("keeps all twelve copies of a rank together", () => {
  const cards = ["S", "H", "C", "D"].flatMap((suit) =>
    [1, 2, 3].map((copy) => `8${suit}#${copy}` as CardInstanceCode),
  );
  expect(groupCards(cards, "2")).toEqual([{ rank: "8", cards }]);
});

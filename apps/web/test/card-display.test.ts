import { expect, it } from "vitest";
import {
  type CardInstanceCode,
  type ClassifiedPlay,
  type TrumpRank,
} from "@dglz/game-rules";
import { cardLabel, groupCards, sortPlayedCards } from "../src/card-display";

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

it.each<{
  name: string;
  cards: CardInstanceCode[];
  play: Pick<ClassifiedPlay, "form" | "rank" | "representedFaces">;
  trump: TrumpRank;
  expected: CardInstanceCode[];
}>([
  {
    name: "full house with a stronger pair",
    cards: ["AS#1", "4H#1", "SMALL#1", "AC#1", "4S#1"],
    play: {
      form: "full-house",
      rank: "4",
      representedFaces: ["AS", "4H", "4S", "AC", "4S"],
    },
    trump: "2",
    expected: ["4S#1", "4H#1", "SMALL#1", "AS#1", "AC#1"],
  },
  {
    name: "four plus one with a trump kicker and duplicate cards",
    cards: ["2H#1", "8D#1", "BIG#1", "8S#2", "8S#1"],
    play: {
      form: "four-plus-one",
      rank: "8",
      representedFaces: ["2H", "8D", "8S", "8S", "8S"],
    },
    trump: "2",
    expected: ["8S#1", "8S#2", "8D#1", "BIG#1", "2H#1"],
  },
  {
    name: "ace-low straight with indexed joker substitutions and a natural trump",
    cards: ["SMALL#1", "3D#1", "5H#1", "BIG#1", "AC#1"],
    play: {
      form: "mixed-suit-straight",
      rank: "5",
      representedFaces: ["4S", "3D", "5H", "2S", "AC"],
    },
    trump: "3",
    expected: ["5H#1", "SMALL#1", "3D#1", "BIG#1", "AC#1"],
  },
  {
    name: "straight flush with ace high",
    cards: ["10S#1", "QS#1", "AS#1", "BIG#1", "JS#1"],
    play: {
      form: "straight-flush",
      rank: "A",
      representedFaces: ["10S", "QS", "AS", "KS", "JS"],
    },
    trump: "2",
    expected: ["AS#1", "BIG#1", "QS#1", "JS#1", "10S#1"],
  },
  {
    name: "flush with a joker representing trump",
    cards: ["AH#1", "BIG#1", "8H#1", "KH#1", "10H#1"],
    play: {
      form: "flush",
      rank: "3",
      representedFaces: ["AH", "3H", "8H", "KH", "10H"],
    },
    trump: "3",
    expected: ["BIG#1", "AH#1", "KH#1", "10H#1", "8H#1"],
  },
  {
    name: "triple with natural cards before deterministically ordered jokers",
    cards: ["SMALL#1", "BIG#1", "9D#1"],
    play: { form: "triple", rank: "9", representedFaces: ["9S", "9S", "9D"] },
    trump: "2",
    expected: ["9D#1", "BIG#1", "SMALL#1"],
  },
  {
    name: "joker-only play retains printed-rank order",
    cards: ["SMALL#1", "BIG#2", "BIG#1"],
    play: {
      form: "triple",
      rank: "SMALL",
      representedFaces: ["SMALL", "SMALL", "SMALL"],
    },
    trump: "2",
    expected: ["BIG#1", "BIG#2", "SMALL#1"],
  },
])(
  "sorts $name without mutating the recorded play",
  ({ cards, play, trump, expected }) => {
    const original = structuredClone({ cards, play });
    expect(sortPlayedCards(cards, trump, play)).toEqual(expected);
    expect({ cards, play }).toEqual(original);
  },
);

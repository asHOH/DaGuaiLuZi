import { expect, it } from "vitest";
import type { CardInstanceCode } from "@dglz/game-rules";
import {
  retainHandGroups,
  selectionIsGrouped,
  toggleHandGroup,
} from "../src/hand-groups";

it("groups only selected instances, retains remainders, and dissolves partial selections", () => {
  const hand: CardInstanceCode[] = ["AS#1", "AS#2", "KH#1", "3D#1", "9S#1"];
  expect(toggleHandGroup([], hand, [])).toEqual([]);
  expect(toggleHandGroup([], hand, hand)).toEqual([]);
  const first = toggleHandGroup([], hand, ["AS#1", "KH#1"]);
  const second = toggleHandGroup(first, hand, ["AS#2", "3D#1"]);
  expect(second).toEqual([
    ["AS#1", "KH#1"],
    ["AS#2", "3D#1"],
  ]);
  expect(selectionIsGrouped(second, [])).toBe(false);
  expect(selectionIsGrouped(second, ["AS#1", "AS#2"])).toBe(false);
  const merged = toggleHandGroup(second, hand, ["AS#1", "AS#2", "9S#1"]);
  expect(merged).toEqual([["KH#1"], ["3D#1"], ["AS#1", "AS#2", "9S#1"]]);
  expect(selectionIsGrouped(merged, ["AS#1"])).toBe(true);
  expect(toggleHandGroup(merged, hand, ["AS#1"])).toEqual([
    ["KH#1"],
    ["3D#1"],
    ["AS#2", "9S#1"],
  ]);
  expect(toggleHandGroup(merged, hand, hand)).toEqual([]);
  expect(second).toEqual([
    ["AS#1", "KH#1"],
    ["AS#2", "3D#1"],
  ]);
});

it("allows singletons, prunes played cards, and dissolves a group covering the remaining hand", () => {
  const hand: CardInstanceCode[] = ["AS#1", "KH#1", "3D#1"];
  expect(toggleHandGroup([], hand, ["AS#1"])).toEqual([["AS#1"]]);
  expect(toggleHandGroup([["AS#1"]], hand, ["AS#1"])).toEqual([]);
  const groups: CardInstanceCode[][] = [["AS#1", "KH#1"], ["3D#1"]];
  expect(retainHandGroups(groups, ["KH#1", "3D#1"])).toEqual([
    ["KH#1"],
    ["3D#1"],
  ]);
  expect(retainHandGroups(groups, ["AS#1", "KH#1"])).toEqual([]);
  expect(retainHandGroups(groups, [])).toEqual([]);
  expect(retainHandGroups([["AS#1", "KH#1"]], ["AS#1", "3D#1"])).toEqual([
    ["AS#1"],
  ]);
});

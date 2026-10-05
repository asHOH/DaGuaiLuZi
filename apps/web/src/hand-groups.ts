import type { CardInstanceCode } from "@dglz/game-rules";

export function retainHandGroups(
  groups: readonly CardInstanceCode[][],
  hand: readonly CardInstanceCode[],
): CardInstanceCode[][] {
  const remaining = groups
    .map((group) => group.filter((card) => hand.includes(card)))
    .filter((group) => group.length > 0);
  return remaining.length === 1 && remaining[0]!.length === hand.length
    ? []
    : remaining;
}

export function selectionIsGrouped(
  groups: readonly CardInstanceCode[][],
  selected: readonly CardInstanceCode[],
) {
  return (
    selected.length > 0 &&
    groups.some((group) => selected.every((card) => group.includes(card)))
  );
}

export function toggleHandGroup(
  groups: readonly CardInstanceCode[][],
  hand: readonly CardInstanceCode[],
  selected: readonly CardInstanceCode[],
) {
  if (
    selected.length === 0 ||
    (groups.length === 0 && selected.length === hand.length)
  )
    return groups;
  const remaining = groups.map((group) =>
    group.filter((card) => !selected.includes(card)),
  );
  if (!selectionIsGrouped(groups, selected)) remaining.push([...selected]);
  return retainHandGroups(remaining, hand);
}

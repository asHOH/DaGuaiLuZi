import { expect, it } from "vitest";
import {
  SCREENS,
  previewFixtures,
  readSelection,
  selectionSearch,
  statesFor,
} from "../dev/preview-scenarios";

it.each([4, 6] as const)(
  "validates every supported %i-player preview and its card counts",
  (players) => {
    for (const screen of SCREENS) {
      for (const [state] of statesFor(screen.id, players)) {
        const selection = readSelection(
          `screen=${screen.id}&state=${state}&players=${players}`,
        );
        expect(readSelection(selectionSearch(selection))).toEqual(selection);
        const { room, replay } = previewFixtures(selection);
        expect(room.view.seats).toHaveLength(players);
        expect(
          room.view.lifecycle !== "ACTIVE" ||
            room.view.handSizes[0] === room.view.hand.length,
        ).toBe(true);
        expect(replay.originalDeal.map((cards) => cards.length)).toEqual(
          Array(players).fill(27),
        );
        expect(new Set(replay.originalDeal.flat()).size).toBe(players * 27);
        expect(replay.steps.at(-1)?.result).toEqual(replay.summary.result);
      }
    }
  },
);

it("normalizes invalid links and excludes six-player-only Return choices at four seats", () => {
  expect(
    readSelection(
      "screen=unknown&state=unknown&players=9&viewport=unknown&connection=unknown",
    ),
  ).toEqual({
    screen: "history",
    state: "filled",
    players: 4,
    viewport: "fit",
    connection: "ready",
  });
  expect(readSelection("screen=table&state=return-offer&players=4").state).toBe(
    "lead",
  );
  expect(readSelection("screen=table&state=return-offer&players=6").state).toBe(
    "return-offer",
  );
});

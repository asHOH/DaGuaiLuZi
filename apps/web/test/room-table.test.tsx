import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { rulesConfigurationPreset, type RoomViewData } from "@dglz/protocol";
import { RoomTable } from "../src/RoomTable.js";

it("distinguishes unfinished draw players from explicitly caught players", () => {
  const room: RoomViewData = {
    revision: 1,
    view: {
      lifecycle: "LOBBY",
      roomId: "room",
      ownerId: "alice",
      members: [{ playerId: "alice", joinOrder: 0, ready: false }],
      seats: [{ seatIndex: 0, playerId: "alice" }],
      rulesConfiguration: rulesConfigurationPreset("dglz-4p-2d-v1", "省心"),
      seatingPolicy: "fixed",
      matchRulesConfigurationLocked: true,
      seatingPolicyLocked: true,
      lastHandResult: {
        handNumber: 1,
        result: {
          outcome: "draw",
          firstFinisherTeam: 0,
          nextDealerTeam: 0,
          caughtPlayerIds: [],
        },
        finishPositions: [null],
        teamLevels: ["2", "2"],
        seats: [{ seatIndex: 0, playerId: "alice" }],
      },
    },
  };
  const render = () =>
    renderToStaticMarkup(
      <RoomTable
        room={room}
        accountId="alice"
        locked={false}
        pending={false}
        onCommand={() => {}}
      />,
    );
  expect(render()).toContain("未完牌");
  expect(render()).not.toContain("被捉");
  room.view.lastHandResult!.result = {
    outcome: "win",
    firstFinisherTeam: 1,
    winningTeam: 1,
    nextDealerTeam: 1,
    caughtPlayerIds: ["alice"],
  };
  expect(render()).toContain("被捉");
  expect(render()).not.toContain("未完牌");
});

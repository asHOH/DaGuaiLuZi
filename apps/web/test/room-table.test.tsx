import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { rulesConfigurationPreset, type RoomViewData } from "@dglz/protocol";
import { RoomTable } from "../src/RoomTable.js";

it("shows the final Match count and levels, with a winner only for natural completion", () => {
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
      matchSummary: {
        outcome: "completed",
        winningTeam: 1,
        endingReason: "team-level-6",
        completedHandCount: 7,
        teamLevels: ["3", "6"],
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
  const completed = render();
  expect(completed).toContain("比赛结束");
  expect(completed).toContain("二队获胜");
  expect(completed).toContain("已完成 7 局");
  expect(completed).toContain("一队等级 3 · 二队等级 6");
  room.view.matchSummary = {
    outcome: "aborted",
    completedHandCount: 7,
    teamLevels: ["3", "5"],
  };
  const aborted = render();
  expect(aborted).toContain("比赛已终止");
  expect(aborted).not.toContain("获胜");
  expect(aborted).toContain("已完成 7 局");
  expect(aborted).toContain("一队等级 3 · 二队等级 5");
});

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

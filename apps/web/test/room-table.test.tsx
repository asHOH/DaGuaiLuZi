import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { rulesConfigurationPreset, type RoomViewData } from "@dglz/protocol";
import { RoomTable } from "../src/RoomTable.js";

it("shows Challenge rules and completion sharing only with an eligible source reference", () => {
  const room: RoomViewData = {
    revision: 10,
    view: {
      lifecycle: "LOBBY",
      roomId: "room",
      ownerId: "alice",
      members: [{ playerId: "alice", joinOrder: 0, ready: false }],
      seats: [{ seatIndex: 0, playerId: "alice" }],
      rulesConfiguration: rulesConfigurationPreset("dglz-4p-2d-v1", "省心"),
      seatingPolicy: "fixed",
      matchRulesConfigurationLocked: false,
      seatingPolicyLocked: false,
      selectedActivity: "challenge",
      effectiveRulesetId: "dglz-6p-3d-v1",
      effectiveRulesConfiguration: rulesConfigurationPreset(
        "dglz-6p-3d-v1",
        "自主",
      ),
      teamLevels: ["3", "4"],
      trumpRank: "4",
      challengeSummary: {
        outcome: "completed",
        handStartSequence: 3,
        result: {
          outcome: "draw",
          firstFinisherTeam: 0,
          nextDealerTeam: 0,
          caughtPlayerIds: [],
        },
      },
    },
  };
  const render = (accountId: string) =>
    renderToStaticMarkup(
      <RoomTable
        room={room}
        accountId={accountId}
        locked={false}
        pending={false}
        onCommand={() => {}}
      />,
    );
  const owner = render("alice");
  expect(owner).toContain("同牌挑战已完成");
  expect(owner).toContain("本局平局");
  expect(owner).toContain("生成同牌挑战码");
  expect(owner).toContain("六人三副牌");
  expect(owner).toContain("进贡方从候选中选择");
  expect(owner).toContain("查看牌局");
  expect(owner).toContain("选择比赛");
  expect(owner).not.toContain("设置牌局规则");
  if (room.view.lifecycle !== "LOBBY") throw new Error("expected-lobby");
  delete room.view.challengeSummary!.handStartSequence;
  const member = render("bob");
  expect(member).not.toContain("生成同牌挑战码");
  expect(member).not.toContain("查看牌局");
  expect(member).toContain("同牌挑战已完成");
});

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

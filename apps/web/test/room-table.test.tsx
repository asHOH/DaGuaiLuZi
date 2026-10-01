import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { rulesConfigurationPreset, type RoomViewData } from "@dglz/protocol";
import { RoomTable } from "../src/RoomTable.js";

it.each([4, 6])(
  "renders public plays once and only declares low opponent counts at a %i-player table",
  (count) => {
    const latestPlays: Extract<
      RoomViewData["view"],
      { lifecycle: "ACTIVE" }
    >["latestPlays"] = [
      {
        playerId: "p1",
        seatIndex: 1,
        cards: ["9S#1"],
        form: "single",
        rank: "9",
        representedFaces: ["9S"],
        comparisonRanks: ["9"],
      },
      {
        playerId: "p2",
        seatIndex: 2,
        cards: ["10C#1"],
        form: "single",
        rank: "10",
        representedFaces: ["10C"],
        comparisonRanks: ["10"],
      },
    ];
    const room: RoomViewData = {
      revision: 10,
      view: {
        lifecycle: "ACTIVE",
        roomId: "room",
        ownerId: "p0",
        selectedActivity: "match",
        members: Array.from({ length: count }, (_, i) => ({
          playerId: `p${i}`,
          joinOrder: i,
          ready: true,
        })),
        seats: Array.from({ length: count }, (_, seatIndex) => ({
          seatIndex,
          playerId: `p${seatIndex}`,
        })),
        rulesConfiguration: rulesConfigurationPreset(
          count === 4 ? "dglz-4p-2d-v1" : "dglz-6p-3d-v1",
          "省心",
        ),
        seatingPolicy: "fixed",
        matchRulesConfigurationLocked: true,
        seatingPolicyLocked: true,
        dealerSeat: 0,
        dealerTeam: 0,
        teamLevels: ["2", "2"],
        trumpRank: "2",
        failureCounters: [0, 0],
        completedHandCount: 0,
        handSizes: [27, 11, 10, 0, 9, 26].slice(0, count),
        hand: ["AS#2", "AH#1", "AS#1", "AC#1", "AD#1", "SMALL#1", "BIG#1"],
        latestPlays,
        unbeatenPlay: latestPlays[1],
        currentActor: "p0",
        currentActorSeat: 0,
        passedPlayerIds: ["p1"],
        finishPositions: Array(count).fill(null),
        setupStage: "play",
        tributeTransfers: [],
        returnCandidates: [],
        pendingPlayerIds: [],
        eligibleTributeCards: [],
      },
    };
    const render = (accountId = "p0") =>
      renderToStaticMarkup(
        <RoomTable
          room={room}
          accountId={accountId}
          locked={false}
          pending={false}
          onCommand={() => {}}
        />,
      );
    const markup = render();
    expect(markup.match(/<svg\b/g)).toHaveLength(14);
    expect(markup).not.toMatch(/[♠♥♣♦]|<text\b/);
    for (const label of ["黑桃A", "红桃A", "梅花A", "方块A", "小王", "大王"]) {
      expect(markup).toContain(`aria-label="${label}，第1张"`);
    }
    expect(
      [...markup.matchAll(/data-testid="remaining-count">(\d+) 张/g)].map(
        (match) => Number(match[1]),
      ),
    ).toEqual(count === 4 ? [10, 0, 27] : [10, 0, 9, 27]);
    expect(markup.match(/data-testid="played-hand"/g)).toHaveLength(2);
    expect(markup.match(/data-unbeaten="true"/g)).toHaveLength(1);
    expect(markup.match(/data-testid="player-avatar"/g)).toHaveLength(
      count - 1,
    );
    expect(markup).not.toMatch(/本人|当前行动|当前牌 ·|>单张<|>[一二]队</);
    expect(markup).toContain('data-own-turn="true"');
    expect(markup).toContain(">出牌</button>");
    expect(markup).toContain(">不出</button>");
    expect(markup.indexOf(">出牌</button>")).toBeLessThan(
      markup.indexOf('data-testid="hand-card"'),
    );
    const offTurn = render("p2");
    expect(offTurn).toContain('data-own-turn="false"');
    expect(offTurn).not.toMatch(/>(出牌|不出)<\/button>/);
    expect(markup.match(/aria-current="true"/g)).toHaveLength(2);
    expect(markup.match(/data-card="9S#1"/g)).toHaveLength(1);
    expect(markup).toContain('data-seat="1" data-position="1"');
    expect(markup).toContain(
      'data-seat="0" data-position="0" data-self="true"',
    );
    expect(render("p2")).toContain(
      'data-seat="2" data-position="0" data-self="true"',
    );
    expect(markup).not.toContain('aria-label="当前出牌"');
    expect(markup).not.toContain('id="hand-title"');
    expect(markup).not.toContain("清空选择");
    expect(markup).not.toMatch(/>[^<]*号位</);
    if (room.view.lifecycle !== "ACTIVE")
      throw new Error("expected-active-room");
    for (const dealerTeam of [0, 1] as const) {
      room.view.dealerTeam = dealerTeam;
      room.view.teamLevels = ["3", "4"];
      room.view.trumpRank = dealerTeam === 0 ? "3" : "4";
      const levels = render();
      const currentTeam = dealerTeam === 0 ? "一队" : "二队";
      const otherTeam = dealerTeam === 0 ? "二队" : "一队";
      const currentLabel = `aria-label="${currentTeam}，当前级牌 ${room.view.trumpRank}"`;
      const otherLabel = `aria-label="${otherTeam}等级 ${room.view.teamLevels[1 - dealerTeam]}"`;
      expect(levels).toContain(currentLabel);
      expect(levels).toContain(otherLabel);
      expect(levels.indexOf(currentLabel)).toBeLessThan(
        levels.indexOf(otherLabel),
      );
    }
  },
);

it("offers vacating only the current member's seat and disables it while syncing or pending", () => {
  const room: RoomViewData = {
    revision: 1,
    view: {
      lifecycle: "LOBBY",
      roomId: "room",
      ownerId: "alice",
      members: [
        { playerId: "alice", joinOrder: 0, ready: true },
        { playerId: "bob", joinOrder: 1, ready: false },
      ],
      seats: [
        { seatIndex: 0, playerId: "alice" },
        { seatIndex: 1, playerId: "bob" },
        { seatIndex: 2 },
        { seatIndex: 3 },
      ],
      rulesConfiguration: rulesConfigurationPreset("dglz-4p-2d-v1", "省心"),
      seatingPolicy: "fixed",
      matchRulesConfigurationLocked: false,
      seatingPolicyLocked: false,
    },
  };
  const render = (accountId: string, locked = false, pending = false) =>
    renderToStaticMarkup(
      <RoomTable
        room={room}
        accountId={accountId}
        locked={locked}
        pending={pending}
        onCommand={() => {}}
      />,
    );
  for (const accountId of ["alice", "bob"]) {
    expect(render(accountId).match(/>已准备</g)).toHaveLength(1);
    expect(render(accountId).match(/>未准备</g)).toHaveLength(1);
    expect(render(accountId)).not.toContain("待入座");
    expect(
      render(accountId).match(/<button[^>]*>离座<\/button>/g),
    ).toHaveLength(1);
    expect(render(accountId)).toContain("离座将取消准备");
    expect(render(accountId)).not.toMatch(
      /<button[^>]*disabled[^>]*>离座<\/button>/,
    );
    expect(render(accountId, true)).toMatch(
      /<button[^>]*disabled[^>]*>离座<\/button>/,
    );
    expect(render(accountId, false, true)).toMatch(
      /<button[^>]*disabled[^>]*>离座<\/button>/,
    );
  }
  room.view.seats[0] = { seatIndex: 0 };
  expect(render("alice")).not.toMatch(/<button[^>]*>离座<\/button>/);
  expect(render("alice")).toContain("待入座");
  expect(render("alice").match(/本人 · 房主/g)).toHaveLength(1);
  expect(render("alice").match(/aria-label="座位安排"/g)).toHaveLength(1);
  expect(render("alice")).not.toContain("座位方式");
  expect(render("bob")).toContain("座位方式");
});

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
  expect(owner.match(/六人三副牌/g)).toHaveLength(1);
  expect(owner).toContain("座位安排");
  room.view.seatingPolicyLocked = true;
  expect(render("alice")).not.toContain("座位安排");
  expect(render("alice")).toContain("已锁定");
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

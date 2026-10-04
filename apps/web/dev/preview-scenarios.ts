import {
  CompletedHandSummarySchema,
  HandReplaySchema,
  RoomViewDataSchema,
  rulesConfigurationPreset,
  type PlayerView,
} from "@dglz/protocol";

// Named visual situations, not an alternative game engine. Keep samples deterministic.
export const SCREENS = [
  {
    id: "account",
    label: "登录与账号",
    states: [
      ["login", "登录"],
      ["register", "注册"],
      ["busy", "正在登录"],
      ["error", "登录失败"],
      ["password", "修改密码"],
      ["password-error", "密码错误"],
    ],
  },
  {
    id: "home",
    label: "开桌与加入",
    states: [
      ["default", "默认"],
      ["busy", "正在创建"],
      ["error", "房间码错误"],
    ],
  },
  {
    id: "lobby",
    label: "房间大厅",
    states: [
      ["open", "等待入座"],
      ["ready", "等待准备"],
      ["locked", "规则已锁定"],
      ["challenge", "同牌挑战"],
      ["completed", "挑战结束"],
      ["interrupted", "房间中断"],
      ["archived", "房间归档"],
    ],
  },
  {
    id: "table",
    label: "正在打牌",
    states: [
      ["lead", "轮到你领牌"],
      ["respond", "轮到你跟牌"],
      ["waiting", "其他玩家行动"],
      ["tribute", "选择进贡牌"],
      ["return", "选择还牌"],
      ["return-offer", "提供还牌候选"],
      ["return-pick", "收回候选还牌"],
      ["pairing", "进贡配对选择"],
      ["leader", "首家选择"],
      ["settled", "本局结算"],
      ["previous", "上一局结果"],
    ],
  },
  {
    id: "history",
    label: "牌局记录",
    states: [
      ["filled", "已有记录"],
      ["empty", "没有记录"],
      ["loading", "正在加载"],
      ["error", "加载失败"],
    ],
  },
  {
    id: "replay",
    label: "牌局回放",
    states: [
      ["loaded", "发牌与播放"],
      ["loading", "正在加载"],
      ["error", "加载失败"],
    ],
  },
  {
    id: "challenge",
    label: "挑战与分享",
    states: [
      ["lookup", "输入挑战码"],
      ["share", "分享已完成牌局"],
      ["error", "请求失败"],
      ["copy-error", "复制失败"],
    ],
  },
] as const;

export const CONNECTIONS = [
  ["ready", "已连接"],
  ["offline", "已断开"],
  ["syncing", "同步中"],
  ["pending", "提交中"],
  ["uncertain", "等待确认"],
  ["error", "操作失败"],
] as const;
export const VIEWPORTS = [
  { id: "fit", label: "自适应", width: undefined, height: 900 },
  { id: "desktop", label: "桌面 · 1280", width: 1280, height: 900 },
  { id: "phone", label: "手机 · 390", width: 390, height: 844 },
  { id: "narrow", label: "窄屏 · 320", width: 320, height: 844 },
] as const;
export type ScreenId = (typeof SCREENS)[number]["id"];
export function statesFor(screen: ScreenId, players: 4 | 6) {
  return SCREENS.find((item) => item.id === screen)!.states.filter(
    ([state]) =>
      players === 6 || (state !== "return-offer" && state !== "return-pick"),
  );
}
export type PreviewSelection = {
  screen: ScreenId;
  state: string;
  players: 4 | 6;
  connection: (typeof CONNECTIONS)[number][0];
  viewport: (typeof VIEWPORTS)[number]["id"];
};

export function readSelection(search: string): PreviewSelection {
  const query = new URLSearchParams(search);
  const screen =
    SCREENS.find((item) => item.id === query.get("screen")) ?? SCREENS[4];
  const players = query.get("players") === "6" ? 6 : 4;
  const states = statesFor(screen.id, players);
  const state =
    states.find((item) => item[0] === query.get("state"))?.[0] ?? states[0]![0];
  return {
    screen: screen.id,
    state,
    players,
    connection:
      CONNECTIONS.find((item) => item[0] === query.get("connection"))?.[0] ??
      "ready",
    viewport:
      VIEWPORTS.find((item) => item.id === query.get("viewport"))?.id ?? "fit",
  };
}

export function selectionSearch(selection: PreviewSelection): string {
  return new URLSearchParams({
    ...selection,
    players: String(selection.players),
  }).toString();
}

export const PREVIEW_ACCOUNT = "preview-player-0";
export const PREVIEW_ROOM = "11111111-1111-4111-8111-111111111111";
export const PREVIEW_CODE = "abcdef123456";
const hand = [
  "BIG#1",
  "SMALL#1",
  "2H#1",
  "2D#1",
  "AS#1",
  "AH#1",
  "AC#1",
  "KS#1",
  "KH#1",
  "KC#1",
  "QS#1",
  "QD#1",
  "JS#1",
  "JH#1",
  "10S#1",
  "10C#1",
  "9H#1",
  "9D#1",
  "8S#1",
  "8C#1",
  "7H#1",
  "7D#1",
  "6S#1",
  "6C#1",
  "5H#1",
  "4S#1",
  "3D#1",
] as const;

export function previewFixtures(selection: PreviewSelection) {
  const { players, state, screen } = selection;
  const playerIds = Array.from(
    { length: players },
    (_, i) => `preview-player-${i}`,
  );
  const rulesConfiguration = rulesConfigurationPreset(
    players === 4 ? "dglz-4p-2d-v1" : "dglz-6p-3d-v1",
    "自主",
  );
  const seats = playerIds.map((playerId, seatIndex) => ({
    playerId,
    seatIndex,
  }));
  const base = {
    roomId: PREVIEW_ROOM,
    ownerId: PREVIEW_ACCOUNT,
    members: playerIds.map((playerId, joinOrder) => ({
      playerId,
      joinOrder,
      ready: joinOrder > 0,
    })),
    seats,
    rulesConfiguration,
    seatingPolicy: "fixed" as const,
    matchRulesConfigurationLocked: false,
    seatingPolicyLocked: false,
  };
  const summary = CompletedHandSummarySchema.parse({
    roomId: PREVIEW_ROOM,
    handStartSequence: 12,
    activity: "match",
    handNumber: 1,
    completedAt: Date.UTC(2026, 9, 5, 4, 0),
    rulesConfiguration,
    seatingPolicy: "fixed",
    playerIds,
    trumpRank: "2",
    challengeCode: PREVIEW_CODE,
    result: {
      outcome: "win",
      firstFinisherTeam: 0,
      winningTeam: 0,
      nextDealerTeam: 0,
      caughtPlayerIds: [playerIds.at(-1)],
    },
    finishPositions: playerIds.map((_, i) =>
      i === players - 1 ? null : i + 1,
    ),
    teamLevels: ["3", "2"],
  });
  const latestPlays = [
    {
      playerId: playerIds[1]!,
      seatIndex: 1,
      cards: ["9S#1" as const],
      form: "single" as const,
      rank: "9" as const,
      representedFaces: ["9S" as const],
      comparisonRanks: ["9" as const],
    },
  ];
  let view: PlayerView = {
    ...base,
    lifecycle: "ACTIVE",
    selectedActivity: "match",
    matchRulesConfigurationLocked: true,
    seatingPolicyLocked: true,
    dealerSeat: 0,
    dealerTeam: 0,
    teamLevels: ["2", "2"],
    trumpRank: "2",
    failureCounters: [0, 0],
    completedHandCount: 0,
    handNumber: 1,
    hand: [...hand],
    handSizes: playerIds.map((_, i) =>
      i === 0 ? hand.length : i === 1 ? 9 : 27,
    ),
    latestPlays: [],
    currentActor: PREVIEW_ACCOUNT,
    currentActorSeat: 0,
    passedPlayerIds: [],
    finishPositions: playerIds.map(() => null),
    setupStage: "play",
    tributeTransfers: [],
    returnCandidates: [],
    pendingPlayerIds: [],
    eligibleTributeCards: [],
  };
  if (screen === "lobby") {
    view = { ...base, lifecycle: "LOBBY", selectedActivity: "match" };
    if (state === "open") {
      view.members = base.members.slice(0, 2);
      view.seats = seats.map((seat) =>
        seat.seatIndex === 1 ? seat : { seatIndex: seat.seatIndex },
      );
    }
    if (state === "locked") {
      view.matchRulesConfigurationLocked = true;
      view.seatingPolicyLocked = true;
    }
    if (state === "challenge" || state === "completed") {
      view.selectedActivity = "challenge";
      view.effectiveRulesetId = rulesConfiguration.rulesetId;
      view.effectiveRulesConfiguration = rulesConfiguration;
      view.teamLevels = ["2", "2"];
      view.trumpRank = "2";
      if (state === "completed")
        view.challengeSummary = {
          outcome: "completed",
          handStartSequence: 12,
          result: summary.result,
        };
    }
    if (state === "interrupted" || state === "archived") {
      view = {
        ...view,
        lifecycle: state === "interrupted" ? "INTERRUPTED" : "ARCHIVED",
      };
    }
  } else if (screen === "table") {
    if (state === "respond" || state === "waiting") {
      view.latestPlays = latestPlays;
      view.unbeatenPlay = latestPlays[0];
      view.passedPlayerIds = [playerIds[2]!];
    }
    if (state === "waiting") {
      view.currentActor = playerIds[3]!;
      view.currentActorSeat = 3;
    }
    if (
      [
        "tribute",
        "return",
        "return-offer",
        "return-pick",
        "pairing",
        "leader",
      ].includes(state)
    ) {
      delete view.currentActor;
      delete view.currentActorSeat;
      view.pendingPlayerIds = [PREVIEW_ACCOUNT];
      view.handNumber = 2;
      view.completedHandCount = 1;
      view.handSizes = playerIds.map(() => 27);
    }
    if (state === "tribute") {
      view.setupStage = "tribute-selection";
      view.eligibleTributeCards = ["BIG#1"];
    }
    if (
      state === "return" ||
      state === "return-offer" ||
      state === "return-pick"
    ) {
      view.setupStage = "return-card-selection";
      const choosing = state === "return-pick";
      view.tributeTransfers = [
        {
          giverId: choosing ? PREVIEW_ACCOUNT : playerIds[1]!,
          giverSeat: choosing ? 0 : 1,
          recipientId: choosing ? playerIds[1]! : PREVIEW_ACCOUNT,
          recipientSeat: choosing ? 1 : 0,
          card: choosing ? "BIG#1" : "BIG#2",
          rank: "BIG",
        },
      ];
      if (
        rulesConfiguration.rulesetId === "dglz-6p-3d-v1" &&
        state === "return"
      )
        view.rulesConfiguration = {
          ...rulesConfiguration,
          returnCardSelection: "recipient-choice",
        };
      if (choosing) {
        view.hand = view.hand.filter((card) => card !== "BIG#1");
        view.handSizes[0] = 26;
        view.handSizes[1] = 28;
      } else {
        view.hand.push("BIG#2");
        view.handSizes[0] = 28;
        view.handSizes[1] = 26;
      }
      if (choosing)
        view.returnCandidates = [
          {
            giverId: PREVIEW_ACCOUNT,
            giverSeat: 0,
            recipientId: playerIds[1]!,
            recipientSeat: 1,
            tributeCard: "BIG#1",
            candidateCards: ["5D#1", "6D#1", "7S#1"],
          },
        ];
    }
    if (state === "pairing" || state === "leader") {
      view.setupStage =
        state === "pairing" ? "recipient-pairing-tie" : "leader-selection-tie";
      view.tieKind =
        state === "pairing" ? "recipient-pairing" : "leader-selection";
      view.tieRound = 1;
      view.tieVoterIds = [PREVIEW_ACCOUNT, playerIds[2]!];
      view.tieCandidateIds = [playerIds[1]!, playerIds[3]!];
      view.tieSubmittedPlayerIds = [];
    }
    if (state === "settled") {
      view.handResult = summary.result;
      view.completedHandCount = 1;
      view.teamLevels = summary.teamLevels;
      view.hand = [];
      view.handSizes = playerIds.map((_, i) => (i === players - 1 ? 4 : 0));
      view.finishPositions = summary.finishPositions;
      delete view.currentActor;
      delete view.currentActorSeat;
    }
    if (state === "previous") {
      view.handNumber = 2;
      view.completedHandCount = 1;
      view.lastHandResult = {
        handNumber: 1,
        handStartSequence: 12,
        result: summary.result,
        finishPositions: summary.finishPositions,
        teamLevels: summary.teamLevels,
        seats,
      };
    }
  }
  const room = RoomViewDataSchema.parse({ revision: 1, view });
  // Distinct physical cards across all recorded hands, with deterministic ordering.
  const deck: string[] = [];
  for (let copy = 1; copy <= players / 2; copy++) {
    for (const rank of [
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
    ]) {
      for (const suit of ["S", "H", "C", "D"])
        deck.push(`${rank}${suit}#${copy}`);
    }
    deck.push(`SMALL#${copy}`, `BIG#${copy}`);
  }
  const hands = playerIds.map((_, i) =>
    deck.filter((__, index) => index % players === i),
  );
  const first = {
    sequence: 12,
    actions: [{ text: "原始发牌（进贡前）" }],
    hands,
    dealerTeam: 0,
    latestPlays: [],
    currentActorSeat: 0,
    passedSeatIndices: [],
    finishPositions: playerIds.map(() => null),
    setupStage: "play",
    teamLevels: ["2", "2"],
  };
  const card = hands[0]![0]!;
  const play = {
    playerId: PREVIEW_ACCOUNT,
    seatIndex: 0,
    cards: [card],
    form: "single",
    rank: "2",
    representedFaces: [card.split("#")[0]],
    comparisonRanks: ["2"],
  };
  const replay = HandReplaySchema.parse({
    summary,
    originalDeal: hands,
    steps: [
      first,
      {
        ...first,
        sequence: 13,
        actions: [{ text: "一号位出牌", cards: [card] }],
        hands: hands.map((cards, i) => (i === 0 ? cards.slice(1) : cards)),
        latestPlays: [play],
        unbeatenPlay: play,
        currentActorSeat: 1,
      },
      {
        ...first,
        sequence: 14,
        actions: [{ text: "本局结算" }],
        hands: hands.map((cards, i) =>
          i === players - 1 ? cards.slice(0, 4) : [],
        ),
        currentActorSeat: undefined,
        finishPositions: summary.finishPositions,
        teamLevels: summary.teamLevels,
        result: summary.result,
      },
    ],
  });
  return { room, summary, replay };
}

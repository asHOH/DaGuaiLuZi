import {
  derivePlayerView,
  evolve,
  type Event,
  type State,
} from "@dglz/game-core";
import {
  HandReplaySchema,
  type HandReplay,
  type HandReplayStep,
} from "@dglz/protocol";
import type { AppDatabase } from "./db/index.js";
import type { CompletedHand } from "./hand-history.js";
import { readRoomEvents, UnsupportedPersistedEventError } from "./rooms.js";

// These facts start a choice/play; finish, turn, tie resolution and settlement are its consequences.
const actionStarts = new Set<Event["type"]>([
  "CardsPlayed",
  "PlayerPassed",
  "TributeCardSelected",
  "ReturnCandidatesOffered",
  "ReturnTransferred",
  "TieChoiceBallotSubmitted",
]);

function describe(
  event: Event,
  players: readonly string[],
): HandReplayStep["actions"] {
  const seat = (index: number) => `${index + 1}号位`;
  const player = (id: string) => seat(players.indexOf(id));
  const tie = (kind: string) =>
    kind === "recipient-pairing" ? "进贡配对" : "首家选择";
  switch (event.type) {
    case "CardsPlayed":
      return [
        { text: `${seat(event.seatIndex)}出牌`, cards: [...event.cards] },
      ];
    case "PlayerPassed":
      return [{ text: `${seat(event.seatIndex)}不出` }];
    case "PlayerFinished":
      return [
        { text: `${seat(event.seatIndex)}第${event.finishPosition}名出完手牌` },
      ];
    case "LeadReset":
      return [{ text: `${seat(event.seatIndex)}重新领牌` }];
    case "TurnAdvanced":
    case "HandResultDetermined":
      return [];
    case "TributeCardSelected":
      return [
        { text: `${seat(event.giverSeat)}确定贡牌`, cards: [event.card] },
      ];
    case "TributeTransferred":
      return [
        {
          text: `${seat(event.giverSeat)}向${seat(event.recipientSeat)}进贡`,
          cards: [event.card],
        },
      ];
    case "ReturnCandidatesOffered":
      return [
        {
          text: `${seat(event.recipientSeat)}向${seat(event.giverSeat)}提供还牌候选`,
          cards: [...event.candidateCards],
        },
      ];
    case "ReturnTransferred":
      return [
        {
          text: `${seat(event.recipientSeat)}向${seat(event.giverSeat)}还牌`,
          cards: [event.card],
        },
      ];
    case "HandLeaderChosen":
      return [{ text: `${seat(event.seatIndex)}成为首家` }];
    case "TieChoiceBallotSubmitted":
      return [
        {
          text: `${player(event.voterId)}已提交${tie(event.tieKind)}第${event.round}轮选择`,
        },
      ];
    case "TieChoiceRoundResolved":
      return [
        {
          text: `${tie(event.tieKind)}第${event.round}轮揭晓${event.fallback ? "，采用自动裁定" : ""}`,
        },
        ...event.ballots.map((ballot) => ({
          text: `${player(ballot.voterId)}：${ballot.candidateId === null ? "放弃" : player(ballot.candidateId)}`,
        })),
        ...event.committedPairs.map((pair) => ({
          text: `${seat(pair.giverSeat)}配对${seat(pair.recipientSeat)}`,
        })),
        ...(event.selectedLeaderId === undefined
          ? []
          : [{ text: `${player(event.selectedLeaderId)}当选首家` }]),
      ];
    case "HandSettled":
    case "ChallengeHandCompleted":
      return [{ text: "本局结算" }];
    default:
      throw new UnsupportedPersistedEventError();
  }
}

function snapshot(
  state: State,
  players: readonly string[],
  sequence: number,
  actions: HandReplayStep["actions"],
  recordedDealerTeam?: HandReplayStep["dealerTeam"],
): HandReplayStep {
  const view = derivePlayerView(state, "__replay__");
  if (
    view.setupStage === undefined ||
    view.finishPositions === undefined ||
    view.teamLevels === undefined ||
    view.dealerTeam === undefined ||
    view.latestPlays === undefined
  )
    throw new UnsupportedPersistedEventError();
  return {
    sequence,
    actions,
    // Settlement updates the engine's dealer for the next Hand.
    dealerTeam: recordedDealerTeam ?? view.dealerTeam,
    latestPlays: view.latestPlays.map((play) => ({
      ...play,
      cards: [...play.cards],
      representedFaces: [...play.representedFaces],
      comparisonRanks: [...play.comparisonRanks],
    })),
    hands: players.map((player) => [
      ...(derivePlayerView(state, player).hand ?? []),
    ]),
    ...(view.currentActorSeat === undefined
      ? {}
      : { currentActorSeat: view.currentActorSeat }),
    ...(view.unbeatenPlay === undefined
      ? {}
      : {
          unbeatenPlay: {
            ...view.unbeatenPlay,
            cards: [...view.unbeatenPlay.cards],
            representedFaces: [...view.unbeatenPlay.representedFaces],
            comparisonRanks: [...view.unbeatenPlay.comparisonRanks],
          },
        }),
    passedSeatIndices: (view.passedPlayerIds ?? []).map((player) =>
      players.indexOf(player),
    ),
    finishPositions: view.finishPositions.map((position) => position ?? null),
    setupStage: view.setupStage,
    teamLevels: [...view.teamLevels],
    ...(view.handResult === undefined
      ? {}
      : {
          result: {
            ...view.handResult,
            caughtPlayerIds: [...view.handResult.caughtPlayerIds],
          },
        }),
  };
}

/** Only call after authorizing a completed source. Never serialize core state or events. */
export function readHandReplay(
  database: AppDatabase,
  source: CompletedHand,
): HandReplay {
  const { summary, endSequence } = source;
  let state: State | undefined;
  let sequence = summary.handStartSequence;
  let actions: HandReplayStep["actions"] = [];
  const steps: HandReplayStep[] = [];
  // ponytail: full server-derived frames; use deltas only if measured Replay payload size warrants it.
  for (const row of readRoomEvents(database, summary.roomId)) {
    if (row.sequence <= summary.handStartSequence) {
      state = evolve(state, row.event);
      if (row.sequence === summary.handStartSequence)
        steps.push(
          snapshot(state, summary.playerIds, row.sequence, [
            { text: "原始发牌（进贡前）" },
          ]),
        );
      continue;
    }
    if (state === undefined) throw new UnsupportedPersistedEventError();
    if (actionStarts.has(row.event.type) && actions.length > 0) {
      steps.push(
        snapshot(
          state,
          summary.playerIds,
          sequence,
          actions,
          steps[0]!.dealerTeam,
        ),
      );
      actions = [];
    }
    actions.push(...describe(row.event, summary.playerIds));
    // Challenge completion hides active cards on returning to the lobby; retain its settled table.
    if (row.event.type !== "ChallengeHandCompleted")
      state = evolve(state, row.event);
    sequence = row.sequence;
    if (sequence === endSequence) {
      steps.push(
        snapshot(
          state,
          summary.playerIds,
          sequence,
          actions,
          steps[0]!.dealerTeam,
        ),
      );
      break;
    }
  }
  if (
    steps.at(-1)?.sequence !== endSequence ||
    steps.at(-1)?.result === undefined
  )
    throw new UnsupportedPersistedEventError();
  return HandReplaySchema.parse({
    summary,
    originalDeal: steps[0]!.hands,
    steps,
  });
}

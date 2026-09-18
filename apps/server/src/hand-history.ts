import { and, eq } from "drizzle-orm";
import {
  derivePlayerView,
  evolve,
  isChallengeTemplate,
  type ChallengeTemplate,
  type Event,
  type State,
} from "@dglz/game-core";
import {
  ChallengeCodeSchema,
  CompletedHandSummarySchema,
  type CompletedHandSummary,
} from "@dglz/protocol";
import type { AppDatabase } from "./db/index.js";
import { challengeTemplates } from "./db/schema.js";
import { readRoomEvents, UnsupportedPersistedEventError } from "./rooms.js";

function templateAtStart(
  event: Extract<Event, { type: "MatchStarted" | "HandStarted" }>,
  before: State | undefined,
): ChallengeTemplate {
  const common = {
    rulesetId: event.rulesetId,
    rulesConfiguration: event.rulesConfiguration,
    handSeed: event.handSeed,
    randomnessVersion: event.randomnessVersion,
    shuffleVersion: event.shuffleVersion,
    dealerTeam: event.dealerTeam,
    teamLevels: event.teamLevels,
    failureCounters: event.failureCounters,
    trumpRank: event.trumpRank,
  };
  if (event.type === "MatchStarted") {
    return {
      ...common,
      setup: { kind: "initial-hand", dealerSeat: event.dealerSeat },
    };
  }
  if (before === undefined) throw new UnsupportedPersistedEventError();
  const previous = derivePlayerView(before, event.playerIds[0]!);
  const result = previous.handResult;
  if (result === undefined || previous.finishPositions === undefined) {
    throw new UnsupportedPersistedEventError();
  }
  return {
    ...common,
    setup: {
      kind: "subsequent-hand",
      finishPositions: [...previous.finishPositions],
      result: {
        outcome: result.outcome,
        firstFinisherTeam: result.firstFinisherTeam,
        ...(result.winningTeam === undefined
          ? {}
          : { winningTeam: result.winningTeam }),
        nextDealerTeam: result.nextDealerTeam,
        caughtSeatIndices: event.playerIds.flatMap((id, seat) =>
          result.caughtPlayerIds.includes(id) ? [seat] : [],
        ),
      },
    },
  };
}

export type CompletedHand = {
  summary: CompletedHandSummary;
  template: ChallengeTemplate;
  endSequence: number;
};

/** Server-only source facts; HTTP responses must select summary explicitly. */
export function* readCompletedHands(
  database: AppDatabase,
  roomId: string,
): Generator<CompletedHand> {
  let state: State | undefined;
  let start:
    | {
        sequence: number;
        event: Extract<
          Event,
          { type: "MatchStarted" | "HandStarted" | "ChallengeHandStarted" }
        >;
        template: ChallengeTemplate;
      }
    | undefined;
  for (const { sequence, recordedAt, event } of readRoomEvents(
    database,
    roomId,
  )) {
    if (
      event.type === "MatchStarted" ||
      event.type === "HandStarted" ||
      event.type === "ChallengeHandStarted"
    ) {
      const template =
        event.type === "ChallengeHandStarted"
          ? event.template
          : templateAtStart(event, state);
      if (!isChallengeTemplate(template))
        throw new UnsupportedPersistedEventError();
      start = { sequence, event, template };
    }
    // Challenge completion returns to the lobby; retain the final active view.
    const beforeCompletion =
      event.type === "ChallengeHandCompleted" && state !== undefined
        ? derivePlayerView(state, "__history__")
        : undefined;
    state = evolve(state, event);
    if (
      start !== undefined &&
      (event.type === "HandSettled" || event.type === "ChallengeHandCompleted")
    ) {
      if (
        (start.event.type === "ChallengeHandStarted") !==
        (event.type === "ChallengeHandCompleted")
      )
        throw new UnsupportedPersistedEventError();
      const view = beforeCompletion ?? derivePlayerView(state, "__history__");
      if (
        view.handResult === undefined ||
        view.finishPositions === undefined ||
        view.teamLevels === undefined
      )
        throw new UnsupportedPersistedEventError();
      const storedCode = database.db
        .select({ code: challengeTemplates.code })
        .from(challengeTemplates)
        .where(
          and(
            eq(challengeTemplates.sourceRoomId, roomId),
            eq(challengeTemplates.sourceHandStartSequence, start.sequence),
          ),
        )
        .get();
      yield {
        template: start.template,
        endSequence: sequence,
        summary: CompletedHandSummarySchema.parse({
          roomId,
          handStartSequence: start.sequence,
          activity:
            start.event.type === "ChallengeHandStarted" ? "challenge" : "match",
          handNumber:
            start.event.type === "HandStarted" ? start.event.handNumber : 1,
          completedAt: recordedAt,
          rulesConfiguration: start.template.rulesConfiguration,
          seatingPolicy: start.event.seatingPolicy,
          playerIds: [...start.event.playerIds],
          trumpRank: start.template.trumpRank,
          result: view.handResult,
          finishPositions: view.finishPositions.map(
            (position) => position ?? null,
          ),
          teamLevels: view.teamLevels,
          ...(storedCode === undefined
            ? {}
            : { challengeCode: ChallengeCodeSchema.parse(storedCode.code) }),
        }),
      };
      start = undefined;
    }
    if (
      event.type === "MatchAborted" ||
      event.type === "MatchCompleted" ||
      event.type === "ChallengeHandAborted" ||
      event.type === "RoomInterrupted" ||
      event.type === "RoomArchived"
    )
      start = undefined;
  }
}

export function readCompletedHand(
  database: AppDatabase,
  roomId: string,
  handStartSequence: number,
): CompletedHand | undefined {
  for (const hand of readCompletedHands(database, roomId)) {
    if (hand.summary.handStartSequence === handStartSequence) return hand;
    if (hand.summary.handStartSequence > handStartSequence) return undefined;
  }
  return undefined;
}

export function listCompletedHands(
  database: AppDatabase,
  accountId: string,
): CompletedHandSummary[] {
  // Discovery uses historical membership; authorization below uses actual Hand participants.
  // ponytail: scan/fold historical Rooms; add a completed-Hand index if measured history latency warrants it.
  const rooms = database.sqlite
    .prepare(
      `
    SELECT DISTINCT room_id AS roomId FROM room_events
    WHERE event_type IN ('RoomCreated', 'MemberJoined')
      AND CASE WHEN json_valid(payload) THEN
        CASE event_type WHEN 'RoomCreated' THEN json_extract(payload, '$.ownerId')
          ELSE json_extract(payload, '$.playerId') END
      END = ?
  `,
    )
    .all(accountId) as { roomId: string }[];
  const hands = rooms.flatMap(({ roomId }) =>
    [...readCompletedHands(database, roomId)]
      .filter((hand) => hand.summary.playerIds.includes(accountId))
      .map((hand) => hand.summary),
  );
  return hands.sort(
    (a, b) =>
      b.completedAt - a.completedAt ||
      a.roomId.localeCompare(b.roomId) ||
      b.handStartSequence - a.handStartSequence,
  );
}

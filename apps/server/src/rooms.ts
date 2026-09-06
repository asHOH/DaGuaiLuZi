import { asc, eq } from "drizzle-orm";
import {
  derivePlayerView,
  evolve,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type PlayerAccountId,
  type PlayerView as CorePlayerView,
  type Event,
  type RoomCreated,
  type State,
} from "@dglz/game-core";
import {
  CommandIdSchema,
  RoomCommandAckSchema,
  type RoomCommandAck,
  RoomIdSchema,
  RulesConfigurationSchema,
  RoomViewDataSchema,
  SeatingPolicySchema,
  type RulesetId,
  type RoomViewData,
} from "@dglz/protocol";
import { z } from "zod";

import type { AppDatabase } from "./db/index.js";
import { roomEvents } from "./db/schema.js";

const ROOM_EVENT_SCHEMA_VERSION = 1;
const PlayerIdSchema = z.string().min(1).max(128);
const TeamIndexSchema = z.union([z.literal(0), z.literal(1)]);
const TeamLevelSchema = z.enum(["2", "3", "4", "5", "6"]);
const TeamLevelsSchema = z.tuple([TeamLevelSchema, TeamLevelSchema]);
const FailureCountersSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);
const TrumpRankSchema = z.enum(["2", "3", "4", "5"]);

const RoomCreatedPayloadSchema = z
  .object({
    type: z.literal("RoomCreated"),
    roomId: RoomIdSchema,
    ownerId: PlayerIdSchema,
    rulesConfiguration: RulesConfigurationSchema,
    seatingPolicy: SeatingPolicySchema,
  })
  .strict();

const MemberJoinedPayloadSchema = z
  .object({
    type: z.literal("MemberJoined"),
    playerId: PlayerIdSchema,
    joinOrder: z.number().int().nonnegative(),
  })
  .strict();

const MatchSelectedPayloadSchema = z
  .object({ type: z.literal("MatchSelected") })
  .strict();

const SeatAssignedPayloadSchema = z
  .object({
    type: z.literal("SeatAssigned"),
    playerId: PlayerIdSchema,
    seatIndex: z.number().int().nonnegative(),
  })
  .strict();

const ReadinessChangedPayloadSchema = z
  .object({
    type: z.literal("ReadinessChanged"),
    playerId: PlayerIdSchema,
    ready: z.boolean(),
  })
  .strict();

const ReadinessClearedPayloadSchema = z
  .object({ type: z.literal("ReadinessCleared") })
  .strict();

const SeatAssignmentsClearedPayloadSchema = z
  .object({ type: z.literal("SeatAssignmentsCleared") })
  .strict();

const MatchStartedPayloadSchema = z
  .object({
    type: z.literal("MatchStarted"),
    rulesetId: z.enum(["dglz-6p-3d-v1", "dglz-4p-2d-v1"]),
    rulesConfiguration: RulesConfigurationSchema,
    seatingPolicy: SeatingPolicySchema,
    handSeed: z.string().min(1).max(256),
    randomnessVersion: z.literal(RANDOMNESS_VERSION),
    shuffleVersion: z.literal(SHUFFLE_VERSION),
    playerIds: z.array(PlayerIdSchema).min(1).max(6),
    dealerSeat: z.number().int().nonnegative(),
    dealerTeam: TeamIndexSchema,
    teamLevels: TeamLevelsSchema,
    trumpRank: TrumpRankSchema,
    failureCounters: FailureCountersSchema,
  })
  .strict()
  .superRefine((event, context) => {
    const playerCount = event.rulesetId === "dglz-6p-3d-v1" ? 6 : 4;
    if (event.rulesConfiguration.rulesetId !== event.rulesetId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ruleset-mismatch",
        path: ["rulesConfiguration", "rulesetId"],
      });
    }
    if (event.playerIds.length !== playerCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid-player-count",
        path: ["playerIds"],
      });
    }
    if (new Set(event.playerIds).size !== event.playerIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duplicate-player",
        path: ["playerIds"],
      });
    }
    if (event.dealerSeat >= playerCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid-dealer-seat",
        path: ["dealerSeat"],
      });
    }
    if (event.dealerTeam !== event.dealerSeat % 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "dealer-team-mismatch",
        path: ["dealerTeam"],
      });
    }
    if (event.trumpRank !== event.teamLevels[event.dealerTeam]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "trump-rank-mismatch",
        path: ["trumpRank"],
      });
    }
  });

const PersistedRoomEventRowSchema = z
  .object({
    roomId: z.string().min(1).max(128),
    sequence: z.number().int().positive(),
    eventType: z.enum([
      "RoomCreated",
      "MemberJoined",
      "MatchSelected",
      "SeatAssigned",
      "ReadinessChanged",
      "ReadinessCleared",
      "SeatAssignmentsCleared",
      "MatchStarted",
    ]),
    eventSchemaVersion: z.number().int().positive(),
    causationCommandId: CommandIdSchema.nullable(),
    recordedAt: z.number().int().positive(),
    payload: z.string(),
  })
  .strict();

export class UnsupportedPersistedEventError extends Error {
  public constructor() {
    super("unsupported-persisted-event");
    this.name = "UnsupportedPersistedEventError";
  }
}

export function defaultRoomRulesConfiguration(
  rulesetId: RulesetId,
): RoomCreated["rulesConfiguration"] {
  const shared = {
    wildcardRank: "strongest-rank" as const,
    finishingWildcardInterpretation: "weakest-form-and-rank" as const,
    flushTieBreaking: "descending-ranks" as const,
    nextHandLeader: "first-finisher" as const,
    tributeCardSelection: "fair-random" as const,
    tributeRecipientPairing: "adjacent-first-automatic" as const,
    matchEnding: "no-failure-limit-at-5" as const,
  };
  if (rulesetId === "dglz-6p-3d-v1") {
    return {
      rulesetId,
      ...shared,
      jokerPairComparison: "two-small-and-mixed-are-equal",
      returnCardSelection: "recipient-choice",
    };
  }
  return { rulesetId, ...shared };
}

export function appendRoomCreated(
  database: AppDatabase,
  event: RoomCreated,
): void {
  const payload = RoomCreatedPayloadSchema.parse(event);
  database.db
    .insert(roomEvents)
    .values({
      roomId: event.roomId,
      sequence: 1,
      eventType: event.type,
      eventSchemaVersion: ROOM_EVENT_SCHEMA_VERSION,
      causationCommandId: null,
      recordedAt: Date.now(),
      payload: JSON.stringify(payload),
    })
    .run();
}

export type AcceptedCommandRecord = Readonly<{
  accountId: string;
  roomId: string;
  requestFingerprint: string;
  acknowledgement: RoomCommandAck;
}>;

const AcceptedCommandRowSchema = z.object({
  commandId: CommandIdSchema,
  accountId: z.string().min(1),
  roomId: RoomIdSchema,
  requestFingerprint: z.string().min(1),
  acknowledgement: z.string().min(1),
});

export function findAcceptedCommand(
  database: AppDatabase,
  commandId: string,
): AcceptedCommandRecord | undefined {
  const row = database.sqlite
    .prepare(
      `SELECT command_id AS commandId,
              account_id AS accountId,
              room_id AS roomId,
              request_fingerprint AS requestFingerprint,
              acknowledgement
         FROM accepted_commands
        WHERE command_id = ?`,
    )
    .get(commandId);
  if (row === undefined) {
    return undefined;
  }
  const parsedRow = AcceptedCommandRowSchema.parse(row);
  let acknowledgement: unknown;
  try {
    acknowledgement = JSON.parse(parsedRow.acknowledgement) as unknown;
  } catch {
    throw new UnsupportedPersistedEventError();
  }
  const parsedAcknowledgement = RoomCommandAckSchema.safeParse(acknowledgement);
  if (
    !parsedAcknowledgement.success ||
    parsedAcknowledgement.data.commandId !== parsedRow.commandId
  ) {
    throw new UnsupportedPersistedEventError();
  }
  return {
    accountId: parsedRow.accountId,
    roomId: parsedRow.roomId,
    requestFingerprint: parsedRow.requestFingerprint,
    acknowledgement: parsedAcknowledgement.data,
  };
}

export type CommittedRoomCommand = Readonly<{
  commandId: string;
  accountId: string;
  roomId: string;
  requestFingerprint: string;
  acknowledgement: RoomCommandAck;
  expectedRevision: number;
  events: readonly Event[];
}>;

function eventPayload(event: Event): string {
  if (event.type === "RoomCreated") {
    return JSON.stringify(RoomCreatedPayloadSchema.parse(event));
  }
  if (event.type === "MemberJoined") {
    return JSON.stringify(MemberJoinedPayloadSchema.parse(event));
  }
  if (event.type === "MatchSelected") {
    return JSON.stringify(MatchSelectedPayloadSchema.parse(event));
  }
  if (event.type === "SeatAssigned") {
    return JSON.stringify(SeatAssignedPayloadSchema.parse(event));
  }
  if (event.type === "ReadinessChanged") {
    return JSON.stringify(ReadinessChangedPayloadSchema.parse(event));
  }
  if (event.type === "ReadinessCleared") {
    return JSON.stringify(ReadinessClearedPayloadSchema.parse(event));
  }
  if (event.type === "SeatAssignmentsCleared") {
    return JSON.stringify(SeatAssignmentsClearedPayloadSchema.parse(event));
  }
  if (event.type === "MatchStarted") {
    return JSON.stringify(MatchStartedPayloadSchema.parse(event));
  }
  throw new UnsupportedPersistedEventError();
}

export type CommittedRoomEvents = Readonly<{
  roomId: string;
  expectedRevision: number;
  causationCommandId: string | null;
  events: readonly Event[];
}>;

function appendEventRows(
  insertEvent: { run: (...values: unknown[]) => unknown },
  command: CommittedRoomEvents,
): void {
  command.events.forEach((event, offset) => {
    insertEvent.run(
      command.roomId,
      command.expectedRevision + offset + 1,
      event.type,
      ROOM_EVENT_SCHEMA_VERSION,
      command.causationCommandId,
      Date.now(),
      eventPayload(event),
    );
  });
}

export function appendRoomEvents(
  database: AppDatabase,
  events: CommittedRoomEvents,
): void {
  const insertEvent = database.sqlite.prepare(
    `INSERT INTO room_events
       (room_id, sequence, event_type, event_schema_version, causation_command_id, recorded_at, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  database.sqlite.transaction(() => {
    appendEventRows(insertEvent, events);
  })();
}

export function commitRoomCommand(
  database: AppDatabase,
  command: CommittedRoomCommand,
): void {
  const acknowledgement = RoomCommandAckSchema.parse(command.acknowledgement);
  const insertCommand = database.sqlite.prepare(
    `INSERT INTO accepted_commands
       (command_id, account_id, room_id, request_fingerprint, acknowledgement)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertEvent = database.sqlite.prepare(
    `INSERT INTO room_events
       (room_id, sequence, event_type, event_schema_version, causation_command_id, recorded_at, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const commit = database.sqlite.transaction(() => {
    insertCommand.run(
      command.commandId,
      command.accountId,
      command.roomId,
      command.requestFingerprint,
      JSON.stringify(acknowledgement),
    );
    appendEventRows(insertEvent, {
      roomId: command.roomId,
      expectedRevision: command.expectedRevision,
      causationCommandId: command.commandId,
      events: command.events,
    });
  });
  commit();
}

export type LoadedRoom = Readonly<{
  roomId: string;
  state: State;
  revision: number;
}>;

export function loadRoom(
  database: AppDatabase,
  roomId: string,
): LoadedRoom | undefined {
  const rows = database.db
    .select()
    .from(roomEvents)
    .where(eq(roomEvents.roomId, roomId))
    .orderBy(asc(roomEvents.sequence))
    .all();
  if (rows.length === 0) {
    return undefined;
  }

  let state: State | undefined;
  let revision = 0;
  for (const unvalidatedRow of rows) {
    const row = PersistedRoomEventRowSchema.safeParse(unvalidatedRow);
    if (!row.success || row.data.sequence !== revision + 1) {
      throw new UnsupportedPersistedEventError();
    }
    if (row.data.eventSchemaVersion !== ROOM_EVENT_SCHEMA_VERSION) {
      throw new UnsupportedPersistedEventError();
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(row.data.payload) as unknown;
    } catch {
      throw new UnsupportedPersistedEventError();
    }
    const parsedEvent = (() => {
      switch (row.data.eventType) {
        case "RoomCreated":
          return RoomCreatedPayloadSchema.safeParse(decoded);
        case "MemberJoined":
          return MemberJoinedPayloadSchema.safeParse(decoded);
        case "MatchSelected":
          return MatchSelectedPayloadSchema.safeParse(decoded);
        case "SeatAssigned":
          return SeatAssignedPayloadSchema.safeParse(decoded);
        case "ReadinessChanged":
          return ReadinessChangedPayloadSchema.safeParse(decoded);
        case "ReadinessCleared":
          return ReadinessClearedPayloadSchema.safeParse(decoded);
        case "SeatAssignmentsCleared":
          return SeatAssignmentsClearedPayloadSchema.safeParse(decoded);
        case "MatchStarted":
          return MatchStartedPayloadSchema.safeParse(decoded);
      }
    })();
    if (!parsedEvent.success) {
      throw new UnsupportedPersistedEventError();
    }
    if (state === undefined && parsedEvent.data.type !== "RoomCreated") {
      throw new UnsupportedPersistedEventError();
    }
    if (state !== undefined && parsedEvent.data.type === "RoomCreated") {
      throw new UnsupportedPersistedEventError();
    }
    if (
      parsedEvent.data.type === "RoomCreated" &&
      parsedEvent.data.roomId !== roomId
    ) {
      throw new UnsupportedPersistedEventError();
    }
    try {
      state = evolve(state, parsedEvent.data);
    } catch {
      throw new UnsupportedPersistedEventError();
    }
    revision = row.data.sequence;
  }
  if (state === undefined) {
    throw new UnsupportedPersistedEventError();
  }
  return { roomId, state, revision };
}

export function deriveRoomView(
  loadedRoom: LoadedRoom,
  playerId: PlayerAccountId,
): RoomViewData | undefined {
  const view: CorePlayerView = derivePlayerView(loadedRoom.state, playerId);
  if (!view.members.some((member) => member.playerId === playerId)) {
    return undefined;
  }
  return RoomViewDataSchema.parse({
    revision: loadedRoom.revision,
    view: {
      roomId: view.roomId,
      lifecycle: view.lifecycle,
      ownerId: view.ownerId,
      members: view.members,
      seats: view.seats,
      rulesConfiguration: view.rulesConfiguration,
      seatingPolicy: view.seatingPolicy,
      matchRulesConfigurationLocked: view.matchRulesConfigurationLocked,
      seatingPolicyLocked: view.seatingPolicyLocked,
      ...(view.selectedActivity === undefined
        ? {}
        : { selectedActivity: view.selectedActivity }),
      ...(view.lifecycle !== "ACTIVE"
        ? {}
        : {
            dealerSeat: view.dealerSeat,
            dealerTeam: view.dealerTeam,
            teamLevels: view.teamLevels,
            trumpRank: view.trumpRank,
            failureCounters: view.failureCounters,
            completedHandCount: view.completedHandCount,
            handSizes: view.handSizes,
            hand: view.hand,
            ...(view.currentActor === undefined
              ? {}
              : {
                  currentActor: view.currentActor,
                  currentActorSeat: view.currentActorSeat,
                }),
            passedPlayerIds: view.passedPlayerIds,
            finishPositions: view.finishPositions?.map(
              (position) => position ?? null,
            ),
            setupStage: view.setupStage,
            tributeTransfers: view.tributeTransfers,
            returnCandidates: view.returnCandidates,
            pendingPlayerIds: view.pendingPlayerIds,
            eligibleTributeCards: view.eligibleTributeCards,
          }),
    },
  });
}

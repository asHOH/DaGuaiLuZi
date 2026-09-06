import { asc, eq } from "drizzle-orm";
import {
  derivePlayerView,
  evolve,
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

const RoomCreatedPayloadSchema = z
  .object({
    type: z.literal("RoomCreated"),
    roomId: RoomIdSchema,
    ownerId: z.string().min(1).max(128),
    rulesConfiguration: RulesConfigurationSchema,
    seatingPolicy: SeatingPolicySchema,
  })
  .strict();

const MemberJoinedPayloadSchema = z
  .object({
    type: z.literal("MemberJoined"),
    playerId: z.string().min(1).max(128),
    joinOrder: z.number().int().nonnegative(),
  })
  .strict();

const PersistedRoomEventRowSchema = z.object({
  roomId: z.string().min(1).max(128),
  sequence: z.number().int().positive(),
  eventType: z.string(),
  eventSchemaVersion: z.number().int().positive(),
  causationCommandId: z.string().nullable(),
  recordedAt: z.number().int().positive(),
  payload: z.string(),
});

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
  throw new UnsupportedPersistedEventError();
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
    command.events.forEach((event, offset) => {
      insertEvent.run(
        command.roomId,
        command.expectedRevision + offset + 1,
        event.type,
        ROOM_EVENT_SCHEMA_VERSION,
        command.commandId,
        Date.now(),
        eventPayload(event),
      );
    });
  });
  commit();
}

export type LoadedRoom = Readonly<{
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
    if (state === undefined && row.data.eventType === "RoomCreated") {
      const parsedEvent = RoomCreatedPayloadSchema.safeParse(decoded);
      if (!parsedEvent.success || parsedEvent.data.roomId !== roomId) {
        throw new UnsupportedPersistedEventError();
      }
      state = evolve(state, parsedEvent.data);
    } else if (state !== undefined && row.data.eventType === "MemberJoined") {
      const parsedEvent = MemberJoinedPayloadSchema.safeParse(decoded);
      if (!parsedEvent.success) {
        throw new UnsupportedPersistedEventError();
      }
      state = evolve(state, parsedEvent.data);
    } else {
      throw new UnsupportedPersistedEventError();
    }
    revision = row.data.sequence;
  }
  if (state === undefined) {
    throw new UnsupportedPersistedEventError();
  }
  return { state, revision };
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
    },
  });
}

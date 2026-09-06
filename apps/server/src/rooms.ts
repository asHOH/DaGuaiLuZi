import { asc, eq } from "drizzle-orm";
import {
  derivePlayerView,
  evolve,
  type PlayerAccountId,
  type PlayerView as CorePlayerView,
  type RoomCreated,
  type State,
} from "@dglz/game-core";
import {
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
    if (
      state !== undefined ||
      row.data.eventSchemaVersion !== ROOM_EVENT_SCHEMA_VERSION ||
      row.data.eventType !== "RoomCreated"
    ) {
      throw new UnsupportedPersistedEventError();
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(row.data.payload) as unknown;
    } catch {
      throw new UnsupportedPersistedEventError();
    }
    const parsedEvent = RoomCreatedPayloadSchema.safeParse(decoded);
    if (!parsedEvent.success || parsedEvent.data.roomId !== roomId) {
      throw new UnsupportedPersistedEventError();
    }
    state = evolve(state, parsedEvent.data);
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

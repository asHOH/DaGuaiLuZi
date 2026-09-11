import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
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
  ChallengePreviewSchema,
  RoomIdSchema,
  type ChallengePreview,
} from "@dglz/protocol";

import type { AppDatabase } from "./db/index.js";
import { challengeTemplates } from "./db/schema.js";
import { readRoomEvents, UnsupportedPersistedEventError } from "./rooms.js";

const TEMPLATE_SCHEMA_VERSION = 1;
const StoredChallengeSchema = z
  .object({
    code: ChallengeCodeSchema,
    sourceRoomId: RoomIdSchema,
    sourceHandStartSequence: z.number().int().positive(),
    templateSchemaVersion: z.literal(TEMPLATE_SCHEMA_VERSION),
    template: z.string(),
  })
  .strict();

function decodeChallenge(row: unknown): {
  code: string;
  template: ChallengeTemplate;
} {
  try {
    const stored = StoredChallengeSchema.parse(row);
    const value: unknown = JSON.parse(stored.template);
    // JSON arrays encode unfinished positions as null; the core uses undefined.
    if (typeof value === "object" && value !== null && "setup" in value) {
      const setup = value.setup;
      if (
        typeof setup === "object" &&
        setup !== null &&
        "kind" in setup &&
        setup.kind === "subsequent-hand" &&
        "finishPositions" in setup &&
        Array.isArray(setup.finishPositions)
      ) {
        setup.finishPositions = setup.finishPositions.map(
          (position: unknown) => (position === null ? undefined : position),
        );
      }
    }
    if (!isChallengeTemplate(value)) throw new UnsupportedPersistedEventError();
    return { code: stored.code, template: value };
  } catch {
    throw new UnsupportedPersistedEventError();
  }
}

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

function completedSource(
  database: AppDatabase,
  roomId: string,
  handStartSequence: number,
): { template: ChallengeTemplate; playerIds: readonly string[] } | undefined {
  let state: State | undefined;
  let source:
    { template: ChallengeTemplate; playerIds: readonly string[] } | undefined;
  // ponytail: replay on Code creation; index completed Hands only if measured history size warrants it.
  for (const { sequence, event } of readRoomEvents(database, roomId)) {
    if (sequence === handStartSequence) {
      if (event.type !== "MatchStarted" && event.type !== "HandStarted")
        return undefined;
      const template = templateAtStart(event, state);
      if (!isChallengeTemplate(template))
        throw new UnsupportedPersistedEventError();
      source = { template, playerIds: event.playerIds };
    } else if (source !== undefined) {
      if (event.type === "HandSettled") return source;
      if (
        event.type === "MatchAborted" ||
        event.type === "MatchCompleted" ||
        event.type === "MatchStarted" ||
        event.type === "HandStarted"
      )
        return undefined;
    }
    state = evolve(state, event);
  }
  return undefined;
}

export function challengePreview(
  code: string,
  template: ChallengeTemplate,
): ChallengePreview {
  return ChallengePreviewSchema.parse({
    code,
    rulesConfiguration: template.rulesConfiguration,
    teamLevels: template.teamLevels,
    trumpRank: template.trumpRank,
  });
}

/** Called through the source Room executor; the source stream itself is never changed. */
export function createChallengeCode(
  database: AppDatabase,
  roomId: string,
  handStartSequence: number,
  accountId: string,
): ChallengePreview | "not-found" | "forbidden" {
  const source = completedSource(database, roomId, handStartSequence);
  if (source === undefined) return "not-found";
  if (!source.playerIds.includes(accountId)) return "forbidden";
  return database.sqlite.transaction(() => {
    const reference = and(
      eq(challengeTemplates.sourceRoomId, roomId),
      eq(challengeTemplates.sourceHandStartSequence, handStartSequence),
    );
    let row = database.db
      .select()
      .from(challengeTemplates)
      .where(reference)
      .get();
    if (row === undefined) {
      database.db
        .insert(challengeTemplates)
        .values({
          code: randomBytes(16).toString("hex"),
          sourceRoomId: roomId,
          sourceHandStartSequence: handStartSequence,
          templateSchemaVersion: TEMPLATE_SCHEMA_VERSION,
          template: JSON.stringify(source.template),
        })
        .onConflictDoNothing({
          target: [
            challengeTemplates.sourceRoomId,
            challengeTemplates.sourceHandStartSequence,
          ],
        })
        .run();
      row = database.db
        .select()
        .from(challengeTemplates)
        .where(reference)
        .get();
    }
    const stored = decodeChallenge(row);
    return challengePreview(stored.code, stored.template);
  })();
}

/** Server-only lookup; HTTP callers receive challengePreview, never this Template. */
export function lookupChallenge(
  database: AppDatabase,
  code: string,
): { code: string; template: ChallengeTemplate } | undefined {
  const row = database.db
    .select()
    .from(challengeTemplates)
    .where(eq(challengeTemplates.code, code))
    .get();
  return row === undefined ? undefined : decodeChallenge(row);
}

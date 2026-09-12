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
  LookupChallengeCodeSchema,
  type ChallengePreview,
} from "@dglz/protocol";

import type { AppDatabase } from "./db/index.js";
import { challengeTemplates } from "./db/schema.js";
import { readRoomEvents, UnsupportedPersistedEventError } from "./rooms.js";
import { ChallengeTemplateSchema } from "./challenge-template.js";

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
    const value = ChallengeTemplateSchema.parse(JSON.parse(stored.template));
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
      if (
        event.type !== "MatchStarted" &&
        event.type !== "HandStarted" &&
        event.type !== "ChallengeHandStarted"
      )
        return undefined;
      const template =
        event.type === "ChallengeHandStarted"
          ? event.template
          : templateAtStart(event, state);
      if (!isChallengeTemplate(template))
        throw new UnsupportedPersistedEventError();
      source = { template, playerIds: event.playerIds };
    } else if (source !== undefined) {
      if (
        event.type === "HandSettled" ||
        event.type === "ChallengeHandCompleted"
      )
        return source;
      if (
        event.type === "MatchAborted" ||
        event.type === "MatchCompleted" ||
        event.type === "MatchStarted" ||
        event.type === "HandStarted" ||
        event.type === "ChallengeHandStarted" ||
        event.type === "ChallengeHandAborted"
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
    for (let attempt = 0; row === undefined && attempt < 8; attempt++) {
      database.db
        .insert(challengeTemplates)
        .values({
          code: randomBytes(6).toString("hex"),
          sourceRoomId: roomId,
          sourceHandStartSequence: handStartSequence,
          templateSchemaVersion: TEMPLATE_SCHEMA_VERSION,
          template: JSON.stringify(source.template),
        })
        .onConflictDoNothing()
        .run();
      row = database.db
        .select()
        .from(challengeTemplates)
        .where(reference)
        .get();
    }
    if (row === undefined) throw new Error("challenge-code-generation-failed");
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

export type ChallengeLookupResult =
  | { ok: true; code: string; template: ChallengeTemplate }
  | {
      ok: false;
      code:
        | "rate-limited"
        | "malformed-input"
        | "not-found"
        | "unsupported-persisted-event";
    };

/** One account budget shared by HTTP previews and socket selections in this application. */
export class ChallengeLookup {
  private readonly attempts = new Map<
    string,
    { count: number; expiresAt: number }
  >();

  public constructor(private readonly database: AppDatabase) {}

  public resolve(accountId: string, input: unknown): ChallengeLookupResult {
    const now = Date.now();
    let window = this.attempts.get(accountId);
    if (window === undefined || window.expiresAt <= now) {
      window = { count: 0, expiresAt: now + 60_000 };
      this.attempts.set(accountId, window);
    }
    if (++window.count > 20) return { ok: false, code: "rate-limited" };
    const parsed = LookupChallengeCodeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "malformed-input" };
    try {
      const found = lookupChallenge(this.database, parsed.data.code);
      return found === undefined
        ? { ok: false, code: "not-found" }
        : { ok: true, ...found };
    } catch (error) {
      if (error instanceof UnsupportedPersistedEventError)
        return { ok: false, code: "unsupported-persisted-event" };
      throw error;
    }
  }
}

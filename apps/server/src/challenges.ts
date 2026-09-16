import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ChallengeTemplate } from "@dglz/game-core";
import {
  ChallengeCodeSchema,
  ChallengePreviewSchema,
  RoomIdSchema,
  LookupChallengeCodeSchema,
  type ChallengePreview,
} from "@dglz/protocol";

import type { AppDatabase } from "./db/index.js";
import { challengeTemplates } from "./db/schema.js";
import { UnsupportedPersistedEventError } from "./rooms.js";
import { ChallengeTemplateSchema } from "./challenge-template.js";
import { readCompletedHand } from "./hand-history.js";

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
  sourceRoomId: string;
  sourceHandStartSequence: number;
} {
  try {
    const stored = StoredChallengeSchema.parse(row);
    const value = ChallengeTemplateSchema.parse(JSON.parse(stored.template));
    return {
      code: stored.code,
      template: value,
      sourceRoomId: stored.sourceRoomId,
      sourceHandStartSequence: stored.sourceHandStartSequence,
    };
  } catch {
    throw new UnsupportedPersistedEventError();
  }
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
  const source = readCompletedHand(database, roomId, handStartSequence);
  if (source === undefined) return "not-found";
  if (!source.summary.playerIds.includes(accountId)) return "forbidden";
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
): ReturnType<typeof decodeChallenge> | undefined {
  const row = database.db
    .select()
    .from(challengeTemplates)
    .where(eq(challengeTemplates.code, code))
    .get();
  return row === undefined ? undefined : decodeChallenge(row);
}

export type ChallengeLookupResult =
  | ({ ok: true } & ReturnType<typeof decodeChallenge>)
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

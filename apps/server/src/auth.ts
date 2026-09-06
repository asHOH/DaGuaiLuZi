import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { and, eq, isNull } from "drizzle-orm";
import { LoginCommandSchema, UsernameSchema } from "@dglz/protocol";

import { accounts, sessions } from "./db/schema.js";
import type { AppDatabase } from "./db/index.js";

export const SESSION_COOKIE_NAME = "dglz_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function createDummyPasswordHash(): Promise<string> {
  return argon2.hash("dglz-dummy-password", ARGON2_OPTIONS);
}

export type ProvisionAccountInput = Readonly<{
  username: string;
  password: string;
  email?: string;
}>;

export type AuthenticatedAccount = Readonly<{
  accountId: string;
  username: string;
}>;

export type LoginSession = Readonly<{
  account: AuthenticatedAccount;
  token: string;
}>;

export class AccountAlreadyExistsError extends Error {
  public constructor() {
    super("account-already-exists");
    this.name = "AccountAlreadyExistsError";
  }
}

export function normalizeUsername(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

export async function provisionAccount(
  database: AppDatabase,
  input: ProvisionAccountInput,
): Promise<AuthenticatedAccount> {
  const parsedCredentials = LoginCommandSchema.safeParse({
    username: input.username,
    password: input.password,
  });
  if (!parsedCredentials.success) {
    throw new Error("invalid-account-input");
  }
  const normalizedUsernameResult = UsernameSchema.safeParse(
    normalizeUsername(parsedCredentials.data.username),
  );
  if (!normalizedUsernameResult.success) {
    throw new Error("invalid-account-input");
  }
  const normalizedUsername = normalizedUsernameResult.data;

  const passwordHash = await argon2.hash(
    parsedCredentials.data.password,
    ARGON2_OPTIONS,
  );
  const account = {
    id: randomUUID(),
    username: normalizedUsername,
    email: input.email?.trim() || null,
    passwordHash,
    createdAt: Date.now(),
  };

  try {
    database.db.insert(accounts).values(account).run();
  } catch (error) {
    if (
      error instanceof Error &&
      /UNIQUE constraint failed: accounts\.username/i.test(error.message)
    ) {
      throw new AccountAlreadyExistsError();
    }
    throw error;
  }

  return { accountId: account.id, username: account.username };
}

export async function authenticate(
  database: AppDatabase,
  username: string,
  password: string,
  dummyPasswordHash: string,
): Promise<LoginSession | undefined> {
  const normalizedUsername = normalizeUsername(username);
  const account = database.db
    .select()
    .from(accounts)
    .where(eq(accounts.username, normalizedUsername))
    .get();
  const passwordHash = account?.passwordHash ?? dummyPasswordHash;
  let passwordMatches = false;
  try {
    passwordMatches = await argon2.verify(passwordHash, password);
  } catch {
    passwordMatches = false;
  }
  if (account === undefined || !passwordMatches) {
    return undefined;
  }

  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  database.db
    .insert(sessions)
    .values({
      tokenHash: hashSessionToken(token),
      accountId: account.id,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    })
    .run();
  return {
    account: { accountId: account.id, username: account.username },
    token,
  };
}

export function resolveSession(
  database: AppDatabase,
  token: string | undefined,
  now = Date.now(),
): AuthenticatedAccount | undefined {
  if (token === undefined || token.length === 0) {
    return undefined;
  }
  const session = database.db
    .select({
      accountId: accounts.id,
      username: accounts.username,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        isNull(sessions.revokedAt),
      ),
    )
    .get();
  if (session === undefined || session.expiresAt <= now) {
    return undefined;
  }
  return { accountId: session.accountId, username: session.username };
}

export function revokeSession(
  database: AppDatabase,
  token: string | undefined,
): void {
  if (token === undefined || token.length === 0) {
    return;
  }
  database.db
    .update(sessions)
    .set({ revokedAt: Date.now() })
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .run();
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

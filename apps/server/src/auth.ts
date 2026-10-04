import { createHash, randomBytes, randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import argon2 from "argon2";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  LoginCommandSchema,
  PasswordSchema,
  UsernameSchema,
  type ChangePasswordCommand,
} from "@dglz/protocol";

import { accountAudit, accounts, sessions } from "./db/schema.js";
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

export class UnauthorizedSessionError extends Error {
  public constructor() {
    super("unauthorized");
    this.name = "UnauthorizedSessionError";
  }
}

export function assertSession(
  database: AppDatabase,
  token: string | undefined,
  accountId: string,
): void {
  if (resolveSession(database, token)?.accountId !== accountId)
    throw new UnauthorizedSessionError();
}

export function normalizeUsername(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

export async function provisionAccount(
  database: AppDatabase,
  input: ProvisionAccountInput,
): Promise<AuthenticatedAccount> {
  return createAccount(database, input);
}

export async function registerAccount(
  database: AppDatabase,
  input: { username: string; password: string },
): Promise<LoginSession> {
  const token = randomBytes(32).toString("base64url");
  const account = await createAccount(database, input, token);
  return { account, token };
}

async function createAccount(
  database: AppDatabase,
  input: ProvisionAccountInput,
  registrationToken?: string,
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

  if (
    database.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.username, normalizedUsername))
      .get() !== undefined
  )
    throw new AccountAlreadyExistsError();

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
    database.db.transaction(
      (tx) => {
        tx.insert(accounts).values(account).run();
        tx.insert(accountAudit)
          .values({
            action: registrationToken === undefined ? "provision" : "register",
            actor:
              registrationToken === undefined
                ? userInfo().username
                : account.id,
            source: registrationToken === undefined ? "cli" : "registration",
            accountId: account.id,
            recordedAt: account.createdAt,
          })
          .run();
        if (registrationToken !== undefined) {
          tx.insert(sessions)
            .values({
              tokenHash: hashSessionToken(registrationToken),
              accountId: account.id,
              createdAt: account.createdAt,
              expiresAt: account.createdAt + SESSION_TTL_MS,
            })
            .run();
        }
      },
      { behavior: "immediate" },
    );
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
  // A CLI reset/revocation may commit while Argon2 is verifying.
  const inserted = database.db.transaction(
    (tx) => {
      const current = tx
        .select()
        .from(accounts)
        .where(eq(accounts.id, account.id))
        .get();
      if (
        current?.authVersion !== account.authVersion ||
        current.passwordHash !== passwordHash
      )
        return false;
      tx.insert(sessions)
        .values({
          tokenHash: hashSessionToken(token),
          accountId: account.id,
          createdAt: now,
          expiresAt: now + SESSION_TTL_MS,
        })
        .run();
      return true;
    },
    { behavior: "immediate" },
  );
  if (!inserted) return undefined;
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
  database.db.transaction(
    (tx) => {
      const now = Date.now();
      const revoked = tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(sessions.tokenHash, hashSessionToken(token)),
            isNull(sessions.revokedAt),
          ),
        )
        .returning({ accountId: sessions.accountId })
        .get();
      if (revoked === undefined) return;
      tx.insert(accountAudit)
        .values({
          action: "logout",
          actor: revoked.accountId,
          source: "session",
          accountId: revoked.accountId,
          recordedAt: now,
        })
        .run();
    },
    { behavior: "immediate" },
  );
}

function accountByUsername(
  database: AppDatabase,
  username: string,
): typeof accounts.$inferSelect {
  const parsed = UsernameSchema.safeParse(normalizeUsername(username));
  if (!parsed.success) throw new Error("invalid-account-input");
  const account = database.db
    .select()
    .from(accounts)
    .where(eq(accounts.username, parsed.data))
    .get();
  if (account === undefined) throw new Error("account-not-found");
  return account;
}

function revokeAccountSessions(
  database: AppDatabase,
  accountId: string,
  action: "reset-password" | "revoke-sessions" | "change-password",
  passwordHash?: string,
  authorize?: () => void,
): void {
  database.db.transaction(
    (tx) => {
      authorize?.();
      const now = Date.now();
      tx.update(accounts)
        .set({
          authVersion: sql`${accounts.authVersion} + 1`,
          ...(passwordHash === undefined ? {} : { passwordHash }),
        })
        .where(eq(accounts.id, accountId))
        .run();
      tx.update(sessions)
        .set({ revokedAt: now })
        .where(
          and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)),
        )
        .run();
      tx.insert(accountAudit)
        .values({
          action,
          actor: action === "change-password" ? accountId : userInfo().username,
          source: action === "change-password" ? "session" : "cli",
          accountId,
          recordedAt: now,
        })
        .run();
    },
    { behavior: "immediate" },
  );
}

export async function resetPassword(
  database: AppDatabase,
  username: string,
  password: string,
): Promise<void> {
  if (!PasswordSchema.safeParse(password).success)
    throw new Error("invalid-account-input");
  const account = accountByUsername(database, username);
  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
  revokeAccountSessions(database, account.id, "reset-password", passwordHash);
}

export function revokeAllSessions(
  database: AppDatabase,
  username: string,
): void {
  revokeAccountSessions(
    database,
    accountByUsername(database, username).id,
    "revoke-sessions",
  );
}

export async function changePassword(
  database: AppDatabase,
  token: string | undefined,
  input: ChangePasswordCommand,
): Promise<boolean> {
  assertSession(database, token, input.accountId);
  const account = database.db
    .select()
    .from(accounts)
    .where(eq(accounts.id, input.accountId))
    .get()!;
  let matches = false;
  try {
    matches = await argon2.verify(account.passwordHash, input.currentPassword);
  } catch {
    matches = false;
  }
  if (!matches) return false;
  const passwordHash = await argon2.hash(input.newPassword, ARGON2_OPTIONS);
  // Every credential change revokes sessions; recheck after async hashing under the write lock.
  revokeAccountSessions(
    database,
    input.accountId,
    "change-password",
    passwordHash,
    () => assertSession(database, token, input.accountId),
  );
  return true;
}

export function readAccountAudit(
  database: AppDatabase,
  username: string,
): (typeof accountAudit.$inferSelect)[] {
  const account = accountByUsername(database, username);
  return database.db
    .select()
    .from(accountAudit)
    .where(eq(accountAudit.accountId, account.id))
    .orderBy(desc(accountAudit.id))
    .limit(100)
    .all();
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

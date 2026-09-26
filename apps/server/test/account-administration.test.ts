import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import argon2 from "argon2";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  rulesConfigurationPreset,
  type RoomCommandPayload,
} from "@dglz/protocol";
import {
  assertSession,
  authenticate,
  changePassword,
  hashSessionToken,
  provisionAccount,
  readAccountAudit,
  resetPassword,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  UnauthorizedSessionError,
} from "../src/auth.js";
import { openDatabase } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { accounts, sessions } from "../src/db/schema.js";
import { RoomExecutorRegistry } from "../src/room-executor.js";
import { appendRoomCreated } from "../src/rooms.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function databasePath() {
  const directory = await mkdtemp(join(tmpdir(), "dglz-accounts-"));
  cleanups.push(() =>
    rm(directory, { recursive: true, force: true, maxRetries: 3 }),
  );
  return join(directory, "accounts.sqlite");
}

async function setup() {
  const path = await databasePath();
  const database = openDatabase(path);
  cleanups.push(() => database.close());
  const account = await provisionAccount(database, {
    username: "Alice",
    password: "old-secret",
    email: "alice@example.test",
  });
  const login = async (password = "old-secret") => {
    const session = await authenticate(database, "alice", password, "unused");
    expect(session).toBeDefined();
    return session!;
  };
  return { path, database, account, login };
}

it("resets credentials, preserves identity, audits mutations, and revokes only the intended sessions", async () => {
  const { path, database, account, login } = await setup();
  const first = await login();
  const second = await login();
  await provisionAccount(database, { username: "bob", password: "bob-secret" });
  const other = (await authenticate(database, "bob", "bob-secret", "unused"))!;
  revokeSession(database, first.token);
  revokeSession(database, first.token);
  revokeSession(database, "unknown");
  expect(resolveSession(database, first.token)).toBeUndefined();
  expect(resolveSession(database, second.token)).toEqual(account);
  expect(
    readAccountAudit(database, "alice").map((entry) => entry.action),
  ).toEqual(["logout", "provision"]);
  await resetPassword(database, " ＡＬＩＣＥ ", "new-secret");
  expect(resolveSession(database, second.token)).toBeUndefined();
  expect(resolveSession(database, other.token)).toEqual(other.account);
  expect(
    await authenticate(database, "alice", "old-secret", "unused"),
  ).toBeUndefined();
  const next = await login("new-secret");
  expect(next.account).toEqual(account);
  revokeAllSessions(database, "alice");
  expect(resolveSession(database, next.token)).toBeUndefined();
  expect((await login("new-secret")).account).toEqual(account);
  expect(
    database.db
      .select()
      .from(accounts)
      .all()
      .find((row) => row.id === account.accountId)?.email,
  ).toBe("alice@example.test");

  const audit = readAccountAudit(database, "alice");
  expect(audit.map((entry) => entry.action)).toEqual([
    "revoke-sessions",
    "reset-password",
    "logout",
    "provision",
  ]);
  expect(audit[0]).toMatchObject({
    actor: userInfo().username,
    source: "cli",
    accountId: account.accountId,
  });
  expect(audit[2]).toMatchObject({
    actor: account.accountId,
    source: "session",
  });
  const serialized = JSON.stringify(audit);
  for (const secret of [
    "old-secret",
    "new-secret",
    "$argon2",
    first.token,
    hashSessionToken(first.token),
  ])
    expect(serialized).not.toContain(secret);
  expect(() =>
    database.sqlite.exec("UPDATE account_audit SET actor = 'changed'"),
  ).toThrow("account-audit-append-only");
  expect(() => database.sqlite.exec("DELETE FROM account_audit")).toThrow(
    "account-audit-append-only",
  );
  const reopened = openDatabase(path);
  try {
    expect(readAccountAudit(reopened, "alice")).toEqual(audit);
    expect(resolveSession(reopened, second.token)).toBeUndefined();
    expect(
      await authenticate(reopened, "alice", "old-secret", "unused"),
    ).toBeUndefined();
    expect(
      await authenticate(reopened, "alice", "new-secret", "unused"),
    ).toBeDefined();
  } finally {
    reopened.close();
  }
});

it("rolls back every account mutation if its audit insert fails", async () => {
  const { database, login } = await setup();
  const session = await login();
  const before = database.db.select().from(accounts).all();
  database.sqlite.exec(
    "CREATE TRIGGER fail_audit BEFORE INSERT ON account_audit BEGIN SELECT RAISE(ABORT, 'audit-failed'); END",
  );
  await expect(
    provisionAccount(database, { username: "new", password: "secret" }),
  ).rejects.toThrow("audit-failed");
  await expect(resetPassword(database, "alice", "new-secret")).rejects.toThrow(
    "audit-failed",
  );
  expect(() => revokeAllSessions(database, "alice")).toThrow("audit-failed");
  expect(() => revokeSession(database, session.token)).toThrow("audit-failed");
  await expect(
    changePassword(database, session.token, {
      accountId: session.account.accountId,
      currentPassword: "old-secret",
      newPassword: "new-secret",
    }),
  ).rejects.toThrow("audit-failed");
  expect(database.db.select().from(accounts).all()).toEqual(before);
  expect(resolveSession(database, session.token)).toEqual(session.account);
  expect(readAccountAudit(database, "alice")).toHaveLength(1);
  expect(
    await authenticate(database, "alice", "old-secret", "unused"),
  ).toBeDefined();
});

it.each(["reset", "revoke", "change"])(
  "rejects a login that was still verifying during %s",
  async (operation) => {
    const { path, database, login } = await setup();
    const session = await login();
    const verified = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const verify = argon2.verify;
    vi.spyOn(argon2, "verify").mockImplementationOnce(async (...args) => {
      const matches = await verify(...args);
      verified.resolve();
      await release.promise;
      return matches;
    });
    const pending = authenticate(database, "alice", "old-secret", "unused");
    await verified.promise;
    const administrator = openDatabase(path);
    try {
      if (operation === "reset")
        await resetPassword(administrator, "alice", "new-secret");
      else if (operation === "change")
        await changePassword(administrator, session.token, {
          accountId: session.account.accountId,
          currentPassword: "old-secret",
          newPassword: "new-secret",
        });
      else revokeAllSessions(administrator, "alice");
    } finally {
      administrator.close();
      release.resolve();
    }
    expect(await pending).toBeUndefined();
    expect(
      database.db
        .select()
        .from(sessions)
        .all()
        .filter((row) => row.revokedAt === null),
    ).toHaveLength(0);
  },
);

it("validates reset/revocation targets without changing credentials or audit history", async () => {
  const { database, login } = await setup();
  await expect(
    resetPassword(database, "missing", "new-secret"),
  ).rejects.toThrow("account-not-found");
  await expect(resetPassword(database, "alice", "")).rejects.toThrow(
    "invalid-account-input",
  );
  await expect(
    resetPassword(database, "alice", "x".repeat(1025)),
  ).rejects.toThrow("invalid-account-input");
  expect(() => revokeAllSessions(database, " ")).toThrow(
    "invalid-account-input",
  );
  expect(() => revokeAllSessions(database, "missing")).toThrow(
    "account-not-found",
  );
  expect(readAccountAudit(database, "alice")).toHaveLength(1);
  await login();
});

it("runs the administrative CLI against a live database without printing secrets", async () => {
  const { path, database, login } = await setup();
  const initial = await login();
  const script = fileURLToPath(
    new URL("../dist/provision-account.js", import.meta.url),
  );
  const run = (
    command: string,
    password?: string,
    username = "alice",
    extra: string[] = [],
  ) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DGLZ_DB_PATH: path,
      DGLZ_USERNAME: username,
    };
    delete env.DGLZ_PASSWORD;
    if (password !== undefined) env.DGLZ_PASSWORD = password;
    return spawnSync(process.execPath, [script, command, ...extra], {
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
  };
  const provisioned = run("provision", "bob-secret", "bob");
  expect(provisioned.status).toBe(0);
  expect(provisioned.stdout).toContain("已创建账户");
  expect(run("reset-password").stderr).toContain("请通过 DGLZ_PASSWORD");
  expect(run("reset-password", "new-secret", "missing").status).toBe(1);
  expect(run("reset-password", "").status).toBe(1);
  const reset = run("reset-password", "cli-secret");
  expect(reset.status).toBe(0);
  expect(reset.stdout).toContain("密码已重置");
  expect(resolveSession(database, initial.token)).toBeUndefined();
  const session = await login("cli-secret");
  expect(run("revoke-sessions").status).toBe(0);
  expect(resolveSession(database, session.token)).toBeUndefined();
  const audit = run("audit");
  expect(audit.status).toBe(0);
  expect(audit.stdout).toContain("重置密码");
  const invalid = run("reset-password", "cli-secret", "alice", [
    "argument-secret",
  ]);
  expect(invalid.status).toBe(1);
  for (const output of [reset, audit, invalid]) {
    expect(output.stdout + output.stderr).not.toMatch(
      /cli-secret|argument-secret|\$argon2/,
    );
    expect(output.stderr).not.toContain(" at ");
  }
}, 20_000);

it("upgrades existing accounts and sessions without changing their identity", async () => {
  const path = await databasePath();
  const legacy = new BetterSqlite3(path);
  for (const name of [
    "0000_initial",
    "0001_accepted_commands",
    "0002_challenge_templates",
    "0003_room_controls",
  ])
    legacy.exec(
      await readFile(
        new URL(`../drizzle/${name}.sql`, import.meta.url),
        "utf8",
      ),
    );
  legacy.exec(
    "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric); INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('legacy', 1788692403000)",
  );
  legacy
    .prepare(
      "INSERT INTO accounts (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
    )
    .run("legacy", "alice", "unused", 1);
  legacy
    .prepare(
      "INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(hashSessionToken("legacy-token"), "legacy", 1, Date.now() + 60_000);
  legacy.close();
  const database = openDatabase(path);
  try {
    expect(database.db.select().from(accounts).get()).toMatchObject({
      id: "legacy",
      authVersion: 0,
    });
    expect(resolveSession(database, "legacy-token")?.accountId).toBe("legacy");
    expect(readAccountAudit(database, "alice")).toEqual([]);
    revokeAllSessions(database, "alice");
    expect(resolveSession(database, "legacy-token")).toBeUndefined();
  } finally {
    database.close();
  }
});

async function roomSetup() {
  const fixture = await setup();
  const roomId = randomUUID();
  appendRoomCreated(fixture.database, {
    type: "RoomCreated",
    roomId,
    ownerId: fixture.account.accountId,
    rulesConfiguration: rulesConfigurationPreset("dglz-4p-2d-v1", "省心"),
    seatingPolicy: "fixed",
  });
  const room = (await new RoomExecutorRegistry(fixture.database).getOrCreate(
    roomId,
  ))!;
  const envelope = (payload: RoomCommandPayload) => ({
    protocolVersion: PROTOCOL_VERSION,
    commandId: randomUUID(),
    roomId,
    expectedRevision: room.revision,
    payload,
  });
  return { ...fixture, room, envelope };
}

it("rechecks queued commands, cached acknowledgements, resumption, and Challenge creation after revocation", async () => {
  const { database, account, login, room, envelope } = await roomSetup();
  const session = await login();
  const authorize = () =>
    assertSession(database, session.token, account.accountId);
  const accepted = envelope({ type: "AssignSeat", seatIndex: 0 });
  expect(
    (await room.execute(account.accountId, accepted, undefined, authorize)).ok,
  ).toBe(true);
  const revision = room.revision;
  const pending = [
    room.execute(
      account.accountId,
      envelope({ type: "SelectMatch" }),
      undefined,
      authorize,
    ),
    room.execute(account.accountId, accepted, undefined, authorize),
    room.resumeSettledHand(account.accountId, authorize),
    room.createChallengeCode(account.accountId, 1, authorize),
  ];
  revokeAllSessions(database, "alice");
  for (const operation of pending)
    await expect(operation).rejects.toBeInstanceOf(UnauthorizedSessionError);
  expect(room.revision).toBe(revision);
  expect(room.viewFor(account.accountId)?.view.members).toHaveLength(1);
});

it("rechecks authorization inside the commit after asynchronous presence checks", async () => {
  const { database, account, login, room, envelope } = await roomSetup();
  const ids = [account.accountId, "b", "c", "d"];
  database.db
    .insert(accounts)
    .values(
      ids.slice(1).map((id) => ({
        id,
        username: id,
        passwordHash: "unused",
        createdAt: 1,
      })),
    )
    .run();
  const send = async (id: string, payload: RoomCommandPayload) => {
    expect((await room.execute(id, envelope(payload))).ok).toBe(true);
  };
  for (const id of ids.slice(1)) await send(id, { type: "JoinRoom" });
  await send(account.accountId, { type: "SelectMatch" });
  for (const [seatIndex, id] of ids.entries()) {
    await send(id, { type: "AssignSeat", seatIndex });
    if (seatIndex > 0) await send(id, { type: "SetReadiness", ready: true });
  }
  const session = await login();
  const revision = room.revision;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<ReadonlySet<string>>();
  const command = room.execute(
    account.accountId,
    envelope({ type: "SetReadiness", ready: true }),
    () => {
      entered.resolve();
      return release.promise;
    },
    () => assertSession(database, session.token, account.accountId),
  );
  await entered.promise;
  revokeAllSessions(database, "alice");
  release.resolve(new Set(ids));
  expect(await command).toMatchObject({
    ok: false,
    error: { code: "unauthorized" },
  });
  expect(room.revision).toBe(revision);
  expect(room.viewFor(account.accountId)?.view.lifecycle).toBe("LOBBY");
});

it("changes passwords through HTTP with account binding, atomic audit, and revocation", async () => {
  const { path, database, account, login } = await setup();
  const first = await login();
  const second = await login();
  const bob = await provisionAccount(database, {
    username: "bob",
    password: "old-secret",
  });
  const bobSession = (await authenticate(
    database,
    "bob",
    "old-secret",
    "unused",
  ))!;
  const app = await createApp({
    dbPath: path,
    allowedOrigin: "https://game.example",
    secureCookies: false,
  });
  cleanups.push(() => app.close());
  const headers = {
    [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
    cookie: `dglz_session=${first.token}`,
    origin: "https://game.example",
  };
  const payload = {
    accountId: account.accountId,
    currentPassword: "old-secret",
    newPassword: "new-secret",
  };
  const request = (body: typeof payload, extraHeaders = {}) =>
    app.inject({
      method: "POST",
      url: "/api/account/password",
      headers: { ...headers, ...extraHeaders },
      payload: body,
    });
  expect(
    (await request(payload, { origin: "https://attacker.example" })).statusCode,
  ).toBe(403);
  expect(
    (await request({ ...payload, currentPassword: "wrong" })).json(),
  ).toMatchObject({ error: { code: "invalid-credentials" } });
  expect(
    (
      await request(payload, { cookie: `dglz_session=${bobSession.token}` })
    ).json(),
  ).toMatchObject({ error: { code: "unauthorized" } });
  expect((await request({ ...payload, newPassword: "" })).statusCode).toBe(400);
  expect(readAccountAudit(database, "alice")).toHaveLength(1);
  expect(resolveSession(database, first.token)).toEqual(account);

  const changed = await request(payload);
  expect(changed.statusCode).toBe(200);
  expect(changed.json()).toEqual({
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    data: {},
  });
  expect(changed.headers["cache-control"]).toBe("no-store");
  expect(changed.headers["set-cookie"]).toContain("dglz_session=;");
  expect(changed.headers["set-cookie"]).toContain("HttpOnly");
  expect(readAccountAudit(database, "alice")[0]).toMatchObject({
    action: "change-password",
    actor: account.accountId,
    source: "session",
    accountId: account.accountId,
  });
  for (const token of [first.token, second.token]) {
    expect(resolveSession(database, token)).toBeUndefined();
    expect(
      (
        await app.inject({
          url: "/api/session",
          headers: { ...headers, cookie: `dglz_session=${token}` },
        })
      ).statusCode,
    ).toBe(401);
  }
  expect(resolveSession(database, bobSession.token)).toEqual(bob);
  expect(
    await authenticate(database, "alice", "old-secret", "unused"),
  ).toBeUndefined();
  expect((await login("new-secret")).account).toEqual(account);
  expect((await request(payload)).statusCode).toBe(401);
});

it("throttles password guesses by account across sessions", async () => {
  const { path, database, account, login } = await setup();
  const session = await login();
  const other = await login();
  const app = await createApp({ dbPath: path, secureCookies: false });
  cleanups.push(() => app.close());
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await app.inject({
      method: "POST",
      url: "/api/account/password",
      headers: {
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        cookie: `dglz_session=${attempt % 2 ? other.token : session.token}`,
      },
      payload: {
        accountId: account.accountId,
        currentPassword: "wrong",
        newPassword: "new-secret",
      },
    });
    expect(response.statusCode).toBe(attempt === 5 ? 429 : 401);
  }
  expect(readAccountAudit(database, "alice")).toHaveLength(1);
  expect(resolveSession(database, session.token)).toEqual(account);
});

it.each(["reset", "revoke", "logout", "change"])(
  "rejects an in-flight password change after %s",
  async (operation) => {
    const { path, database, account, login } = await setup();
    const session = await login();
    const other = await login();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const hash = argon2.hash;
    vi.spyOn(argon2, "hash").mockImplementationOnce(async (...args) => {
      const encoded = await hash(...args);
      entered.resolve();
      await release.promise;
      return encoded;
    });
    const pending = changePassword(database, session.token, {
      accountId: account.accountId,
      currentPassword: "old-secret",
      newPassword: "losing-secret",
    });
    await entered.promise;
    const concurrent = openDatabase(path);
    try {
      if (operation === "reset")
        await resetPassword(concurrent, "alice", "winning-secret");
      else if (operation === "change")
        await changePassword(concurrent, other.token, {
          accountId: account.accountId,
          currentPassword: "old-secret",
          newPassword: "winning-secret",
        });
      else if (operation === "logout") revokeSession(concurrent, session.token);
      else revokeAllSessions(concurrent, "alice");
    } finally {
      concurrent.close();
      release.resolve();
    }
    await expect(pending).rejects.toBeInstanceOf(UnauthorizedSessionError);
    expect(
      await authenticate(database, "alice", "losing-secret", "unused"),
    ).toBeUndefined();
    expect(
      await authenticate(
        database,
        "alice",
        operation === "reset" || operation === "change"
          ? "winning-secret"
          : "old-secret",
        "unused",
      ),
    ).toBeDefined();
    expect(readAccountAudit(database, "alice")).toHaveLength(2);
  },
);

it("rejects room creation waiting on an administrator's uncommitted revocation", async () => {
  const { path, database, account, login } = await setup();
  const session = await login();
  const app = await createApp({ dbPath: path, secureCookies: false });
  cleanups.push(() => app.close());
  const administrator = new Worker(
    `const { parentPort, workerData } = require('node:worker_threads');
     const Database = require(workerData.sqliteModule);
     const database = new Database(workerData.path);
     database.exec('BEGIN IMMEDIATE');
     database.prepare('UPDATE sessions SET revoked_at = ? WHERE account_id = ?')
       .run(Date.now(), workerData.accountId);
     database.prepare('UPDATE accounts SET auth_version = auth_version + 1 WHERE id = ?')
       .run(workerData.accountId);
     parentPort.once('message', () => setTimeout(() => {
       database.exec('COMMIT');
       database.close();
     }, 500));
     parentPort.postMessage('locked');`,
    {
      eval: true,
      workerData: {
        path,
        accountId: account.accountId,
        sqliteModule: createRequire(import.meta.url).resolve("better-sqlite3"),
      },
    },
  );
  cleanups.push(async () => {
    await administrator.terminate();
  });
  const locked = new Promise<void>((resolve, reject) => {
    administrator.once("message", () => resolve());
    administrator.once("error", reject);
  });
  const committed = new Promise<number>((resolve, reject) => {
    administrator.once("exit", resolve);
    administrator.once("error", reject);
  });
  app.addHook("preHandler", async (request) => {
    if (request.url === "/api/rooms") administrator.postMessage("release");
  });
  await locked;
  // WAL readers still see a valid session while the administrator holds the write lock.
  expect(resolveSession(database, session.token)).toEqual(account);
  const response = await app.inject({
    method: "POST",
    url: "/api/rooms",
    headers: {
      [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
      cookie: `dglz_session=${session.token}`,
    },
    payload: { rulesetId: "dglz-4p-2d-v1", seatingPolicy: "fixed" },
  });
  expect(await committed).toBe(0);
  expect(response.statusCode).toBe(401);
  expect(response.json()).toMatchObject({ error: { code: "unauthorized" } });
  expect(resolveSession(database, session.token)).toBeUndefined();
  for (const table of ["room_events", "room_controls"])
    expect(database.sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
});

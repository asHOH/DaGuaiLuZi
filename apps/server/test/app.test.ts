import { mkdtemp, rm } from "node:fs/promises";
import type { OutgoingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  LoginResponseEnvelopeSchema,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  RoomResponseEnvelopeSchema,
} from "@dglz/protocol";

import { createApp } from "../src/app.js";
import { hashSessionToken, provisionAccount } from "../src/auth.js";
import { openDatabase } from "../src/db/index.js";

const databasePaths: string[] = [];
const apps = new Set<FastifyInstance>();

afterEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();
  for (const path of databasePaths.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

function protocolHeaders(): Record<string, string> {
  return { [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION) };
}

function setCookieHeader(headers: OutgoingHttpHeaders): string | undefined {
  const setCookie = headers["set-cookie"];
  return typeof setCookie === "string"
    ? setCookie
    : Array.isArray(setCookie) && typeof setCookie[0] === "string"
      ? setCookie[0]
      : undefined;
}

function sessionToken(response: { headers: OutgoingHttpHeaders }): string {
  const header = setCookieHeader(response.headers);
  if (header === undefined) {
    throw new Error("missing-session-cookie");
  }
  const token = /^dglz_session=([^;]+)/.exec(header)?.[1];
  if (token === undefined) {
    throw new Error("invalid-session-cookie");
  }
  return token;
}

function sessionCookie(response: { headers: OutgoingHttpHeaders }): string {
  return `dglz_session=${sessionToken(response)}`;
}

async function makeDatabase(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dglz-phase1-"));
  databasePaths.push(directory);
  return join(directory, "server.sqlite");
}

async function makeApp(
  options: Parameters<typeof createApp>[0],
): Promise<FastifyInstance> {
  const app = await createApp(options);
  apps.add(app);
  return app;
}

async function closeApp(app: FastifyInstance): Promise<void> {
  apps.delete(app);
  await app.close();
}

describe("phase 1 HTTP slice", () => {
  it("provisions, authenticates, creates, reads, and reconstructs a room", async () => {
    const dbPath = await makeDatabase();
    const database = openDatabase(dbPath);
    expect(database.sqlite.pragma("journal_mode", { simple: true })).toBe(
      "wal",
    );
    expect(database.sqlite.pragma("synchronous", { simple: true })).toBe(1);
    const owner = await provisionAccount(database, {
      username: "Alice",
      password: "correct horse battery staple",
    });
    const second = await provisionAccount(database, {
      username: "Bob",
      password: "correct horse battery staple",
    });
    database.close();

    const app = await makeApp({
      dbPath,
      allowedOrigin: "https://game.example",
      secureCookies: false,
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: {
        ...protocolHeaders(),
        origin: "https://game.example",
      },
      payload: { username: "alice", password: "correct horse battery staple" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["content-security-policy"]).toBeDefined();
    expect(login.headers["x-content-type-options"]).toBe("nosniff");
    expect(login.json()).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      data: { accountId: owner.accountId, username: "alice" },
    });
    expect(LoginResponseEnvelopeSchema.parse(login.json())).toEqual(
      login.json(),
    );
    expect(login.body).not.toContain("password");
    expect(login.body).not.toContain("token");
    const cookie = sessionCookie(login);
    const rawSessionToken = sessionToken(login);
    const cookieHeader = setCookieHeader(login.headers);
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("SameSite=Lax");
    expect(cookieHeader).toContain("Path=/");
    expect(cookieHeader).not.toContain("Secure");

    const created = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: {
        ...protocolHeaders(),
        cookie,
        origin: "https://game.example",
      },
      payload: { rulesetId: "dglz-4p-2d-v1", seatingPolicy: "randomized" },
    });
    expect(created.statusCode).toBe(201);
    expect(RoomResponseEnvelopeSchema.parse(created.json())).toEqual(
      created.json(),
    );
    expect(created.body).not.toContain("password");
    expect(created.body).not.toContain("token");
    const createdBody = created.json() as {
      data: {
        revision: number;
        view: { roomId: string; rulesConfiguration: Record<string, string> };
      };
    };
    expect(createdBody.data.revision).toBe(1);
    expect(createdBody.data.view.rulesConfiguration).toMatchObject({
      rulesetId: "dglz-4p-2d-v1",
      wildcardRank: "strongest-rank",
      finishingWildcardInterpretation: "weakest-form-and-rank",
      flushTieBreaking: "descending-ranks",
      nextHandLeader: "first-finisher",
      tributeCardSelection: "fair-random",
      tributeRecipientPairing: "adjacent-first-automatic",
      matchEnding: "no-failure-limit-at-5",
    });
    const roomId = createdBody.data.view.roomId;

    const firstRead = await app.inject({
      method: "GET",
      url: `/api/rooms/${roomId}`,
      headers: { ...protocolHeaders(), cookie },
    });
    expect(firstRead.statusCode).toBe(200);
    expect(firstRead.json()).toEqual(created.json());

    const mismatch = await app.inject({
      method: "GET",
      url: `/api/rooms/${roomId}`,
      headers: { [PROTOCOL_VERSION_HEADER]: "999", cookie },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      ok: false,
      error: { code: "reload-required" },
    });

    for (const version of [undefined, "999"] as const) {
      const incompatibleCreate = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers: {
          ...(version === undefined
            ? {}
            : { [PROTOCOL_VERSION_HEADER]: version }),
          cookie,
        },
        payload: { rulesetId: "dglz-4p-2d-v1", seatingPolicy: "fixed" },
      });
      expect(incompatibleCreate.statusCode).toBe(409);
      expect(incompatibleCreate.json()).toMatchObject({
        ok: false,
        error: { code: "reload-required" },
      });
    }

    const malformed = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: { ...protocolHeaders(), cookie },
      payload: { rulesetId: "dglz-4p-2d-v1" },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({
      ok: false,
      error: { code: "malformed-input" },
    });

    const foreignOrigin = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: {
        ...protocolHeaders(),
        cookie,
        origin: "https://attacker.example",
      },
      payload: { rulesetId: "dglz-4p-2d-v1", seatingPolicy: "fixed" },
    });
    expect(foreignOrigin.statusCode).toBe(403);
    expect(foreignOrigin.json()).toMatchObject({
      ok: false,
      error: { code: "origin-forbidden" },
    });

    const sixPlayerRoom = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: { ...protocolHeaders(), cookie },
      payload: { rulesetId: "dglz-6p-3d-v1", seatingPolicy: "fixed" },
    });
    expect(sixPlayerRoom.statusCode).toBe(201);
    expect(
      (
        sixPlayerRoom.json() as {
          data: { view: { rulesConfiguration: unknown } };
        }
      ).data.view.rulesConfiguration,
    ).toEqual({
      rulesetId: "dglz-6p-3d-v1",
      wildcardRank: "strongest-rank",
      finishingWildcardInterpretation: "weakest-form-and-rank",
      flushTieBreaking: "descending-ranks",
      nextHandLeader: "first-finisher",
      tributeCardSelection: "fair-random",
      tributeRecipientPairing: "adjacent-first-automatic",
      matchEnding: "no-failure-limit-at-5",
      jokerPairComparison: "two-small-and-mixed-are-equal",
      returnCardSelection: "recipient-choice",
    });
    const sixPlayerRoomId = (
      sixPlayerRoom.json() as { data: { view: { roomId: string } } }
    ).data.view.roomId;

    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: protocolHeaders(),
      payload: {
        username: "bob",
        password: "correct horse battery staple",
      },
    });
    const secondCookie = sessionCookie(secondLogin);
    expect(secondLogin.body).not.toContain("another password");
    const nonmemberRead = await app.inject({
      method: "GET",
      url: `/api/rooms/${roomId}`,
      headers: { ...protocolHeaders(), cookie: secondCookie },
    });
    expect(nonmemberRead.statusCode).toBe(403);
    expect(nonmemberRead.json()).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });

    const beforeRestart = firstRead.json();
    await closeApp(app);
    const reopened = await makeApp({
      dbPath,
      allowedOrigin: "https://game.example",
      secureCookies: false,
    });
    const afterRestart = await reopened.inject({
      method: "GET",
      url: `/api/rooms/${roomId}`,
      headers: { ...protocolHeaders(), cookie },
    });
    expect(afterRestart.statusCode).toBe(200);
    expect(afterRestart.json()).toEqual(beforeRestart);

    const logout = await reopened.inject({
      method: "POST",
      url: "/api/logout",
      headers: { ...protocolHeaders(), cookie },
    });
    expect(logout.statusCode).toBe(200);
    const afterLogout = await reopened.inject({
      method: "GET",
      url: `/api/rooms/${roomId}`,
      headers: { ...protocolHeaders(), cookie },
    });
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.json()).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    await closeApp(reopened);

    const secureApp = await makeApp({
      dbPath,
      allowedOrigin: "https://game.example",
      secureCookies: true,
    });
    const secureLogin = await secureApp.inject({
      method: "POST",
      url: "/api/login",
      headers: protocolHeaders(),
      payload: { username: "alice", password: "correct horse battery staple" },
    });
    expect(setCookieHeader(secureLogin.headers)).toContain("Secure");
    await closeApp(secureApp);

    const persisted = openDatabase(dbPath);
    const accountRows = persisted.sqlite
      .prepare("SELECT username, password_hash FROM accounts ORDER BY username")
      .all() as Array<{ username: string; password_hash: string }>;
    expect(accountRows).toHaveLength(2);
    expect(accountRows.map((row) => row.username)).toEqual(["alice", "bob"]);
    expect(
      accountRows.every((row) => row.password_hash.startsWith("$argon2id$")),
    ).toBe(true);
    expect(accountRows[0]?.password_hash).not.toBe(
      accountRows[1]?.password_hash,
    );
    expect(
      await argon2.verify(
        accountRows[0]?.password_hash ?? "",
        "correct horse battery staple",
      ),
    ).toBe(true);
    const sessionRows = persisted.sqlite
      .prepare("SELECT token_hash FROM sessions")
      .all() as Array<{ token_hash: string }>;
    expect(sessionRows.some((row) => row.token_hash === rawSessionToken)).toBe(
      false,
    );
    expect(
      sessionRows.some(
        (row) => row.token_hash === hashSessionToken(rawSessionToken),
      ),
    ).toBe(true);
    const eventRows = persisted.sqlite
      .prepare(
        "SELECT room_id, sequence, event_type FROM room_events ORDER BY room_id",
      )
      .all() as Array<{
      room_id: string;
      sequence: number;
      event_type: string;
    }>;
    expect(eventRows).toEqual(
      [roomId, sixPlayerRoomId].sort().map((persistedRoomId) => ({
        room_id: persistedRoomId,
        sequence: 1,
        event_type: "RoomCreated",
      })),
    );
    persisted.close();
    expect(second.accountId).not.toBe(owner.accountId);
  });

  it("makes unknown and wrong passwords indistinguishable", async () => {
    const dbPath = await makeDatabase();
    const database = openDatabase(dbPath);
    await provisionAccount(database, { username: "alice", password: "secret" });
    database.close();
    const app = await makeApp({ dbPath, secureCookies: false });
    const headers = protocolHeaders();
    const wrong = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { username: "alice", password: "wrong" },
    });
    const missing = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { username: "nobody", password: "wrong" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json()).toEqual(missing.json());

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { username: "nobody", password: "wrong" },
      });
      expect(response.statusCode).toBe(401);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { username: "nobody", password: "wrong" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      ok: false,
      error: { code: "rate-limited" },
    });
    const differentAccount = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { username: "alice", password: "secret" },
    });
    expect(differentAccount.statusCode).toBe(200);
  });

  it("rejects invalid provisioning, empty JSON, and expired sessions", async () => {
    const dbPath = await makeDatabase();
    const database = openDatabase(dbPath);
    await expect(
      provisionAccount(database, {
        username: "x".repeat(65),
        password: "secret",
      }),
    ).rejects.toThrow("invalid-account-input");
    await provisionAccount(database, { username: "alice", password: "secret" });
    database.close();

    const app = await makeApp({ dbPath, secureCookies: false });
    const empty = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: {
        ...protocolHeaders(),
        "content-type": "application/json",
      },
      payload: "",
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({
      ok: false,
      error: { code: "malformed-input" },
    });
    const wrongMediaType = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: {
        ...protocolHeaders(),
        "content-type": "text/plain",
      },
      payload: "not-json",
    });
    expect(wrongMediaType.statusCode).toBe(400);

    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: protocolHeaders(),
      payload: { username: "alice", password: "secret" },
    });
    const token = sessionToken(login);
    const persisted = openDatabase(dbPath);
    persisted.sqlite
      .prepare("UPDATE sessions SET expires_at = 0 WHERE token_hash = ?")
      .run(hashSessionToken(token));
    persisted.close();
    const expired = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: { ...protocolHeaders(), cookie: sessionCookie(login) },
      payload: { rulesetId: "dglz-4p-2d-v1", seatingPolicy: "fixed" },
    });
    expect(expired.statusCode).toBe(401);
  });

  it("reports an unsupported persisted event after restart", async () => {
    const dbPath = await makeDatabase();
    const database = openDatabase(dbPath);
    await provisionAccount(database, { username: "alice", password: "secret" });
    database.close();
    const app = await makeApp({ dbPath, secureCookies: false });
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: protocolHeaders(),
      payload: { username: "alice", password: "secret" },
    });
    const cookie = sessionCookie(login);
    const created = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: { ...protocolHeaders(), cookie },
      payload: { rulesetId: "dglz-4p-2d-v1", seatingPolicy: "fixed" },
    });
    const roomId = (created.json() as { data: { view: { roomId: string } } })
      .data.view.roomId;
    await closeApp(app);

    const persisted = openDatabase(dbPath);
    persisted.sqlite
      .prepare(
        "UPDATE room_events SET event_schema_version = 999 WHERE room_id = ? AND sequence = 1",
      )
      .run(roomId);
    persisted.close();

    const reopened = await makeApp({ dbPath, secureCookies: false });
    const response = await reopened.inject({
      method: "GET",
      url: `/api/rooms/${roomId}`,
      headers: { ...protocolHeaders(), cookie },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: "unsupported-persisted-event" },
    });

    const corrupted = openDatabase(dbPath);
    corrupted.sqlite
      .prepare(
        "UPDATE room_events SET event_schema_version = 1, payload = '{' WHERE room_id = ? AND sequence = 1",
      )
      .run(roomId);
    corrupted.close();
    const malformedPayload = await reopened.inject({
      method: "GET",
      url: `/api/rooms/${roomId}`,
      headers: { ...protocolHeaders(), cookie },
    });
    expect(malformedPayload.statusCode).toBe(500);
    expect(malformedPayload.json()).toMatchObject({
      ok: false,
      error: { code: "unsupported-persisted-event" },
    });
  });
});

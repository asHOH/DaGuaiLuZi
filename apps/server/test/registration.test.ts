import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import argon2 from "argon2";
import { afterEach, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, PROTOCOL_VERSION_HEADER } from "@dglz/protocol";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";
import { readAccountAudit, resetPassword } from "../src/auth.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "dglz-registration-"));
  cleanups.push(() =>
    rm(directory, { recursive: true, force: true, maxRetries: 3 }),
  );
  const dbPath = join(directory, "accounts.sqlite");
  const app = await createApp({
    dbPath,
    allowedOrigin: "https://game.example",
  });
  cleanups.push(() => app.close());
  const database = openDatabase(dbPath);
  cleanups.push(() => database.close());
  const headers: Record<string, string> = {
    [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
    origin: "https://game.example",
    "content-type": "application/json",
  };
  const post = (
    url: string,
    payload: unknown,
    extraHeaders: Record<string, string> = {},
  ) =>
    app.inject({
      method: "POST",
      url,
      headers: { ...headers, ...extraHeaders },
      payload: JSON.stringify(payload),
    });
  return { app, database, post, headers };
}

it("registers and signs in atomically; empty passwords survive login, change, and administrator reset", async () => {
  const { app, database, post, headers } = await setup();
  const created = await post("/api/register", {
    username: " ＡＬＩＣＥ朋友 ",
    password: "",
    confirmPassword: "",
  });
  expect(created.statusCode).toBe(201);
  const account = created.json().data;
  expect(account.username).toBe("alice朋友");
  expect(created.headers["cache-control"]).toBe("no-store");
  const cookieHeader = String(created.headers["set-cookie"]);
  expect(cookieHeader).toMatch(/HttpOnly/);
  expect(cookieHeader).toMatch(/Secure/);
  expect(cookieHeader).toMatch(/SameSite=Lax/);
  const cookie = cookieHeader.split(";")[0]!;
  const session = await app.inject({
    url: "/api/session",
    headers: { ...headers, cookie },
  });
  expect(session.json().data).toEqual(account);
  const stored = database.sqlite.prepare("SELECT * FROM accounts").get() as {
    password_hash: string;
    email: string | null;
  };
  expect(await argon2.verify(stored.password_hash, "")).toBe(true);
  expect(stored.email).toBeNull();
  expect(readAccountAudit(database, account.username)).toMatchObject([
    { action: "register", source: "registration", actor: account.accountId },
  ]);
  expect(
    (await post("/api/login", { username: "ALICE朋友", password: "wrong" }))
      .statusCode,
  ).toBe(401);
  expect(
    (await post("/api/login", { username: "alice朋友", password: "" }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await post(
        "/api/account/password",
        { accountId: account.accountId, currentPassword: "", newPassword: "x" },
        { cookie },
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ url: "/api/session", headers: { ...headers, cookie } }))
      .statusCode,
  ).toBe(401);
  const login = await post("/api/login", {
    username: "alice朋友",
    password: "x",
  });
  const nextCookie = String(login.headers["set-cookie"]).split(";")[0]!;
  expect(
    (
      await post(
        "/api/account/password",
        { accountId: account.accountId, currentPassword: "x", newPassword: "" },
        { cookie: nextCookie },
      )
    ).statusCode,
  ).toBe(200);
  await resetPassword(database, "alice朋友", "reset");
  await resetPassword(database, "alice朋友", "");
  expect(
    (await post("/api/login", { username: "alice朋友", password: "" }))
      .statusCode,
  ).toBe(200);
});

it("validates confirmation, bounds, origin, version, and normalized duplicate usernames without overwriting accounts", async () => {
  const { post, database } = await setup();
  const valid = { username: "Alice", password: "x", confirmPassword: "x" };
  for (const payload of [
    { ...valid, confirmPassword: "" },
    { ...valid, password: null },
    { username: "Alice", password: "x" },
    { ...valid, username: " " },
    { ...valid, username: "x".repeat(65) },
    { ...valid, username: "ﬃ".repeat(22) },
    { ...valid, password: "x".repeat(1025), confirmPassword: "x".repeat(1025) },
    { ...valid, email: "unrequested@example.test" },
  ])
    expect((await post("/api/register", payload)).statusCode).toBe(400);
  expect(
    (await post("/api/register", valid, { origin: "https://other.example" }))
      .statusCode,
  ).toBe(403);
  expect(
    (await post("/api/register", valid, { [PROTOCOL_VERSION_HEADER]: "0" }))
      .statusCode,
  ).toBe(409);
  expect(
    (await post("/api/register", { ...valid, username: "x".repeat(17_000) }))
      .statusCode,
  ).toBe(400);
  const results = await Promise.all([
    post("/api/register", valid),
    post("/api/register", { ...valid, username: " ＡＬＩＣＥ " }),
  ]);
  expect(
    results.map((response) => response.statusCode).sort((a, b) => a - b),
  ).toEqual([201, 409]);
  expect(
    results.find((response) => response.statusCode === 409)!.json().error.code,
  ).toBe("account-already-exists");
  expect(
    database.sqlite.prepare("SELECT count(*) AS n FROM accounts").get(),
  ).toEqual({ n: 1 });
  expect(
    database.sqlite.prepare("SELECT count(*) AS n FROM sessions").get(),
  ).toEqual({ n: 1 });
  expect(readAccountAudit(database, "alice")).toHaveLength(1);
  expect(
    (await post("/api/login", { username: "alice", password: "x" })).statusCode,
  ).toBe(200);
});

it("rolls back registration if its session cannot be persisted", async () => {
  const { database, post } = await setup();
  database.sqlite.exec(
    "CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'test-failure'); END;",
  );
  expect(
    (
      await post("/api/register", {
        username: "friend",
        password: "",
        confirmPassword: "",
      })
    ).statusCode,
  ).toBe(500);
  for (const table of ["accounts", "sessions", "account_audit"])
    expect(
      database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get(),
    ).toEqual({ n: 0 });
});

it("caps registration and rotating-name login attempts before hashing, without disabling per-account limits", async () => {
  const { post } = await setup();
  const hash = vi.spyOn(argon2, "hash");
  for (let index = 0; index < 30; index++)
    expect((await post("/api/register", {})).statusCode).toBe(400);
  const blocked = await post(
    "/api/register",
    { username: "friend", password: "", confirmPassword: "" },
    { "x-forwarded-for": "203.0.113.1" },
  );
  expect(blocked.statusCode).toBe(429);
  expect(blocked.headers["retry-after"]).toBeDefined();
  expect(hash).not.toHaveBeenCalled();
  for (let index = 0; index < 5; index++)
    expect(
      (await post("/api/login", { username: "Alice", password: "" }))
        .statusCode,
    ).toBe(401);
  expect(
    (await post("/api/login", { username: " ＡＬＩＣＥ ", password: "" }))
      .statusCode,
  ).toBe(429);
  for (let index = 6; index < 60; index++)
    expect(
      (await post("/api/login", { username: `friend${index}`, password: "" }))
        .statusCode,
    ).toBe(401);
  const verify = vi.spyOn(argon2, "verify");
  expect(
    (await post("/api/login", { username: "another", password: "" }))
      .statusCode,
  ).toBe(429);
  expect(verify).not.toHaveBeenCalled();
});

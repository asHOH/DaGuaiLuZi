import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  RoomViewSyncEnvelopeSchema,
  SOCKET_ROOM_COMMAND_EVENT,
  rulesConfigurationPreset,
  type RoomCommandAck,
} from "@dglz/protocol";

import { createApp } from "../src/app.js";
import { provisionAccount } from "../src/auth.js";
import { openDatabase } from "../src/db/index.js";

const paths: string[] = [];
const sockets: Socket[] = [];
const apps: Awaited<ReturnType<typeof createApp>>[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const app of apps.splice(0)) await app.close();
  for (const path of paths.splice(0)) {
    await rm(path, { recursive: true, force: true, maxRetries: 3 });
  }
});

function command(
  roomId: string,
  expectedRevision: number,
  payload: unknown,
  commandId = randomUUID(),
): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    roomId,
    expectedRevision,
    payload,
  };
}

function portOf(app: Awaited<ReturnType<typeof createApp>>): number {
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("server-not-listening");
  }
  return address.port;
}

async function login(
  app: Awaited<ReturnType<typeof createApp>>,
  username: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: { [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION) },
    payload: { username, password: "secret" },
  });
  const cookie = response.headers["set-cookie"];
  if (typeof cookie !== "string") throw new Error("missing-cookie");
  return cookie.split(";", 1)[0] ?? "";
}

async function openSocket(
  port: number,
  cookie: string,
  roomId?: string,
): Promise<{ socket: Socket; firstView: Promise<unknown> }> {
  const socket = connect(`http://127.0.0.1:${port}`, {
    auth: { protocolVersion: PROTOCOL_VERSION, ...(roomId ? { roomId } : {}) },
    extraHeaders: {
      [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
      cookie,
      origin: "https://game.example",
    },
    transports: ["websocket"],
    reconnection: false,
  });
  sockets.push(socket);
  const firstView = new Promise<unknown>((resolve) => {
    socket.once("room:view", resolve);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return { socket, firstView };
}

function sendCommand(socket: Socket, value: unknown): Promise<RoomCommandAck> {
  return new Promise((resolve) => {
    socket.emit(SOCKET_ROOM_COMMAND_EVENT, value, resolve);
  });
}

function nextRoomView(socket: Socket): Promise<unknown> {
  return new Promise((resolve) => socket.once("room:view", resolve));
}

describe("phase 3 room lifecycle", () => {
  it("starts a four-player match atomically and reconstructs private views", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dglz-phase3-"));
    paths.push(directory);
    const dbPath = join(directory, "server.sqlite");
    const database = openDatabase(dbPath);
    for (const username of ["alice", "bob", "carol", "dave"]) {
      await provisionAccount(database, { username, password: "secret" });
    }
    database.close();

    const app = await createApp({
      dbPath,
      allowedOrigin: "https://game.example",
      secureCookies: false,
    });
    apps.push(app);
    const cookies = await Promise.all(
      ["alice", "bob", "carol", "dave"].map((username) => login(app, username)),
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: {
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        cookie: cookies[0],
      },
      payload: { rulesetId: "dglz-4p-2d-v1", seatingPolicy: "fixed" },
    });
    const roomId = (created.json() as { data: { view: { roomId: string } } })
      .data.view.roomId;
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = portOf(app);
    const connections = await Promise.all([
      openSocket(port, cookies[0]!, roomId),
      openSocket(port, cookies[1]!),
      openSocket(port, cookies[2]!),
      openSocket(port, cookies[3]!),
    ]);
    await connections[0]!.firstView;
    const roomSockets = connections.map(({ socket }) => socket);

    let revision = 1;
    for (const socket of roomSockets.slice(1)) {
      const result = await sendCommand(
        socket,
        command(roomId, revision, { type: "JoinRoom" }),
      );
      expect(result.ok).toBe(true);
      revision += 1;
    }
    expect(revision).toBe(4);

    expect(
      await sendCommand(
        roomSockets[1]!,
        command(roomId, revision, { type: "SelectMatch" }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "domain-rejected", reason: "owner-only" },
    });
    expect(
      await sendCommand(
        roomSockets[0]!,
        command(roomId, revision, { type: "SelectMatch" }),
      ),
    ).toMatchObject({ ok: true, data: { revision: 5 } });
    revision = 5;

    for (const [seatIndex, socket] of roomSockets.entries()) {
      expect(
        await sendCommand(
          socket,
          command(roomId, revision, { type: "AssignSeat", seatIndex }),
        ),
      ).toMatchObject({ ok: true, data: { revision: revision + 1 } });
      revision += 1;
    }
    expect(revision).toBe(9);

    for (const socket of roomSockets.slice(0, 3)) {
      const published = roomSockets.map(nextRoomView);
      const result = await sendCommand(
        socket,
        command(roomId, revision, { type: "SetReadiness", ready: true }),
      );
      expect(result.ok).toBe(true);
      revision += 1;
      expect(result).toMatchObject({
        ok: true,
        data: { view: { lifecycle: "LOBBY" } },
      });
      await Promise.all(published);
    }
    expect(revision).toBe(12);

    const finalCommand = command(
      roomId,
      revision,
      { type: "SetReadiness", ready: true },
      "89be3f38-d47e-4a86-95f3-22664ff54f1e",
    );
    const failing = openDatabase(dbPath);
    failing.sqlite.exec(`
      CREATE TRIGGER fail_match_start
      BEFORE INSERT ON room_events
      WHEN NEW.event_type = 'MatchStarted'
      BEGIN
        SELECT RAISE(ABORT, 'forced-start-failure');
      END
    `);
    failing.close();
    expect(await sendCommand(roomSockets[3]!, finalCommand)).toMatchObject({
      ok: false,
      error: { code: "internal-error" },
    });
    const afterFailure = openDatabase(dbPath);
    expect(
      (
        afterFailure.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM room_events WHERE room_id = ?",
          )
          .get(roomId) as { count: number }
      ).count,
    ).toBe(12);
    expect(
      (
        afterFailure.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM accepted_commands WHERE command_id = ?",
          )
          .get(finalCommand.commandId) as { count: number }
      ).count,
    ).toBe(0);
    afterFailure.sqlite.exec("DROP TRIGGER fail_match_start");
    afterFailure.close();

    const published = roomSockets.map(nextRoomView);
    const finalAck = await sendCommand(roomSockets[3]!, finalCommand);
    expect(finalAck).toMatchObject({
      ok: true,
      data: { revision: 14, view: { lifecycle: "ACTIVE" } },
    });
    const publishedViews = (await Promise.all(published)).map((value) =>
      RoomViewSyncEnvelopeSchema.parse(value),
    );
    expect(
      publishedViews.every(
        ({ data }) => data.revision === 14 && data.view.lifecycle === "ACTIVE",
      ),
    ).toBe(true);

    const views = await Promise.all(
      cookies.map(async (cookie) => {
        const response = await app.inject({
          method: "GET",
          url: `/api/rooms/${roomId}`,
          headers: {
            [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
            cookie,
          },
        });
        return RoomViewSyncEnvelopeSchema.parse({
          protocolVersion: PROTOCOL_VERSION,
          type: "room:view",
          data: response.json().data,
        }).data;
      }),
    );
    expect(views.every((view) => view.view.lifecycle === "ACTIVE")).toBe(true);
    expect(
      views.map((view) =>
        view.view.lifecycle === "ACTIVE" ? view.view.hand.length : undefined,
      ),
    ).toEqual([27, 27, 27, 27]);
    expect(
      new Set(
        views.map((view) =>
          JSON.stringify(
            view.view.lifecycle === "ACTIVE" ? view.view.hand : undefined,
          ),
        ),
      ).size,
    ).toBe(4);
    expect(JSON.stringify(views)).not.toContain("handSeed");

    const databaseAfterStart = openDatabase(dbPath);
    const events = databaseAfterStart.sqlite
      .prepare(
        "SELECT sequence, event_type AS eventType, causation_command_id AS causationCommandId FROM room_events WHERE room_id = ? ORDER BY sequence",
      )
      .all(roomId) as Array<{
      sequence: number;
      eventType: string;
      causationCommandId: string | null;
    }>;
    const accepted = databaseAfterStart.sqlite
      .prepare("SELECT COUNT(*) AS count FROM accepted_commands")
      .get() as { count: number };
    databaseAfterStart.close();
    expect(events.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: 14 }, (_, index) => index + 1),
    );
    expect(events.at(-1)?.eventType).toBe("MatchStarted");
    expect(events.at(-1)?.causationCommandId).toBe(finalCommand.commandId);
    expect(accepted.count).toBe(12);

    apps.splice(apps.indexOf(app), 1);
    await app.close();
    const reopened = await createApp({
      dbPath,
      allowedOrigin: "https://game.example",
      secureCookies: false,
    });
    apps.push(reopened);
    await reopened.listen({ host: "127.0.0.1", port: 0 });
    const afterRestart = await reopened.inject({
      method: "GET",
      url: `/api/rooms/${roomId}`,
      headers: {
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        cookie: cookies[0],
      },
    });
    expect(afterRestart.statusCode).toBe(200);
    expect(afterRestart.json().data.view).toEqual(views[0]!.view);
    const retrySocket = await openSocket(portOf(reopened), cookies[3]!, roomId);
    await retrySocket.firstView;
    expect(finalAck).toEqual(
      await sendCommand(retrySocket.socket, {
        ...finalCommand,
        payload: { ready: true, type: "SetReadiness" },
      }),
    );
    const afterRetry = openDatabase(dbPath);
    expect(
      (
        afterRetry.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM room_events WHERE room_id = ?",
          )
          .get(roomId) as { count: number }
      ).count,
    ).toBe(14);
    afterRetry.close();

    apps.splice(apps.indexOf(reopened), 1);
    await reopened.close();
    const corrupted = openDatabase(dbPath);
    corrupted.sqlite
      .prepare(
        "UPDATE room_events SET payload = '{}' WHERE room_id = ? AND event_type = 'MatchStarted'",
      )
      .run(roomId);
    corrupted.close();
    const afterCorruption = await createApp({
      dbPath,
      allowedOrigin: "https://game.example",
      secureCookies: false,
    });
    apps.push(afterCorruption);
    const rejected = await afterCorruption.inject({
      method: "GET",
      url: `/api/rooms/${roomId}`,
      headers: {
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        cookie: cookies[0],
      },
    });
    expect(rejected.statusCode).toBe(500);
    expect(rejected.json()).toMatchObject({
      ok: false,
      error: { code: "unsupported-persisted-event" },
    });
  });

  it("authorizes rule changes before start, locks them afterwards, and starts on reconnect", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dglz-phase3-presence-"));
    paths.push(directory);
    const dbPath = join(directory, "server.sqlite");
    const database = openDatabase(dbPath);
    for (const username of ["alice", "bob", "carol", "dave"]) {
      await provisionAccount(database, { username, password: "secret" });
    }
    database.close();
    const app = await createApp({
      dbPath,
      allowedOrigin: "https://game.example",
      secureCookies: false,
    });
    apps.push(app);
    const cookies = await Promise.all(
      ["alice", "bob", "carol", "dave"].map((username) => login(app, username)),
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: {
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        cookie: cookies[0],
      },
      payload: { rulesetId: "dglz-4p-2d-v1", seatingPolicy: "fixed" },
    });
    const roomId = (created.json() as { data: { view: { roomId: string } } })
      .data.view.roomId;
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = portOf(app);
    const connections = await Promise.all([
      openSocket(port, cookies[0]!, roomId),
      openSocket(port, cookies[1]!),
      openSocket(port, cookies[2]!),
      openSocket(port, cookies[3]!),
    ]);
    await connections[0]!.firstView;
    const roomSockets = connections.map(({ socket }) => socket);
    let revision = 1;
    for (const socket of roomSockets.slice(1)) {
      await sendCommand(
        socket,
        command(roomId, revision, { type: "JoinRoom" }),
      );
      revision += 1;
    }
    const rulesConfiguration = rulesConfigurationPreset(
      "dglz-4p-2d-v1",
      "自主",
    );
    const replaceRules = {
      type: "ReplaceMatchRulesConfiguration",
      rulesConfiguration,
    };
    expect(
      await sendCommand(
        roomSockets[1]!,
        command(roomId, revision, replaceRules),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "domain-rejected", reason: "owner-only" },
    });
    expect(
      await sendCommand(
        roomSockets[0]!,
        command(roomId, revision, replaceRules),
      ),
    ).toMatchObject({
      ok: true,
      data: { revision: revision + 1, view: { rulesConfiguration } },
    });
    revision += 1;
    await sendCommand(
      roomSockets[0]!,
      command(roomId, revision, { type: "SelectMatch" }),
    );
    revision += 1;
    for (const [seatIndex, socket] of roomSockets.entries()) {
      await sendCommand(
        socket,
        command(roomId, revision, { type: "AssignSeat", seatIndex }),
      );
      revision += 1;
    }

    await sendCommand(
      roomSockets[3]!,
      command(roomId, revision, { type: "SetReadiness", ready: true }),
    );
    revision += 1;
    await new Promise<void>((resolve) => {
      roomSockets[3]!.once("disconnect", () => resolve());
      roomSockets[3]!.close();
    });
    for (const socket of roomSockets.slice(0, 3)) {
      const result = await sendCommand(
        socket,
        command(roomId, revision, { type: "SetReadiness", ready: true }),
      );
      expect(result).toMatchObject({
        ok: true,
        data: { revision: revision + 1, view: { lifecycle: "LOBBY" } },
      });
      revision += 1;
    }
    expect(revision).toBe(14);

    const reconnected = await Promise.all([
      openSocket(port, cookies[3]!, roomId),
      openSocket(port, cookies[3]!, roomId),
    ]);
    for (const connection of reconnected) {
      const resync = RoomViewSyncEnvelopeSchema.parse(
        await connection.firstView,
      );
      expect(resync.data).toMatchObject({
        revision: 15,
        view: {
          lifecycle: "ACTIVE",
          hand: expect.any(Array),
          matchRulesConfigurationLocked: true,
          rulesConfiguration,
        },
      });
    }

    expect(
      await sendCommand(
        roomSockets[0]!,
        command(roomId, 15, {
          type: "ReplaceMatchRulesConfiguration",
          rulesConfiguration: rulesConfigurationPreset("dglz-4p-2d-v1", "省心"),
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "domain-rejected",
        reason: "room-not-in-lobby",
      },
    });
    const persisted = openDatabase(dbPath);
    const rows = persisted.sqlite
      .prepare(
        "SELECT event_type AS eventType, causation_command_id AS causationCommandId FROM room_events WHERE room_id = ? ORDER BY sequence",
      )
      .all(roomId) as Array<{
      eventType: string;
      causationCommandId: string | null;
    }>;
    persisted.close();
    expect(rows.at(-1)).toEqual({
      eventType: "MatchStarted",
      causationCommandId: null,
    });
    expect(
      rows.filter(({ eventType }) => eventType === "MatchStarted"),
    ).toHaveLength(1);
  });
});

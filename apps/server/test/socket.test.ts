import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOCKET_ROOM_COMMAND_EVENT,
  SOCKET_ROOM_VIEW_EVENT,
  SOCKET_ROOM_LEFT_EVENT,
  RoomLeftEnvelopeSchema,
  type RoomCommandPayload,
  type RoomCommandAck,
  type RoomViewSyncEnvelope,
} from "@dglz/protocol";

import { createApp } from "../src/app.js";
import {
  provisionAccount,
  resetPassword,
  revokeAllSessions,
} from "../src/auth.js";
import { openDatabase } from "../src/db/index.js";
import { loadRoom, readRoomEvents } from "../src/rooms.js";
import { RoomExecutor } from "../src/room-executor.js";
import { derivePlayerView } from "@dglz/game-core";

const paths: string[] = [];
const sockets: Socket[] = [];
const apps: Awaited<ReturnType<typeof createApp>>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of sockets.splice(0)) {
    socket.close();
  }
  for (const app of apps.splice(0)) {
    await app.close();
  }
  for (const path of paths.splice(0)) {
    await rm(path, { recursive: true, force: true, maxRetries: 3 });
  }
});

async function setup(): Promise<{
  app: Awaited<ReturnType<typeof createApp>>;
  dbPath: string;
  roomId: string;
  ownerCookie: string;
  memberCookie: string;
  thirdCookie: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "dglz-phase2-"));
  paths.push(directory);
  const dbPath = join(directory, "server.sqlite");
  const database = openDatabase(dbPath);
  await provisionAccount(database, { username: "alice", password: "secret" });
  await provisionAccount(database, { username: "bob", password: "secret" });
  await provisionAccount(database, { username: "carol", password: "secret" });
  database.close();
  const app = await createApp({
    dbPath,
    allowedOrigin: "https://game.example",
    secureCookies: false,
  });
  apps.push(app);
  const login = async (username: string): Promise<string> => {
    const response = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION) },
      payload: { username, password: "secret" },
    });
    const cookie = response.headers["set-cookie"];
    if (typeof cookie !== "string") {
      throw new Error("missing-cookie");
    }
    return cookie.split(";", 1)[0] ?? "";
  };
  const ownerCookie = await login("alice");
  const memberCookie = await login("bob");
  const thirdCookie = await login("carol");
  const created = await app.inject({
    method: "POST",
    url: "/api/rooms",
    headers: {
      [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
      cookie: ownerCookie,
    },
    payload: { rulesetId: "dglz-4p-2d-v1", seatingPolicy: "fixed" },
  });
  const roomId = (created.json() as { data: { view: { roomId: string } } }).data
    .view.roomId;
  return {
    app,
    dbPath,
    roomId,
    ownerCookie,
    memberCookie,
    thirdCookie,
  };
}

function listenPort(app: Awaited<ReturnType<typeof createApp>>): number {
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("server-not-listening");
  }
  return address.port;
}

async function openSocket(
  port: number,
  cookie: string,
  roomId?: string,
): Promise<{ socket: Socket; firstView: Promise<RoomViewSyncEnvelope> }> {
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
  const firstView = new Promise<RoomViewSyncEnvelope>((resolve) => {
    socket.once(SOCKET_ROOM_VIEW_EVENT, resolve);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  return { socket, firstView };
}

function databaseCounts(dbPath: string): {
  acceptedCommands: number;
  roomEvents: number;
} {
  const database = openDatabase(dbPath);
  const acceptedCommands = (
    database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM accepted_commands")
      .get() as { count: number }
  ).count;
  const roomEvents = (
    database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM room_events")
      .get() as {
      count: number;
    }
  ).count;
  database.close();
  return { acceptedCommands, roomEvents };
}

async function connectError(
  port: number,
  options: Readonly<{
    cookie?: string;
    origin?: string;
    protocolVersion?: unknown;
    roomId?: unknown;
  }>,
): Promise<Error & { data?: { code?: string } }> {
  const socket = connect(`http://127.0.0.1:${port}`, {
    auth: {
      protocolVersion: Object.hasOwn(options, "protocolVersion")
        ? options.protocolVersion
        : PROTOCOL_VERSION,
      ...(Object.hasOwn(options, "roomId") ? { roomId: options.roomId } : {}),
    },
    extraHeaders: {
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      origin: options.origin ?? "https://game.example",
    },
    transports: ["websocket"],
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => reject(new Error("unexpected-connect")));
    socket.once("connect_error", resolve);
  });
}

function nextView(socket: Socket): Promise<RoomViewSyncEnvelope> {
  return new Promise((resolve) => {
    socket.once(SOCKET_ROOM_VIEW_EVENT, resolve);
  });
}

function sendCommand(
  socket: Socket,
  command: unknown,
): Promise<RoomCommandAck> {
  return new Promise((resolve) => {
    socket.emit(SOCKET_ROOM_COMMAND_EVENT, command, resolve);
  });
}

describe("phase 2 Socket.IO room slice", () => {
  it("persists lobby controls, departure receipts and last-member archival across restart", async () => {
    const { app, dbPath, roomId, ownerCookie, memberCookie } = await setup();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const ownerConnection = await openSocket(
      listenPort(app),
      ownerCookie,
      roomId,
    );
    const owner = ownerConnection.socket;
    const initial = (await ownerConnection.firstView).data;
    const ownerId = initial.view.ownerId;
    let revision = initial.revision;
    const member = (await openSocket(listenPort(app), memberCookie)).socket;
    const command = (payload: RoomCommandPayload) => ({
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      roomId,
      expectedRevision: revision,
      payload,
    });
    const send = async (socket: Socket, payload: RoomCommandPayload) => {
      const ack = await sendCommand(socket, command(payload));
      if (ack.ok) revision = ack.data.revision;
      return ack;
    };
    expect((await send(member, { type: "JoinRoom" })).ok).toBe(true);
    expect(
      await send(member, {
        type: "ReplaceSeatingPolicy",
        seatingPolicy: "randomized",
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "owner-only" },
    });
    await send(owner, { type: "AssignSeat", seatIndex: 0 });
    await send(owner, { type: "SetReadiness", ready: true });
    const policy = await send(owner, {
      type: "ReplaceSeatingPolicy",
      seatingPolicy: "randomized",
    });
    expect(policy).toMatchObject({
      ok: true,
      data: {
        view: {
          seatingPolicy: "randomized",
          members: [{ playerId: ownerId, ready: true }, { ready: false }],
        },
      },
    });
    const otherTab = await openSocket(listenPort(app), ownerCookie, roomId);
    await otherTab.firstView;
    const departed = new Promise<unknown>((resolve) =>
      otherTab.socket.once(SOCKET_ROOM_LEFT_EVENT, resolve),
    );
    const ownerChanged = new Promise<RoomViewSyncEnvelope>((resolve) => {
      const changed = (value: RoomViewSyncEnvelope) => {
        if (value.data.view.ownerId === ownerId) return;
        member.off(SOCKET_ROOM_VIEW_EVENT, changed);
        resolve(value);
      };
      member.on(SOCKET_ROOM_VIEW_EVENT, changed);
    });
    const exit = command({ type: "LeaveRoom" });
    // A failed transaction must keep the member and the owner in the lobby.
    const database = openDatabase(dbPath);
    try {
      database.sqlite.exec(
        "CREATE TRIGGER fail_departure BEFORE INSERT ON room_events WHEN NEW.event_type = 'MemberLeft' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
      );
      expect(await sendCommand(owner, exit)).toMatchObject({
        ok: false,
        error: { code: "internal-error" },
      });
      expect(
        derivePlayerView(loadRoom(database, roomId)!.state, ownerId).ownerId,
      ).toBe(ownerId);
      database.sqlite.exec("DROP TRIGGER fail_departure");
    } finally {
      database.close();
    }
    const receipt = await sendCommand(owner, exit);
    expect(receipt).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      commandId: exit.commandId,
      data: { roomId, revision: revision + 2, left: true },
    });
    revision += 2;
    expect(RoomLeftEnvelopeSchema.parse(await departed).data).toEqual({
      roomId,
      revision,
      left: true,
    });
    const changed = (await ownerChanged).data;
    expect(changed.view.members).toHaveLength(1);
    expect(changed.view.ownerId).toBe(changed.view.members[0]!.playerId);
    expect(
      changed.view.seats.every((seat) => seat.playerId === undefined),
    ).toBe(true);
    expect(await sendCommand(owner, exit)).toEqual(receipt);
    expect(
      await send(owner, {
        type: "ReplaceSeatingPolicy",
        seatingPolicy: "fixed",
      }),
    ).toMatchObject({ ok: false, error: { reason: "not-a-member" } });
    expect(
      (
        await app.inject({
          url: `/api/rooms/${roomId}`,
          headers: {
            cookie: ownerCookie,
            [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
          },
        })
      ).statusCode,
    ).toBe(403);
    const closure = command({ type: "LeaveRoom" });
    const closed = await sendCommand(member, closure);
    expect(closed).toMatchObject({
      ok: true,
      data: { roomId, revision: revision + 2, left: true },
    });
    revision += 2;
    for (const socket of [owner, member, otherTab.socket]) socket.close();
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const restarted = await createApp({
      dbPath,
      allowedOrigin: "https://game.example",
      secureCookies: false,
    });
    apps.push(restarted);
    await restarted.listen({ host: "127.0.0.1", port: 0 });
    const retry = (await openSocket(listenPort(restarted), memberCookie))
      .socket;
    expect(await sendCommand(retry, closure)).toEqual(closed);
    expect(
      await sendCommand(retry, command({ type: "JoinRoom" })),
    ).toMatchObject({ ok: false, error: { reason: "room-not-in-lobby" } });
    const recovered = openDatabase(dbPath);
    try {
      expect(
        derivePlayerView(loadRoom(recovered, roomId)!.state, ownerId),
      ).toMatchObject({
        lifecycle: "ARCHIVED",
        members: [],
        seatingPolicy: "randomized",
      });
      expect(
        [...readRoomEvents(recovered, roomId)].filter(
          (row) => row.event.type === "RoomArchived",
        ),
      ).toHaveLength(1);
    } finally {
      recovered.close();
    }
  });

  it("syncs a room, joins through the executor, and deduplicates accepted commands", async () => {
    const { app, dbPath, roomId, ownerCookie, memberCookie } = await setup();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const ownerConnection = await openSocket(
      listenPort(app),
      ownerCookie,
      roomId,
    );
    const owner = ownerConnection.socket;
    const ownerView = await ownerConnection.firstView;
    expect(ownerView.data.revision).toBe(1);
    const member = (await openSocket(listenPort(app), memberCookie)).socket;
    const command = {
      protocolVersion: PROTOCOL_VERSION,
      commandId: "f1dc4f7f-7f63-44d0-b7ca-8ac9b9b8df02",
      roomId,
      expectedRevision: 1,
      payload: { type: "JoinRoom" },
    } as const;
    const ownerUpdate = nextView(owner);
    const memberUpdate = nextView(member);
    const acknowledgement = await sendCommand(member, command);
    expect(acknowledgement).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      commandId: command.commandId,
      data: { revision: 2 },
    });
    if (!acknowledgement.ok) throw new Error("join-not-accepted");
    if ("left" in acknowledgement.data) throw new Error("unexpected-departure");
    const [updatedOwner, updatedMember] = await Promise.all([
      ownerUpdate,
      memberUpdate,
    ]);
    expect(updatedOwner.data.revision).toBe(2);
    expect(updatedOwner.data.view.members).toHaveLength(2);
    expect(updatedMember.data).toEqual(acknowledgement.data);
    expect(updatedMember.data.view.members[1]?.playerId).toBe(
      acknowledgement.data.view.members[1]?.playerId,
    );
    expect(databaseCounts(dbPath)).toEqual({
      acceptedCommands: 1,
      roomEvents: 2,
    });
    expect(await sendCommand(member, command)).toEqual(acknowledgement);
    expect(await sendCommand(owner, command)).toMatchObject({
      ok: false,
      error: { code: "command-id-reused" },
    });

    const stale = await sendCommand(member, {
      ...command,
      commandId: "b2d89cd1-4889-43b2-a0b5-6d404c97a500",
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "stale-revision", currentRevision: 2 },
    });
    const reused = await sendCommand(member, {
      ...command,
      payload: { type: "JoinRoom" },
      expectedRevision: 2,
    });
    expect(reused).toMatchObject({
      ok: false,
      error: { code: "command-id-reused" },
    });
    expect(databaseCounts(dbPath)).toEqual({
      acceptedCommands: 1,
      roomEvents: 2,
    });

    owner.close();
    member.close();
    apps.splice(apps.indexOf(app), 1);
    await app.close();
    const reopened = await createApp({
      dbPath,
      allowedOrigin: "https://game.example",
      secureCookies: false,
    });
    apps.push(reopened);
    await reopened.listen({ host: "127.0.0.1", port: 0 });
    const resynced = await openSocket(
      listenPort(reopened),
      memberCookie,
      roomId,
    );
    expect((await resynced.firstView).data).toEqual(acknowledgement.data);
    expect(await sendCommand(resynced.socket, command)).toEqual(
      acknowledgement,
    );
    expect(databaseCounts(dbPath)).toEqual({
      acceptedCommands: 1,
      roomEvents: 2,
    });
  });

  it("serializes concurrent commands into contiguous revisions", async () => {
    const { app, dbPath, roomId, memberCookie, thirdCookie } = await setup();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = listenPort(app);
    const first = (await openSocket(port, memberCookie)).socket;
    const second = (await openSocket(port, thirdCookie)).socket;
    const commands = [
      {
        protocolVersion: PROTOCOL_VERSION,
        commandId: "02386dce-5c29-42ae-bc4b-38de7d96735e",
        roomId,
        expectedRevision: 1,
        payload: { type: "JoinRoom" },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        commandId: "d37ca05d-a20d-4ccf-943b-50cadb64e5f7",
        roomId,
        expectedRevision: 1,
        payload: { type: "JoinRoom" },
      },
    ] as const;
    const results = await Promise.all([
      sendCommand(first, commands[0]),
      sendCommand(second, commands[1]),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toMatchObject([
      { error: { code: "stale-revision", currentRevision: 2 } },
    ]);

    const rejectedIndex = results.findIndex((result) => !result.ok);
    const retried = await sendCommand(rejectedIndex === 0 ? first : second, {
      ...commands[rejectedIndex]!,
      expectedRevision: 2,
    });
    expect(retried).toMatchObject({ ok: true, data: { revision: 3 } });
    expect(databaseCounts(dbPath)).toEqual({
      acceptedCommands: 2,
      roomEvents: 3,
    });

    const database = openDatabase(dbPath);
    const sequences = database.sqlite
      .prepare(
        "SELECT sequence FROM room_events WHERE room_id = ? ORDER BY sequence",
      )
      .all(roomId) as Array<{ sequence: number }>;
    database.close();
    expect(sequences.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
  });

  it("rolls back the command record when event append fails", async () => {
    const { app, dbPath, roomId, memberCookie } = await setup();
    const database = openDatabase(dbPath);
    database.sqlite.exec(`
      CREATE TRIGGER fail_member_join
      BEFORE INSERT ON room_events
      WHEN NEW.sequence > 1
      BEGIN
        SELECT RAISE(ABORT, 'forced-event-failure');
      END
    `);
    database.close();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const member = (await openSocket(listenPort(app), memberCookie)).socket;
    const command = {
      protocolVersion: PROTOCOL_VERSION,
      commandId: "31571e57-bf77-4420-970e-dfe37488e554",
      roomId,
      expectedRevision: 1,
      payload: { type: "JoinRoom" },
    } as const;
    expect(await sendCommand(member, command)).toMatchObject({
      ok: false,
      error: { code: "internal-error" },
    });
    expect(databaseCounts(dbPath)).toEqual({
      acceptedCommands: 0,
      roomEvents: 1,
    });

    const repaired = openDatabase(dbPath);
    repaired.sqlite.exec("DROP TRIGGER fail_member_join");
    repaired.close();
    expect(await sendCommand(member, command)).toMatchObject({
      ok: true,
      data: { revision: 2 },
    });
  });

  it("rejects a stored acknowledgement for a different command ID", async () => {
    const { app, dbPath, roomId, memberCookie } = await setup();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const member = (await openSocket(listenPort(app), memberCookie)).socket;
    const command = {
      protocolVersion: PROTOCOL_VERSION,
      commandId: "f680b560-52b5-4a31-b0bc-3fdc94f19c13",
      roomId,
      expectedRevision: 1,
      payload: { type: "JoinRoom" },
    } as const;
    expect(await sendCommand(member, command)).toMatchObject({ ok: true });

    const database = openDatabase(dbPath);
    const stored = database.sqlite
      .prepare(
        "SELECT acknowledgement FROM accepted_commands WHERE command_id = ?",
      )
      .get(command.commandId) as { acknowledgement: string };
    const acknowledgement = JSON.parse(stored.acknowledgement) as {
      commandId: string;
    };
    acknowledgement.commandId = "c27d8182-aa8a-4bef-89b2-35489c059627";
    database.sqlite
      .prepare(
        "UPDATE accepted_commands SET acknowledgement = ? WHERE command_id = ?",
      )
      .run(JSON.stringify(acknowledgement), command.commandId);
    database.close();

    expect(await sendCommand(member, command)).toMatchObject({
      ok: false,
      error: { code: "internal-error" },
    });
    expect(databaseCounts(dbPath)).toEqual({
      acceptedCommands: 1,
      roomEvents: 2,
    });
  });

  it("accepts a valid command without an acknowledgement callback", async () => {
    const { app, roomId, memberCookie } = await setup();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const member = (await openSocket(listenPort(app), memberCookie)).socket;
    const view = nextView(member);
    member.emit(SOCKET_ROOM_COMMAND_EVENT, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: "94dcd7fb-cea7-4efd-9a6b-4e45206e0f34",
      roomId,
      expectedRevision: 1,
      payload: { type: "JoinRoom" },
    });
    expect((await view).data.revision).toBe(2);
    expect(
      await sendCommand(member, {
        protocolVersion: PROTOCOL_VERSION,
        commandId: "445c3106-bf16-46b9-994f-2d450d35f096",
        roomId,
        expectedRevision: 1,
        payload: { type: "JoinRoom" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "stale-revision", currentRevision: 2 },
    });
  });

  it("closes with an active socket", async () => {
    const { app, ownerCookie } = await setup();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const owner = (await openSocket(listenPort(app), ownerCookie)).socket;
    apps.splice(apps.indexOf(app), 1);
    const closed = app.close().then(() => true);
    const timedOut = new Promise<false>((resolve) => {
      setTimeout(() => resolve(false), 1_000);
    });
    expect(await Promise.race([closed, timedOut])).toBe(true);
    expect(owner.disconnected).toBe(true);
  });

  it("rejects invalid socket boundaries without mutating the room", async () => {
    const { app, dbPath, roomId, ownerCookie, memberCookie } = await setup();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = listenPort(app);

    expect((await connectError(port, {})).message).toBe("unauthorized");
    expect(
      (await connectError(port, { cookie: memberCookie, protocolVersion: 999 }))
        .message,
    ).toBe("reload-required");
    expect(
      (
        await connectError(port, {
          cookie: memberCookie,
          protocolVersion: undefined,
        })
      ).message,
    ).toBe("reload-required");
    expect(
      (await connectError(port, { cookie: memberCookie, roomId: [roomId] }))
        .message,
    ).toBe("malformed-input");
    expect(
      (
        await connectError(port, {
          cookie: memberCookie,
          roomId: "not-a-room-id",
        })
      ).message,
    ).toBe("malformed-input");
    expect(
      (
        await connectError(port, {
          cookie: memberCookie,
          roomId: "9c9d9e40-586d-4c6c-80f9-9f1c764cb568",
        })
      ).message,
    ).toBe("room-not-found");
    expect(
      (await connectError(port, { cookie: memberCookie, roomId })).message,
    ).toBe("forbidden");
    await expect(
      connectError(port, {
        cookie: ownerCookie,
        origin: "https://attacker.example",
      }),
    ).resolves.toBeInstanceOf(Error);

    const member = (await openSocket(port, memberCookie)).socket;
    member.emit(SOCKET_ROOM_COMMAND_EVENT, { malformed: true });
    expect(await sendCommand(member, { malformed: true })).toMatchObject({
      ok: false,
      error: { code: "malformed-input" },
    });
    expect(
      await sendCommand(member, {
        protocolVersion: 999,
        commandId: "1fe67988-7ab7-449b-9331-0edc6e8d45ea",
        roomId,
        expectedRevision: 1,
        payload: { type: "JoinRoom" },
      }),
    ).toMatchObject({ ok: false, error: { code: "reload-required" } });
    expect(databaseCounts(dbPath)).toEqual({
      acceptedCommands: 0,
      roomEvents: 1,
    });
  });

  it("withholds an acknowledgement view if its session is revoked after commit", async () => {
    const { app, dbPath, roomId, memberCookie } = await setup();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const member = (await openSocket(listenPort(app), memberCookie)).socket;
    // oxlint-disable-next-line typescript/unbound-method -- Invoked with the original receiver below.
    const execute = RoomExecutor.prototype.execute;
    const executeSpy = vi.spyOn(RoomExecutor.prototype, "execute");
    executeSpy.mockImplementationOnce(async function (
      this: RoomExecutor,
      ...args
    ) {
      const result = await execute.apply(this, args);
      const administrator = openDatabase(dbPath);
      try {
        revokeAllSessions(administrator, "bob");
      } finally {
        administrator.close();
      }
      return result;
    });
    const result = await sendCommand(member, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      roomId,
      expectedRevision: 1,
      payload: { type: "JoinRoom" },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    expect(result).not.toHaveProperty("data");
    expect(databaseCounts(dbPath)).toEqual({
      acceptedCommands: 1,
      roomEvents: 2,
    });
  });

  it.each(["room", "challenge"])(
    "rechecks a queued HTTP %s operation",
    async (operation) => {
      const { app, dbPath, roomId, ownerCookie } = await setup();
      const revoke = () => {
        const administrator = openDatabase(dbPath);
        try {
          revokeAllSessions(administrator, "alice");
        } finally {
          administrator.close();
        }
      };
      if (operation === "room") {
        // oxlint-disable-next-line typescript/unbound-method -- Invoked with the original receiver below.
        const resume = RoomExecutor.prototype.resumeSettledHand;
        const resumeSpy = vi.spyOn(RoomExecutor.prototype, "resumeSettledHand");
        resumeSpy.mockImplementationOnce(function (
          this: RoomExecutor,
          ...args
        ) {
          const result = resume.apply(this, args);
          revoke();
          return result;
        });
      } else {
        // oxlint-disable-next-line typescript/unbound-method -- Invoked with the original receiver below.
        const create = RoomExecutor.prototype.createChallengeCode;
        const createSpy = vi.spyOn(
          RoomExecutor.prototype,
          "createChallengeCode",
        );
        createSpy.mockImplementationOnce(function (
          this: RoomExecutor,
          ...args
        ) {
          const result = create.apply(this, args);
          revoke();
          return result;
        });
      }
      const response = await app.inject({
        method: operation === "room" ? "GET" : "POST",
        url: `/api/rooms/${roomId}${operation === "room" ? "" : "/challenges"}`,
        headers: {
          [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
          cookie: ownerCookie,
        },
        ...(operation === "room" ? {} : { payload: { handStartSequence: 1 } }),
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        ok: false,
        error: { code: "unauthorized" },
      });
      expect(databaseCounts(dbPath)).toEqual({
        acceptedCommands: 0,
        roomEvents: 1,
      });
    },
  );

  it.each(["logout", "reset", "revoke"])(
    "revalidates HTTP and connected sockets after %s",
    async (operation) => {
      const { app, dbPath, roomId, memberCookie, thirdCookie } = await setup();
      await app.listen({ host: "127.0.0.1", port: 0 });
      const member = (await openSocket(listenPort(app), memberCookie)).socket;
      const joined = await sendCommand(member, {
        protocolVersion: PROTOCOL_VERSION,
        commandId: "a5aaf355-e585-493c-aed3-bbefce2018ef",
        roomId,
        expectedRevision: 1,
        payload: { type: "JoinRoom" },
      });
      expect(joined).toMatchObject({ ok: true, data: { revision: 2 } });
      const otherTab = await openSocket(listenPort(app), memberCookie, roomId);
      await otherTab.firstView;
      if (operation === "logout") {
        await app.inject({
          method: "POST",
          url: "/api/logout",
          headers: {
            [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
            cookie: memberCookie,
          },
        });
      } else {
        const administrator = openDatabase(dbPath);
        try {
          if (operation === "reset")
            await resetPassword(administrator, "bob", "new-secret");
          else revokeAllSessions(administrator, "bob");
        } finally {
          administrator.close();
        }
      }
      for (const url of [
        "/api/session",
        `/api/rooms/${roomId}`,
        "/api/history",
      ]) {
        expect(
          (
            await app.inject({
              url,
              headers: {
                [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
                cookie: memberCookie,
              },
            })
          ).statusCode,
        ).toBe(401);
      }
      expect(
        (await connectError(listenPort(app), { cookie: memberCookie })).message,
      ).toBe("unauthorized");
      expect(
        await sendCommand(member, {
          protocolVersion: PROTOCOL_VERSION,
          commandId: "87852989-7bdf-43cc-98f3-88a456019a8b",
          roomId,
          expectedRevision: 2,
          payload: { type: "JoinRoom" },
        }),
      ).toMatchObject({ ok: false, error: { code: "unauthorized" } });
      expect(databaseCounts(dbPath)).toEqual({
        acceptedCommands: 1,
        roomEvents: 2,
      });

      let revokedViewReceived = false;
      member.once(SOCKET_ROOM_VIEW_EVENT, () => {
        revokedViewReceived = true;
      });
      const disconnected = new Promise<void>((resolve) => {
        member.once("disconnect", () => resolve());
      });
      otherTab.socket.once(SOCKET_ROOM_VIEW_EVENT, () => {
        revokedViewReceived = true;
      });
      const otherDisconnected = new Promise<void>((resolve) => {
        otherTab.socket.once("disconnect", () => resolve());
      });
      const third = (await openSocket(listenPort(app), thirdCookie)).socket;
      expect(
        await sendCommand(third, {
          protocolVersion: PROTOCOL_VERSION,
          commandId: "ab2b062a-d148-44c6-9c5c-973dea28f6ad",
          roomId,
          expectedRevision: 2,
          payload: { type: "JoinRoom" },
        }),
      ).toMatchObject({ ok: true, data: { revision: 3 } });
      await disconnected;
      await otherDisconnected;
      expect(revokedViewReceived).toBe(false);
      expect(databaseCounts(dbPath)).toEqual({
        acceptedCommands: 2,
        roomEvents: 3,
      });
    },
  );
});

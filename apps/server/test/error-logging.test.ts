import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  rulesConfigurationPreset,
  type RoomCommandPayload,
} from "@dglz/protocol";
import { UnauthorizedSessionError } from "../src/auth.js";
import { ChallengeLookup } from "../src/challenges.js";
import { openDatabase } from "../src/db/index.js";
import { accounts } from "../src/db/schema.js";
import { logUnexpectedError } from "../src/error-logging.js";
import { RoomExecutorRegistry } from "../src/room-executor.js";
import { appendRoomCreated } from "../src/rooms.js";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
});

it("serializes causes and call sites without messages, attached secrets, or arbitrary thrown values", async () => {
  const lines: string[] = [];
  const app = Fastify({
    logger: {
      stream: new Writable({
        write(chunk, _encoding, done) {
          lines.push(String(chunk));
          done();
        },
      }),
    },
  });
  try {
    const secret = "password-token-seed-code-private-hand";
    const cause = Object.assign(new Error(secret), {
      code: "SQLITE_BUSY",
      params: [secret],
    });
    const error = Object.assign(new Error(secret, { cause }), {
      payload: {
        password: secret,
        handSeed: secret,
        code: secret,
        hand: [secret],
      },
    });
    cause.cause = error;
    logUnexpectedError(app.log, error, { operation: "test" });
    logUnexpectedError(app.log, { secret }, { operation: "test" });
    logUnexpectedError(app.log, secret, { operation: "test" });
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 50,
      operation: "test",
      err: {
        type: "Error",
        stack: expect.stringContaining("error-logging.test.ts:"),
        cause: { type: "Error", code: "SQLITE_BUSY" },
      },
    });
    expect(JSON.parse(lines[1]!)).toHaveProperty("err.type", "object");
    expect(JSON.parse(lines[2]!)).toHaveProperty("err.type", "string");
    expect(lines.join("")).not.toContain(secret);
  } finally {
    await app.close();
  }
});

async function readyRoom() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const ids = ["a", "b", "c", "d"];
  database.db
    .insert(accounts)
    .values(
      ids.map((id) => ({
        id,
        username: id,
        passwordHash: "unused",
        createdAt: 1,
      })),
    )
    .run();
  const roomId = randomUUID();
  appendRoomCreated(database, {
    type: "RoomCreated",
    roomId,
    ownerId: ids[0]!,
    rulesConfiguration: rulesConfigurationPreset("dglz-4p-2d-v1", "省心"),
    seatingPolicy: "fixed",
  });
  const error = vi.fn<FastifyBaseLogger["error"]>();
  const room = (await new RoomExecutorRegistry(database, { error }).getOrCreate(
    roomId,
  ))!;
  const envelope = (payload: RoomCommandPayload) => ({
    protocolVersion: PROTOCOL_VERSION,
    commandId: randomUUID(),
    roomId,
    expectedRevision: room.revision,
    payload,
  });
  const send = async (id: string, payload: RoomCommandPayload) => {
    expect((await room.execute(id, envelope(payload))).ok).toBe(true);
  };
  for (const id of ids.slice(1)) await send(id, { type: "JoinRoom" });
  await send(ids[0]!, { type: "SelectMatch" });
  for (const [seatIndex, id] of ids.entries()) {
    await send(id, { type: "AssignSeat", seatIndex });
    await send(id, { type: "SetReadiness", ready: true });
  }
  return { database, room, roomId, ids, envelope, error };
}

it.each(["presence", "commit"])(
  "logs automatic-start %s failure once, keeps state, and can start later",
  async (stage) => {
    const { database, room, roomId, ids, error } = await readyRoom();
    const revision = room.revision;
    await room.autoStart(() => Promise.resolve(new Set(ids.slice(1))));
    expect(error).not.toHaveBeenCalled();
    if (stage === "commit") {
      database.sqlite
        .exec(`CREATE TRIGGER fail_start BEFORE INSERT ON room_events
      WHEN NEW.event_type = 'MatchStarted' BEGIN SELECT RAISE(ABORT, 'private-seed'); END`);
    }
    await expect(
      room.autoStart(() =>
        stage === "presence"
          ? Promise.reject(new Error("private-token"))
          : Promise.resolve(new Set(ids)),
      ),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        operation: "auto-start",
        stage,
        roomId,
        revision,
        err: expect.objectContaining({ stack: expect.any(String) }),
      }),
      "服务器操作失败",
    );
    expect(JSON.stringify(error.mock.calls)).not.toMatch(
      /private-seed|private-token/,
    );
    expect(room.revision).toBe(revision);
    expect(room.viewFor(ids[0]!)?.view.lifecycle).toBe("LOBBY");
    if (stage === "commit") database.sqlite.exec("DROP TRIGGER fail_start");
    await room.autoStart(() => Promise.resolve(new Set(ids)));
    expect(room.revision).toBe(revision + 1);
    expect(room.viewFor(ids[0]!)?.view.lifecycle).toBe("ACTIVE");
    expect(error).toHaveBeenCalledTimes(1);
  },
);

it("logs decision failures, while authorization and normal rejections stay quiet", async () => {
  const { room, ids, envelope, error } = await readyRoom();
  const id = ids[0]!;
  const command = envelope({ type: "SetReadiness", ready: false });
  const deny = () => {
    throw new UnauthorizedSessionError();
  };
  await expect(
    room.execute(id, command, undefined, deny),
  ).rejects.toBeInstanceOf(UnauthorizedSessionError);
  const authorize = vi
    .fn<() => void>()
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(deny);
  expect(await room.execute(id, command, undefined, authorize)).toMatchObject({
    error: { code: "unauthorized" },
  });
  expect(
    await room.execute(id, { ...command, expectedRevision: 0 }),
  ).toMatchObject({ error: { code: "stale-revision" } });
  expect(
    await room.execute(ids[1]!, envelope({ type: "ArchiveRoom" })),
  ).toMatchObject({ error: { code: "domain-rejected" } });
  expect(error).not.toHaveBeenCalled();
  vi.spyOn(ChallengeLookup.prototype, "resolve").mockImplementationOnce(() => {
    throw new Error("secret-code");
  });
  expect(
    await room.execute(
      id,
      envelope({ type: "SelectChallengeHand", code: "secret-code" }),
    ),
  ).toMatchObject({ error: { code: "internal-error" } });
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      operation: "room-command",
      stage: "decision",
      accountId: id,
      commandType: "SelectChallengeHand",
    }),
    "服务器操作失败",
  );
  expect(JSON.stringify(error.mock.calls)).not.toContain("secret-code");
  expect(await room.execute(id, command)).toMatchObject({ ok: true });
  expect(await room.execute(id, command)).toMatchObject({ ok: true });
  expect(error).toHaveBeenCalledTimes(1);
});

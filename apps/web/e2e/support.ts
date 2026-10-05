import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { io, type Socket } from "socket.io-client";
import { passivePolicy } from "@dglz/headless";
import {
  LoginResponseEnvelopeSchema,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  RoomCommandAckSchema,
  RoomCommandPayloadSchema,
  RoomResponseEnvelopeSchema,
  RoomViewSyncEnvelopeSchema,
  SOCKET_ROOM_COMMAND_EVENT,
  SOCKET_ROOM_VIEW_EVENT,
  type RoomCommandAck,
  type RoomCommandPayload,
  type RoomViewData,
} from "@dglz/protocol";
import { createApp } from "../../server/dist/app.js";
import { provisionAccount } from "../../server/dist/auth.js";
import { openDatabase } from "../../server/dist/db/index.js";

export const PASSWORD = "correct horse battery staple";
const ACCOUNTS = [
  "alice",
  "bob",
  "charlie",
  "diana",
  "eve",
  "frank",
  "grace",
] as const;

export type Account = { accountId: string; username: string; password: string };
type App = Awaited<ReturnType<typeof createApp>>;

export type TestServer = {
  app: App;
  url: string;
  accounts: Account[];
  restart: (whileStopped?: () => Promise<void>) => Promise<void>;
  interruptRoom: (roomId: string) => Promise<void>;
};

async function reservePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
  });
  const address = reservation.address();
  if (address === null || typeof address === "string") {
    throw new Error("missing-test-port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) =>
      error === undefined ? resolve() : reject(error),
    );
  });
  return port;
}

export async function startServer(): Promise<
  TestServer & { close: () => Promise<void> }
> {
  const directory = await mkdtemp(join(tmpdir(), "dglz-web-e2e-"));
  const dbPath = join(directory, "server.sqlite");
  const database = openDatabase(dbPath);
  const accounts: Account[] = [];
  try {
    for (const username of ACCOUNTS) {
      const account = await provisionAccount(database, {
        username,
        password: PASSWORD,
      });
      accounts.push({ ...account, password: PASSWORD });
    }
  } finally {
    database.close();
  }

  const port = await reservePort();
  const options = {
    allowedOrigin: `http://127.0.0.1:${port}`,
    dbPath,
    secureCookies: false,
    webRoot: fileURLToPath(new URL("../dist/", import.meta.url)),
  };
  let app = await createApp(options);
  await app.listen({ host: "127.0.0.1", port });
  const url = `http://127.0.0.1:${port}`;
  async function stop() {
    // Simulated shutdown drops browser preconnects; app.close still cleans up sockets and SQLite.
    app.server.close();
    app.server.closeAllConnections();
    await app.close();
  }
  async function restart(whileStopped?: () => Promise<void>) {
    await stop();
    await whileStopped?.();
    app = await createApp(options);
    await app.listen({ host: "127.0.0.1", port });
  }
  return {
    get app() {
      return app;
    },
    url,
    accounts,
    restart,
    async interruptRoom(roomId: string) {
      const damaged = openDatabase(dbPath);
      try {
        damaged.sqlite
          .prepare(
            "UPDATE room_events SET event_schema_version = 999 WHERE room_id = ? AND sequence = (SELECT MAX(sequence) FROM room_events WHERE room_id = ?)",
          )
          .run(roomId, roomId);
      } finally {
        damaged.close();
      }
      await restart();
    },
    close: async () => {
      await stop();
      await rm(directory, {
        force: true,
        maxRetries: 3,
        recursive: true,
        retryDelay: 100,
      });
    },
  };
}

export function protocolHeaders(): Record<string, string> {
  return { [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION) };
}

export async function loginProtocol(
  url: string,
  account: Account,
): Promise<{ accountId: string; cookie: string }> {
  const response = await fetch(`${url}/api/login`, {
    body: JSON.stringify({
      username: account.username,
      password: account.password,
    }),
    headers: { ...protocolHeaders(), "content-type": "application/json" },
    method: "POST",
  });
  assert(response.ok, `HTTP ${response.status}`);
  const envelope = LoginResponseEnvelopeSchema.parse(await response.json());
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookie = headers.getSetCookie?.()[0] ?? headers.get("set-cookie");
  const cookie = setCookie?.split(";", 1)[0];
  if (cookie === undefined) throw new Error("missing-session-cookie");
  return { accountId: envelope.data.accountId, cookie };
}

export async function readRoom(
  url: string,
  roomId: string,
  cookie: string,
): Promise<RoomViewData> {
  const response = await fetch(`${url}/api/rooms/${roomId}`, {
    headers: { ...protocolHeaders(), cookie },
  });
  assert(response.ok, `HTTP ${response.status}`);
  return RoomResponseEnvelopeSchema.parse(await response.json()).data;
}

export class ProtocolClient {
  public staleJoinRetries = 0;
  private readonly socket: Socket;
  private latest: RoomViewData | undefined;

  public constructor(
    private readonly url: string,
    private readonly cookie: string,
    roomId?: string,
  ) {
    this.socket = io(url, {
      autoConnect: false,
      auth: {
        protocolVersion: PROTOCOL_VERSION,
        ...(roomId === undefined ? {} : { roomId }),
      },
      extraHeaders: { cookie },
      transports: ["websocket"],
    });
    this.socket.on(SOCKET_ROOM_VIEW_EVENT, (raw: unknown) => {
      const parsed = RoomViewSyncEnvelopeSchema.safeParse(raw);
      if (
        parsed.success &&
        (this.latest === undefined ||
          parsed.data.data.revision >= this.latest.revision)
      ) {
        this.latest = parsed.data.data;
      }
    });
  }

  public async connect(): Promise<void> {
    if (this.socket.connected) return;
    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        this.socket.off("connect_error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        this.socket.off("connect", onConnect);
        reject(error);
      };
      this.socket.once("connect", onConnect);
      this.socket.once("connect_error", onError);
      this.socket.connect();
    });
  }

  private emit(
    roomId: string,
    expectedRevision: number,
    payload: RoomCommandPayload,
  ): Promise<RoomCommandAck> {
    return new Promise((resolve, reject) => {
      this.socket.timeout(5_000).emit(
        SOCKET_ROOM_COMMAND_EVENT,
        {
          protocolVersion: PROTOCOL_VERSION,
          commandId: crypto.randomUUID(),
          expectedRevision,
          payload,
          roomId,
        },
        (error: Error | null, raw: unknown) => {
          if (error !== null) {
            reject(error);
            return;
          }
          const parsed = RoomCommandAckSchema.safeParse(raw);
          if (!parsed.success) {
            reject(new Error("invalid-command-ack"));
            return;
          }
          resolve(parsed.data);
        },
      );
    });
  }

  public async join(roomId: string): Promise<RoomViewData> {
    let expectedRevision = 1;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await this.emit(roomId, expectedRevision, {
        type: "JoinRoom",
      });
      if (result.ok) {
        if ("left" in result.data) throw new Error("unexpected-departure");
        this.latest = result.data;
        this.socket.auth = { protocolVersion: PROTOCOL_VERSION, roomId };
        return result.data;
      }
      if (
        result.error.code === "stale-revision" &&
        result.error.currentRevision !== undefined
      ) {
        this.staleJoinRetries += 1;
        expectedRevision = result.error.currentRevision;
        continue;
      }
      throw new Error(`join-failed:${result.error.code}`);
    }
    throw new Error("join-retry-limit");
  }

  public async command(
    url: string,
    roomId: string,
    payload: RoomCommandPayload,
  ): Promise<RoomViewData> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current =
        this.latest?.view.roomId === roomId
          ? this.latest
          : await readRoom(url, roomId, this.cookie);
      const result = await this.emit(roomId, current.revision, payload);
      if (result.ok) {
        if ("left" in result.data) throw new Error("unexpected-departure");
        this.latest = result.data;
        return result.data;
      }
      if (result.error.code === "stale-revision") {
        this.latest = undefined;
        continue;
      }
      throw new Error(`command-failed:${result.error.code}`);
    }
    throw new Error("command-retry-limit");
  }

  public snapshot(roomId: string): RoomViewData | undefined {
    return this.latest?.view.roomId === roomId ? this.latest : undefined;
  }

  public synchronizedView(
    roomId: string,
    revision: number,
  ): Promise<RoomViewData> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off(SOCKET_ROOM_VIEW_EVENT, check);
      };
      const check = () => {
        const current = this.snapshot(roomId);
        if (current !== undefined && current.revision >= revision) {
          cleanup();
          resolve(current);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("player-view-sync-timeout"));
      }, 5_000);
      this.socket.on(SOCKET_ROOM_VIEW_EVENT, check);
      check();
    });
  }

  public close(): void {
    this.socket.close();
  }
}

export function automaticCommand(
  own: RoomViewData["view"],
  accountId: string,
): RoomCommandPayload | undefined {
  const action = passivePolicy(own, accountId);
  return action === undefined
    ? undefined
    : RoomCommandPayloadSchema.parse(action);
}

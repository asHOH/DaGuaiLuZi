import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROTOCOL_VERSION,
  SOCKET_ROOM_COMMAND_EVENT,
  SOCKET_ROOM_VIEW_EVENT,
  type RoomCommandEnvelope,
  type RoomViewData,
} from "@dglz/protocol";

import { createRoomConnection, type RoomState } from "../src/room-connection";

const socketModule = vi.hoisted(() => ({ io: vi.fn<() => unknown>() }));
vi.mock("socket.io-client", () => socketModule);

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "account-alice";

type Handler = (...args: unknown[]) => void;
type CommandAcknowledgement = (error: Error | null, value?: unknown) => void;

type SocketLike = {
  auth?: unknown;
  connected: boolean;
  on: (event: string, handler: Handler) => SocketLike;
  timeout: (milliseconds: number) => {
    emit: (
      event: string,
      payload: RoomCommandEnvelope,
      acknowledge: CommandAcknowledgement,
    ) => void;
  };
  connect: () => void;
  close: () => void;
  removeAllListeners: () => void;
};

type CommandAttempt = {
  payload: RoomCommandEnvelope;
  acknowledge: CommandAcknowledgement;
};

type SocketHarness = {
  socket: SocketLike;
  commands: CommandAttempt[];
  emit: (event: string, ...args: unknown[]) => void;
  disconnect: (reason: string) => void;
};

const fetchMock = vi.hoisted(() => vi.fn<() => Promise<Response>>());
const connections: Array<ReturnType<typeof createRoomConnection>> = [];

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function roomView(revision: number): RoomViewData {
  return {
    revision,
    view: {
      roomId: ROOM_ID,
      ownerId: ACCOUNT_ID,
      members: [{ playerId: ACCOUNT_ID, joinOrder: 0, ready: false }],
      seats: [
        { seatIndex: 0, playerId: ACCOUNT_ID },
        { seatIndex: 1 },
        { seatIndex: 2 },
        { seatIndex: 3 },
      ],
      rulesConfiguration: {
        rulesetId: "dglz-4p-2d-v1",
        wildcardRank: "strongest-rank",
        finishingWildcardInterpretation: "weakest-form-and-rank",
        flushTieBreaking: "descending-ranks",
        nextHandLeader: "first-finisher",
        tributeCardSelection: "fair-random",
        tributeRecipientPairing: "adjacent-first-automatic",
        matchEnding: "no-failure-limit-at-5",
      },
      seatingPolicy: "fixed",
      matchRulesConfigurationLocked: false,
      seatingPolicyLocked: false,
      lifecycle: "LOBBY",
      selectedActivity: "match",
    },
  };
}

function successEnvelope(data: RoomViewData): unknown {
  return { protocolVersion: PROTOCOL_VERSION, ok: true, data };
}

function viewEvent(data: RoomViewData): unknown {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: SOCKET_ROOM_VIEW_EVENT,
    data,
  };
}

function accepted(attempt: CommandAttempt, data: RoomViewData): unknown {
  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    commandId: attempt.payload.commandId,
    data,
  };
}

function rejected(
  attempt: CommandAttempt,
  code:
    "stale-revision" | "unauthorized" | "reload-required" | "internal-error",
  currentRevision?: number,
): unknown {
  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    commandId: attempt.payload.commandId,
    error: {
      code,
      ...(currentRevision === undefined ? {} : { currentRevision }),
    },
  };
}

function apiError(code: "forbidden" | "unauthorized" | "reload-required") {
  const status =
    code === "forbidden" ? 403 : code === "unauthorized" ? 401 : 409;
  return response(
    { protocolVersion: PROTOCOL_VERSION, ok: false, error: { code } },
    status,
  );
}

function makeSocketHarness(): SocketHarness {
  const handlers = new Map<string, Handler[]>();
  const commands: CommandAttempt[] = [];
  let socket: SocketLike;
  const emit = (event: string, ...args: unknown[]) => {
    for (const handler of [...(handlers.get(event) ?? [])]) {
      handler(...args);
    }
  };
  socket = {
    auth: undefined,
    connected: false,
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return socket;
    },
    timeout() {
      return {
        emit(event, payload, acknowledge) {
          if (event === SOCKET_ROOM_COMMAND_EVENT) {
            commands.push({ payload, acknowledge });
          }
        },
      };
    },
    connect: vi.fn<() => void>(() => {
      socket.connected = true;
      emit("connect");
    }),
    close: vi.fn<() => void>(() => {
      socket.connected = false;
    }),
    removeAllListeners: vi.fn<() => void>(() => {
      handlers.clear();
    }),
  };
  return {
    socket,
    commands,
    emit,
    disconnect(reason) {
      socket.connected = false;
      emit("disconnect", reason);
    },
  };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function latest(updates: RoomState[]): RoomState {
  const state = updates.at(-1);
  if (state === undefined) throw new Error("missing-room-state");
  return state;
}

function openConnection(
  updates: RoomState[],
  authFailure: (code: string) => void,
): ReturnType<typeof createRoomConnection> {
  const connection = createRoomConnection(
    ROOM_ID,
    ACCOUNT_ID,
    (state) => updates.push(state),
    authFailure,
  );
  connections.push(connection);
  return connection;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  socketModule.io.mockReset();
});

afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("createRoomConnection", () => {
  it("locks actions until the socket view arrives and rejects older revisions", async () => {
    const socket = makeSocketHarness();
    socketModule.io.mockReturnValue(socket.socket);
    const current = roomView(3);
    fetchMock.mockResolvedValue(response(successEnvelope(current)));
    const updates: RoomState[] = [];
    const connection = openConnection(updates, () => undefined);

    await settle();
    expect(socket.socket.connected).toBe(true);
    expect(socket.socket.auth).toMatchObject({ accountId: ACCOUNT_ID });
    expect(latest(updates)).toMatchObject({
      room: null,
      connected: true,
      synced: false,
    });
    connection.send({ type: "SelectMatch" });
    expect(socket.commands).toHaveLength(0);

    socket.emit(SOCKET_ROOM_VIEW_EVENT, viewEvent(current));
    expect(socket.socket.auth).toMatchObject({ accountId: ACCOUNT_ID });
    expect(latest(updates)).toMatchObject({ room: current, synced: true });
    socket.emit(SOCKET_ROOM_VIEW_EVENT, viewEvent(roomView(2)));
    expect(latest(updates)).toMatchObject({ room: current, synced: true });

    connection.send({ type: "SelectMatch" });
    expect(socket.commands).toHaveLength(1);
    expect(socket.commands[0]?.payload.expectedRevision).toBe(3);
  });

  it("discards an acknowledgement from a superseded connection", async () => {
    const socket = makeSocketHarness();
    socketModule.io.mockReturnValue(socket.socket);
    const current = roomView(1);
    fetchMock
      .mockResolvedValueOnce(apiError("forbidden"))
      .mockImplementation(async () => response(successEnvelope(current)));
    const updates: RoomState[] = [];
    openConnection(updates, () => undefined);

    await settle();
    expect(socket.commands).toHaveLength(1);
    const previous = socket.commands[0];
    socket.disconnect("transport close");
    socket.socket.connect();
    expect(socket.commands).toHaveLength(2);

    previous?.acknowledge(null, accepted(previous, current));
    expect(latest(updates)).toMatchObject({
      pending: true,
      synced: false,
      uncertain: false,
    });

    const currentAttempt = socket.commands[1];
    currentAttempt?.acknowledge(null, accepted(currentAttempt, current));
    await settle();
    expect(latest(updates)).toMatchObject({
      room: current,
      pending: false,
      synced: true,
    });
  });

  it("retries an uncertain join with the exact command identity", async () => {
    const socket = makeSocketHarness();
    socketModule.io.mockReturnValue(socket.socket);
    const current = roomView(1);
    fetchMock
      .mockResolvedValueOnce(apiError("forbidden"))
      .mockImplementation(async () => response(successEnvelope(current)));
    const updates: RoomState[] = [];
    const connection = openConnection(updates, () => undefined);

    await settle();
    const first = socket.commands[0];
    first?.acknowledge(new Error("timeout"));
    expect(latest(updates)).toMatchObject({
      pending: false,
      synced: false,
      uncertain: true,
    });

    connection.retry();
    expect(socket.commands).toHaveLength(2);
    const retry = socket.commands[1];
    expect(retry?.payload).toBe(first?.payload);
    expect(retry?.payload).toEqual(first?.payload);

    retry?.acknowledge(null, accepted(retry, current));
    await settle();
    expect(latest(updates)).toMatchObject({ room: current, synced: true });
  });

  it("rebuilds a stale join with the server revision and a new command ID", async () => {
    const socket = makeSocketHarness();
    socketModule.io.mockReturnValue(socket.socket);
    const current = roomView(2);
    fetchMock
      .mockResolvedValueOnce(apiError("forbidden"))
      .mockImplementation(async () => response(successEnvelope(current)));
    const updates: RoomState[] = [];
    openConnection(updates, () => undefined);

    await settle();
    const first = socket.commands[0];
    expect(first?.payload.expectedRevision).toBe(1);
    first?.acknowledge(null, rejected(first, "stale-revision", 2));
    expect(socket.commands).toHaveLength(2);
    const retry = socket.commands[1];
    expect(retry?.payload.payload).toEqual({ type: "JoinRoom" });
    expect(retry?.payload.expectedRevision).toBe(2);
    expect(retry?.payload.commandId).not.toBe(first?.payload.commandId);

    retry?.acknowledge(null, accepted(retry, current));
    await settle();
    expect(latest(updates)).toMatchObject({ room: current, synced: true });
  });

  it("synchronizes before accepting another command after a stale revision", async () => {
    const socket = makeSocketHarness();
    socketModule.io.mockReturnValue(socket.socket);
    const initial = roomView(1);
    const current = roomView(2);
    fetchMock
      .mockResolvedValueOnce(response(successEnvelope(initial)))
      .mockImplementation(async () => response(successEnvelope(current)));
    const updates: RoomState[] = [];
    const connection = openConnection(updates, () => undefined);

    await settle();
    socket.emit(SOCKET_ROOM_VIEW_EVENT, viewEvent(initial));
    connection.send({ type: "SelectMatch" });
    const command = socket.commands[0];
    command?.acknowledge(null, rejected(command, "stale-revision", 2));
    expect(latest(updates)).toMatchObject({
      synced: false,
      error: "牌局已更新，请查看最新状态后再操作。",
    });

    await settle();
    expect(latest(updates)).toMatchObject({ room: current, synced: true });
    connection.send({ type: "SelectMatch" });
    expect(socket.commands).toHaveLength(2);
    expect(socket.commands[1]?.payload.expectedRevision).toBe(2);
  });

  it("treats a future protocol response as a reload requirement", async () => {
    const socket = makeSocketHarness();
    socketModule.io.mockReturnValue(socket.socket);
    fetchMock.mockResolvedValue(
      response({ protocolVersion: PROTOCOL_VERSION + 1 }),
    );
    const authFailure = vi.fn<(code: string) => void>();
    const updates: RoomState[] = [];
    openConnection(updates, authFailure);

    await settle();
    expect(authFailure).toHaveBeenCalledWith("reload-required");
    expect(socket.socket.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(socket.socket.close).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer view when a current connection acknowledgement arrives late", async () => {
    const socket = makeSocketHarness();
    socketModule.io.mockReturnValue(socket.socket);
    fetchMock.mockResolvedValue(response(successEnvelope(roomView(1))));
    const updates: RoomState[] = [];
    const connection = openConnection(updates, () => undefined);
    await settle();
    socket.emit(SOCKET_ROOM_VIEW_EVENT, viewEvent(roomView(1)));
    connection.send({ type: "SetReadiness", ready: true });
    const sent = socket.commands[0];
    socket.emit(SOCKET_ROOM_VIEW_EVENT, viewEvent(roomView(4)));
    sent?.acknowledge(null, accepted(sent, roomView(2)));
    expect(latest(updates)).toMatchObject({
      room: roomView(4),
      pending: false,
    });
    connection.send({ type: "SetReadiness", ready: false });
    expect(socket.commands[1]?.payload.expectedRevision).toBe(4);
  });

  it("does not buffer offline commands and preserves an uncertain seated command across reconnect", async () => {
    const socket = makeSocketHarness();
    socketModule.io.mockReturnValue(socket.socket);
    fetchMock.mockImplementation(async () =>
      response(successEnvelope(roomView(3))),
    );
    const updates: RoomState[] = [];
    const connection = openConnection(updates, () => undefined);
    await settle();
    socket.emit(SOCKET_ROOM_VIEW_EVENT, viewEvent(roomView(3)));
    connection.send({ type: "SetReadiness", ready: true });
    const sent = socket.commands[0];
    connection.send({ type: "AssignSeat", seatIndex: 2 });
    socket.disconnect("transport close");
    connection.send({ type: "AssignSeat", seatIndex: 1 });
    expect(socket.commands).toHaveLength(1);
    socket.socket.connect();
    connection.send({ type: "AssignSeat", seatIndex: 1 });
    expect(latest(updates).synced).toBe(false);
    socket.emit(SOCKET_ROOM_VIEW_EVENT, viewEvent(roomView(3)));
    connection.retry();
    expect(socket.commands).toHaveLength(2);
    expect(socket.commands[1]?.payload).toEqual(sent?.payload);
    const retry = socket.commands[1];
    retry?.acknowledge(null, accepted(retry, roomView(3)));
    await settle();
    expect(latest(updates)).toMatchObject({
      synced: true,
      pending: false,
      uncertain: false,
    });
  });

  it("discards a pending Room read after its controller is closed", async () => {
    const socket = makeSocketHarness();
    socketModule.io.mockReturnValue(socket.socket);
    let finish: (value: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    const updates: RoomState[] = [];
    const connection = openConnection(updates, () => undefined);
    connection.close();
    finish(response(successEnvelope(roomView(1))));
    await settle();
    expect(socket.socket.connect).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("can retry a rejected join while its socket is still connected", async () => {
    const socket = makeSocketHarness();
    socketModule.io.mockReturnValue(socket.socket);
    fetchMock.mockResolvedValue(apiError("forbidden"));
    const updates: RoomState[] = [];
    const connection = openConnection(updates, () => undefined);
    await settle();
    const sent = socket.commands[0];
    sent?.acknowledge(null, rejected(sent, "internal-error"));
    connection.retry();
    expect(socket.commands).toHaveLength(2);
    expect(socket.commands[1]?.payload.payload).toEqual({ type: "JoinRoom" });
    expect(socket.commands[1]?.payload.commandId).not.toBe(
      sent?.payload.commandId,
    );
  });

  it.each(["unauthorized", "reload-required"] as const)(
    "calls the auth failure callback and cleans up on %s",
    async (code) => {
      const socket = makeSocketHarness();
      socketModule.io.mockReturnValue(socket.socket);
      fetchMock.mockResolvedValue(apiError("forbidden"));
      const updates: RoomState[] = [];
      const authFailure = vi.fn<(code: string) => void>();
      openConnection(updates, authFailure);

      await settle();
      expect(socket.commands).toHaveLength(1);
      const error = Object.assign(new Error(code), { data: { code } });
      socket.emit("connect_error", error);

      expect(authFailure).toHaveBeenCalledWith(code);
      expect(socket.socket.removeAllListeners).toHaveBeenCalledTimes(1);
      expect(socket.socket.close).toHaveBeenCalledTimes(1);
      const stateCount = updates.length;
      socket.emit("connect");
      expect(updates).toHaveLength(stateCount);
    },
  );
});

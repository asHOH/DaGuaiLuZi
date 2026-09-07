import { io } from "socket.io-client";
import {
  PROTOCOL_VERSION,
  LoginResponseEnvelopeSchema,
  RoomCommandAckSchema,
  RoomResponseEnvelopeSchema,
  RoomViewSyncEnvelopeSchema,
  SOCKET_ROOM_COMMAND_EVENT,
  SOCKET_ROOM_VIEW_EVENT,
  type RoomCommandEnvelope,
  type RoomCommandPayload,
  type RoomViewData,
} from "@dglz/protocol";
import { api, ApiError, errorMessage, incompatibleVersion } from "./api";

export type RoomState = {
  room: RoomViewData | null;
  synced: boolean;
  connected: boolean;
  pending: boolean;
  uncertain: boolean;
  error: string;
};

export const initialRoomState: RoomState = {
  room: null,
  synced: false,
  connected: false,
  pending: false,
  uncertain: false,
  error: "",
};

// One lifetime per account/Room. Epochs also invalidate work from earlier connections.
export function createRoomConnection(
  roomId: string,
  accountId: string,
  update: (state: RoomState) => void,
  authFailure: (code: string) => void,
) {
  let state = { ...initialRoomState };
  let closed = false;
  let epoch = 0;
  let joined = false;
  let command: RoomCommandEnvelope | undefined;
  let joinAttempts = 0;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  const socket = io({
    autoConnect: false,
    auth: { protocolVersion: PROTOCOL_VERSION, accountId },
  });
  const patch = (value: Partial<RoomState>) => {
    if (closed) return;
    state = { ...state, ...value };
    update(state);
  };
  const current = (generation: number) => !closed && epoch === generation;
  const failure = (error: unknown) => {
    const code = error instanceof ApiError ? error.code : "internal-error";
    patch({
      error: errorMessage(
        code,
        error instanceof ApiError ? error.reason : undefined,
      ),
    });
    if (code === "unauthorized" || code === "reload-required") {
      close();
      authFailure(code);
    }
  };
  const accept = (view: RoomViewData) => {
    if (
      view.view.roomId !== roomId ||
      (state.room !== null && view.revision < state.room.revision)
    )
      return;
    clearTimeout(syncTimer);
    joined = true;
    socket.auth = { protocolVersion: PROTOCOL_VERSION, accountId, roomId };
    patch({ room: view, synced: true });
  };
  async function refresh(generation: number) {
    try {
      const response = await api(
        `/rooms/${roomId}`,
        RoomResponseEnvelopeSchema,
      );
      if (current(generation) && socket.connected) accept(response.data);
    } catch (error) {
      if (current(generation)) failure(error);
    }
  }
  function newCommand(
    payload: RoomCommandPayload,
    revision: number,
  ): RoomCommandEnvelope {
    return {
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      commandId: crypto.randomUUID(),
      expectedRevision: revision,
      payload,
    };
  }
  function submit() {
    if (closed || !socket.connected || command === undefined || state.pending)
      return;
    const sent = command;
    const generation = epoch;
    const wasUncertain = state.uncertain;
    patch({ pending: true, uncertain: false, error: "" });
    socket
      .timeout(5_000)
      .emit(
        SOCKET_ROOM_COMMAND_EVENT,
        sent,
        (error: Error | null, raw: unknown) => {
          if (!current(generation) || command !== sent) return;
          if (incompatibleVersion(raw)) {
            failure(new ApiError("reload-required"));
            return;
          }
          const parsed = RoomCommandAckSchema.safeParse(raw);
          if (
            error !== null ||
            !parsed.success ||
            parsed.data.commandId !== sent.commandId
          ) {
            patch({
              pending: false,
              uncertain: true,
              synced: false,
              error: "操作结果尚未确认，请同步后重试。",
            });
            if (joined) void refresh(generation);
            return;
          }
          const ack = parsed.data;
          command = undefined;
          patch({ pending: false, uncertain: false });
          if (ack.ok) {
            accept(ack.data);
            // Deduplicated acknowledgements may predate other commands.
            if (wasUncertain) {
              patch({ synced: false });
              void refresh(generation);
            }
          } else if (
            sent.payload.type === "JoinRoom" &&
            ack.error.code === "stale-revision" &&
            ack.error.currentRevision !== undefined
          ) {
            command = newCommand(sent.payload, ack.error.currentRevision);
            if (++joinAttempts < 8) submit();
            else
              patch({
                uncertain: true,
                error: "房间状态变化较快，请重试加入。",
              });
          } else {
            failure(new ApiError(ack.error.code, ack.error.reason));
            if (joined && ack.error.code === "stale-revision") {
              patch({ synced: false });
              void refresh(generation);
            }
          }
        },
      );
  }
  socket.on("connect", () => {
    epoch++;
    patch({ connected: true, synced: false, pending: false, error: "" });
    syncTimer = setTimeout(
      () => patch({ error: "同步超时，请重新连接。" }),
      10_000,
    );
    if (!joined) {
      command ??= newCommand({ type: "JoinRoom" }, 1);
      submit();
    }
  });
  socket.on(SOCKET_ROOM_VIEW_EVENT, (raw: unknown) => {
    if (!socket.connected || closed) return;
    if (incompatibleVersion(raw)) {
      failure(new ApiError("reload-required"));
      return;
    }
    const parsed = RoomViewSyncEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      patch({ synced: false, error: "牌局数据无法读取，请刷新页面。" });
      return;
    }
    accept(parsed.data.data);
  });
  socket.on("disconnect", (reason: string) => {
    epoch++;
    clearTimeout(syncTimer);
    patch({
      connected: false,
      synced: false,
      pending: false,
      uncertain: command !== undefined,
    });
    if (reason === "io server disconnect") {
      // Revoked sessions are disconnected server-side without a structured error.
      void api("/session", LoginResponseEnvelopeSchema)
        .then(() => {
          if (!closed) socket.connect();
        })
        .catch((error: unknown) => {
          if (!closed) failure(error);
        });
    }
  });
  socket.on("connect_error", (error: Error & { data?: { code?: string } }) => {
    failure(new ApiError(error.data?.code ?? "internal-error"));
  });

  async function start() {
    const generation = epoch;
    try {
      // This read only distinguishes membership; it never unlocks socket actions.
      await api(`/rooms/${roomId}`, RoomResponseEnvelopeSchema);
      if (!current(generation)) return;
      joined = true;
      socket.auth = { protocolVersion: PROTOCOL_VERSION, accountId, roomId };
    } catch (error) {
      if (!current(generation)) return;
      if (!(error instanceof ApiError) || error.code !== "forbidden") {
        failure(error);
        return;
      }
    }
    if (current(generation)) socket.connect();
  }
  function close() {
    closed = true;
    epoch++;
    clearTimeout(syncTimer);
    command = undefined;
    socket.removeAllListeners();
    socket.close();
  }
  void start();
  return {
    send(payload: RoomCommandPayload) {
      if (
        !state.synced ||
        !socket.connected ||
        command !== undefined ||
        state.pending ||
        state.room === null
      )
        return;
      command = newCommand(payload, state.room.revision);
      submit();
    },
    retry() {
      if (command !== undefined) {
        joinAttempts = 0;
        if (socket.connected && (state.synced || !joined)) submit();
        else if (socket.connected) void refresh(epoch);
        else socket.connect();
      } else if (socket.connected) {
        if (joined) void refresh(epoch);
        else {
          joinAttempts = 0;
          command = newCommand({ type: "JoinRoom" }, 1);
          submit();
        }
      } else void start();
    },
    close,
  };
}

import { createHash } from "node:crypto";

import {
  decide,
  evolve,
  type PlayerAccountId,
  type State,
} from "@dglz/game-core";
import {
  RoomCommandAckSchema,
  type RoomCommandAck,
  type RoomCommandEnvelope,
  type RoomViewData,
} from "@dglz/protocol";

import type { AppDatabase } from "./db/index.js";
import {
  commitRoomCommand,
  deriveRoomView,
  findAcceptedCommand,
  loadRoom,
  type LoadedRoom,
} from "./rooms.js";

function commandError(
  commandId: string,
  code:
    | "command-id-reused"
    | "domain-rejected"
    | "internal-error"
    | "room-not-found"
    | "stale-revision",
  details: Readonly<{ reason?: string; currentRevision?: number }> = {},
): RoomCommandAck {
  return RoomCommandAckSchema.parse({
    protocolVersion: 1,
    ok: false,
    commandId,
    error: { code, ...details },
  });
}

export function roomCommandFingerprint(envelope: RoomCommandEnvelope): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        protocolVersion: envelope.protocolVersion,
        roomId: envelope.roomId,
        expectedRevision: envelope.expectedRevision,
        payload: envelope.payload,
      }),
      "utf8",
    )
    .digest("hex");
}

export class RoomExecutor {
  private current: LoadedRoom;
  private queue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly database: AppDatabase,
    loadedRoom: LoadedRoom,
  ) {
    this.current = loadedRoom;
  }

  public get revision(): number {
    return this.current.revision;
  }

  public viewFor(accountId: PlayerAccountId): RoomViewData | undefined {
    return deriveRoomView(this.current, accountId);
  }

  public execute(
    accountId: PlayerAccountId,
    envelope: RoomCommandEnvelope,
  ): Promise<RoomCommandAck> {
    const result = this.queue.then(() =>
      this.executeSerialized(accountId, envelope),
    );
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private executeSerialized(
    accountId: PlayerAccountId,
    envelope: RoomCommandEnvelope,
  ): RoomCommandAck {
    const fingerprint = roomCommandFingerprint(envelope);
    const stored = findAcceptedCommand(this.database, envelope.commandId);
    if (stored !== undefined) {
      if (
        stored.accountId === accountId &&
        stored.roomId === envelope.roomId &&
        stored.requestFingerprint === fingerprint
      ) {
        return stored.acknowledgement;
      }
      return commandError(envelope.commandId, "command-id-reused");
    }

    if (envelope.expectedRevision !== this.current.revision) {
      return commandError(envelope.commandId, "stale-revision", {
        currentRevision: this.current.revision,
      });
    }

    let decision;
    try {
      decision = decide(this.current.state, {
        type: "JoinRoom",
        playerId: accountId,
      });
    } catch {
      return commandError(envelope.commandId, "internal-error");
    }
    if (!decision.ok) {
      return commandError(envelope.commandId, "domain-rejected", {
        reason: decision.rejection.reason,
      });
    }

    let candidateState: State;
    try {
      candidateState = decision.events.reduce(
        (state, event) => evolve(state, event),
        this.current.state,
      );
    } catch {
      return commandError(envelope.commandId, "internal-error");
    }

    const nextRevision = this.current.revision + decision.events.length;
    const view = deriveRoomView(
      { state: candidateState, revision: nextRevision },
      accountId,
    );
    if (view === undefined) {
      return commandError(envelope.commandId, "internal-error");
    }
    const acknowledgement = RoomCommandAckSchema.parse({
      protocolVersion: 1,
      ok: true,
      commandId: envelope.commandId,
      data: view,
    });

    try {
      commitRoomCommand(this.database, {
        commandId: envelope.commandId,
        accountId,
        roomId: envelope.roomId,
        requestFingerprint: fingerprint,
        acknowledgement,
        expectedRevision: this.current.revision,
        events: decision.events,
      });
    } catch {
      const raced = findAcceptedCommand(this.database, envelope.commandId);
      if (
        raced !== undefined &&
        raced.accountId === accountId &&
        raced.roomId === envelope.roomId &&
        raced.requestFingerprint === fingerprint
      ) {
        return raced.acknowledgement;
      }
      if (raced !== undefined) {
        return commandError(envelope.commandId, "command-id-reused");
      }
      return commandError(envelope.commandId, "internal-error");
    }

    this.current = { state: candidateState, revision: nextRevision };
    return acknowledgement;
  }
}

export class RoomExecutorRegistry {
  private readonly executors = new Map<string, RoomExecutor>();

  public constructor(private readonly database: AppDatabase) {}

  public async getOrCreate(roomId: string): Promise<RoomExecutor | undefined> {
    const existing = this.executors.get(roomId);
    if (existing !== undefined) {
      return existing;
    }

    const loaded = loadRoom(this.database, roomId);
    if (loaded === undefined) return undefined;
    const executor = new RoomExecutor(this.database, loaded);
    this.executors.set(roomId, executor);
    return executor;
  }
}

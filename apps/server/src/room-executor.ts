import { createHash, randomBytes } from "node:crypto";

import {
  decide,
  deriveStartRequirements,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type Command,
  type PlayerAccountId,
} from "@dglz/game-core";
import {
  PROTOCOL_VERSION,
  RoomCommandAckSchema,
  type RoomCommandAck,
  type RoomCommandEnvelope,
  type RoomViewData,
} from "@dglz/protocol";

import type { AppDatabase } from "./db/index.js";
import {
  appendRoomEvents,
  commitRoomCommand,
  deriveRoomView,
  findAcceptedCommand,
  foldRoomEvents,
  loadRoom,
  type LoadedRoom,
} from "./rooms.js";

export type RoomPresence = () => Promise<ReadonlySet<PlayerAccountId>>;

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
    protocolVersion: PROTOCOL_VERSION,
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

function toDomainCommand(
  accountId: PlayerAccountId,
  envelope: RoomCommandEnvelope,
): Command {
  switch (envelope.payload.type) {
    case "JoinRoom":
      return { type: "JoinRoom", playerId: accountId };
    case "SelectMatch":
      return { type: "SelectMatch", playerId: accountId };
    case "AssignSeat":
      return {
        type: "AssignSeat",
        playerId: accountId,
        seatIndex: envelope.payload.seatIndex,
      };
    case "SetReadiness":
      return {
        type: "SetReadiness",
        playerId: accountId,
        ready: envelope.payload.ready,
      };
    case "Play":
      return {
        type: "Play",
        playerId: accountId,
        cards: envelope.payload.cards,
      };
    case "ReplaceMatchRulesConfiguration":
    case "SelectTributeCard":
    case "OfferReturnCandidates":
    case "SelectReturnCard":
    case "SubmitTieChoiceBallot":
    case "AbortMatch":
      return { ...envelope.payload, playerId: accountId };
    case "Pass":
      return { type: "Pass", playerId: accountId };
  }
}

function freshStartCommand(
  type: "StartMatch" | "StartNextHand" = "StartMatch",
): Command {
  return {
    type,
    handSeed: randomBytes(32).toString("base64url"),
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
  };
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
    presence?: RoomPresence,
  ): Promise<RoomCommandAck> {
    const result = this.queue.then(() =>
      this.executeSerialized(accountId, envelope, presence),
    );
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  public autoStart(presence: RoomPresence): Promise<void> {
    const result = this.queue.then(() => this.autoStartSerialized(presence));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  public resumeSettledHand(accountId: PlayerAccountId): Promise<void> {
    const result = this.queue.then(() => {
      const view = this.viewFor(accountId)?.view;
      if (view?.lifecycle !== "ACTIVE" || view.handResult === undefined) return;
      const decision = decide(
        this.current.state,
        freshStartCommand("StartNextHand"),
      );
      if (!decision.ok) throw new Error(decision.rejection.reason);
      const candidate = foldRoomEvents(this.current, decision.events);
      appendRoomEvents(this.database, {
        roomId: this.current.roomId,
        expectedRevision: this.current.revision,
        causationCommandId: null,
        events: decision.events,
      });
      this.current = candidate;
    });
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async executeSerialized(
    accountId: PlayerAccountId,
    envelope: RoomCommandEnvelope,
    presence: RoomPresence | undefined,
  ): Promise<RoomCommandAck> {
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
      decision = decide(
        this.current.state,
        toDomainCommand(accountId, envelope),
      );
    } catch {
      return commandError(envelope.commandId, "internal-error");
    }
    if (!decision.ok) {
      return commandError(envelope.commandId, "domain-rejected", {
        reason: decision.rejection.reason,
      });
    }

    let events = [...decision.events];
    let candidate: LoadedRoom;
    try {
      candidate = foldRoomEvents(this.current, events);
    } catch {
      return commandError(envelope.commandId, "internal-error");
    }

    if (presence !== undefined) {
      const requirements = deriveStartRequirements(candidate.state);
      if (requirements !== undefined) {
        let connected: ReadonlySet<PlayerAccountId>;
        try {
          connected = await presence();
        } catch {
          return commandError(envelope.commandId, "internal-error");
        }
        if (
          requirements.playerIds.every((playerId) => connected.has(playerId))
        ) {
          let startDecision;
          try {
            startDecision = decide(candidate.state, freshStartCommand());
          } catch {
            return commandError(envelope.commandId, "internal-error");
          }
          if (!startDecision.ok) {
            return commandError(envelope.commandId, "internal-error");
          }
          events = [...events, ...startDecision.events];
          try {
            candidate = foldRoomEvents(this.current, events);
          } catch {
            return commandError(envelope.commandId, "internal-error");
          }
        }
      }
    }

    try {
      const settled = deriveRoomView(candidate, accountId)?.view;
      if (settled?.lifecycle === "ACTIVE" && settled.handResult !== undefined) {
        const next = decide(
          candidate.state,
          freshStartCommand("StartNextHand"),
        );
        if (!next.ok) return commandError(envelope.commandId, "internal-error");
        events = [...events, ...next.events];
        candidate = foldRoomEvents(candidate, next.events);
      }
    } catch {
      return commandError(envelope.commandId, "internal-error");
    }
    const view = deriveRoomView(candidate, accountId);
    if (view === undefined) {
      return commandError(envelope.commandId, "internal-error");
    }
    const acknowledgement = RoomCommandAckSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
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
        events,
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

    this.current = candidate;
    return acknowledgement;
  }

  private async autoStartSerialized(presence: RoomPresence): Promise<void> {
    const requirements = deriveStartRequirements(this.current.state);
    if (requirements === undefined) {
      return;
    }

    let connected: ReadonlySet<PlayerAccountId>;
    try {
      connected = await presence();
    } catch {
      return;
    }
    if (!requirements.playerIds.every((playerId) => connected.has(playerId))) {
      return;
    }

    let decision;
    try {
      decision = decide(this.current.state, freshStartCommand());
    } catch {
      return;
    }
    if (!decision.ok) {
      return;
    }

    let candidate: LoadedRoom;
    try {
      candidate = foldRoomEvents(this.current, decision.events);
      appendRoomEvents(this.database, {
        roomId: this.current.roomId,
        expectedRevision: this.current.revision,
        causationCommandId: null,
        events: decision.events,
      });
    } catch {
      return;
    }
    this.current = candidate;
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

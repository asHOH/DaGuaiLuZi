import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  decide,
  derivePlayerView,
  deriveStartRequirements,
  evolve,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type Command,
  type PlayerAccountId,
  type State,
  type RoomCreated,
} from "@dglz/game-core";
import {
  PROTOCOL_VERSION,
  RoomCommandAckSchema,
  type RoomCommandAck,
  type RoomCommandEnvelope,
  type RoomViewData,
  type ChallengePreview,
  type RoomCommandPayload,
  type ProtocolErrorCode,
} from "@dglz/protocol";

import type { AppDatabase } from "./db/index.js";
import { UnauthorizedSessionError } from "./auth.js";
import { ChallengeLookup, createChallengeCode } from "./challenges.js";
import {
  appendRoomEvents,
  commitRoomCommand,
  deriveRoomView,
  findAcceptedCommand,
  foldRoomEvents,
  loadRoom,
  recoverRoomControls,
  roomControl,
  saveRoomControl,
  UnsupportedPersistedEventError,
  type LoadedRoom,
  type UnrecoverableRoom,
} from "./rooms.js";

export type RoomPresence = () => Promise<ReadonlySet<PlayerAccountId>>;

function commandError(
  commandId: string,
  code: ProtocolErrorCode,
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
  payload: Exclude<
    RoomCommandPayload,
    { type: "SelectChallengeHand" | "ReplaceInterruptedRoom" }
  >,
): Command {
  return { ...payload, playerId: accountId };
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

function activityStartCommand(state: State): Command {
  return derivePlayerView(state, "__room_start__").selectedActivity ===
    "challenge"
    ? { type: "StartChallengeHand" }
    : freshStartCommand();
}

export class RoomExecutor {
  private current: LoadedRoom | UnrecoverableRoom;
  private queue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly database: AppDatabase,
    loadedRoom: LoadedRoom | UnrecoverableRoom,
    private readonly challenges: ChallengeLookup = new ChallengeLookup(
      database,
    ),
  ) {
    this.current = loadedRoom;
  }

  public get revision(): number {
    return this.current.revision;
  }

  public viewFor(accountId: PlayerAccountId): RoomViewData | undefined {
    if ("recovery" in this.current)
      return this.current.recovery.members.some(
        (member) => member.playerId === accountId,
      )
        ? { revision: this.current.revision, view: this.current.recovery }
        : undefined;
    return deriveRoomView(this.current, accountId);
  }

  public execute(
    accountId: PlayerAccountId,
    envelope: RoomCommandEnvelope,
    presence?: RoomPresence,
    authorize?: () => void,
  ): Promise<RoomCommandAck> {
    const result = this.queue.then(() =>
      this.executeSerialized(accountId, envelope, presence, authorize),
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

  public resumeSettledHand(
    accountId: PlayerAccountId,
    authorize?: () => void,
  ): Promise<void> {
    const result = this.queue.then(() => {
      authorize?.();
      if ("recovery" in this.current) return;
      const view = this.viewFor(accountId)?.view;
      if (
        view?.lifecycle !== "ACTIVE" ||
        view.selectedActivity !== "match" ||
        view.handResult === undefined
      )
        return;
      const decision = decide(
        this.current.state,
        freshStartCommand("StartNextHand"),
      );
      if (!decision.ok) throw new Error(decision.rejection.reason);
      const candidate = foldRoomEvents(this.current, decision.events);
      appendRoomEvents(
        this.database,
        {
          roomId: this.current.roomId,
          expectedRevision: this.current.revision,
          causationCommandId: null,
          events: decision.events,
          control: roomControl(candidate),
        },
        authorize,
      );
      this.current = candidate;
    });
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  public createChallengeCode(
    accountId: PlayerAccountId,
    handStartSequence: number,
    authorize?: () => void,
  ): Promise<ChallengePreview | "not-found" | "forbidden"> {
    const result = this.queue.then(() =>
      this.database.sqlite
        .transaction(() => {
          authorize?.();
          return createChallengeCode(
            this.database,
            this.current.roomId,
            handStartSequence,
            accountId,
          );
        })
        .immediate(),
    );
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
    authorize: (() => void) | undefined,
  ): Promise<RoomCommandAck> {
    authorize?.();
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

    if (
      envelope.payload.type === "ReplaceInterruptedRoom" ||
      "recovery" in this.current
    ) {
      const view = this.viewFor(accountId)?.view;
      const reject = (reason: string) =>
        commandError(envelope.commandId, "domain-rejected", { reason });
      if (view === undefined) return reject("not-a-member");
      if (view.lifecycle !== "INTERRUPTED")
        return reject("room-not-interrupted");
      if (view.ownerId !== accountId) return reject("owner-only");
      if (
        envelope.payload.type !== "ReplaceInterruptedRoom" &&
        envelope.payload.type !== "ArchiveRoom"
      )
        return reject("room-not-in-lobby");
      let replacement: RoomCreated | undefined;
      let next: LoadedRoom | UnrecoverableRoom = this.current;
      let data: RoomViewData;
      if (envelope.payload.type === "ReplaceInterruptedRoom") {
        replacement = {
          type: "RoomCreated",
          roomId: randomUUID(),
          ownerId: accountId,
          rulesConfiguration: view.rulesConfiguration,
          seatingPolicy: "fixed",
        };
        data = deriveRoomView(
          {
            roomId: replacement.roomId,
            revision: 1,
            state: evolve(undefined, replacement),
          },
          accountId,
        )!;
      } else {
        next = {
          roomId: this.current.roomId,
          revision: this.current.revision + 1,
          recovery: { ...view, lifecycle: "ARCHIVED" },
        };
        data = { revision: next.revision, view: next.recovery };
      }
      const acknowledgement = RoomCommandAckSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        ok: true,
        commandId: envelope.commandId,
        data,
      });
      try {
        commitRoomCommand(
          this.database,
          {
            roomId: envelope.roomId,
            expectedRevision: this.current.revision,
            accountId,
            commandId: envelope.commandId,
            requestFingerprint: fingerprint,
            acknowledgement,
            events: replacement === undefined ? [{ type: "RoomArchived" }] : [],
            ...(replacement === undefined && "recovery" in next
              ? { control: { revision: next.revision, view: next.recovery } }
              : { replacement: replacement! }),
          },
          authorize,
        );
      } catch (error) {
        if (error instanceof UnauthorizedSessionError)
          return commandError(envelope.commandId, "unauthorized");
        return commandError(envelope.commandId, "internal-error");
      }
      this.current = next;
      return acknowledgement;
    }

    let decision;
    try {
      let command: Command;
      if (envelope.payload.type === "SelectChallengeHand") {
        const found = this.challenges.resolve(accountId, {
          code: envelope.payload.code,
        });
        if (!found.ok) return commandError(envelope.commandId, found.code);
        command = {
          type: "SelectChallengeHand",
          playerId: accountId,
          template: found.template,
        };
      } else {
        command = toDomainCommand(accountId, envelope.payload);
      }
      decision = decide(this.current.state, command);
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
            startDecision = decide(
              candidate.state,
              activityStartCommand(candidate.state),
            );
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
      if (
        settled?.lifecycle === "ACTIVE" &&
        settled.selectedActivity === "match" &&
        settled.handResult !== undefined
      ) {
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
    const view =
      envelope.payload.type === "LeaveRoom"
        ? {
            roomId: candidate.roomId,
            revision: candidate.revision,
            left: true as const,
          }
        : deriveRoomView(candidate, accountId);
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
      commitRoomCommand(
        this.database,
        {
          commandId: envelope.commandId,
          accountId,
          roomId: envelope.roomId,
          requestFingerprint: fingerprint,
          acknowledgement,
          expectedRevision: this.current.revision,
          events,
          control: roomControl(candidate),
        },
        authorize,
      );
    } catch (error) {
      if (error instanceof UnauthorizedSessionError)
        return commandError(envelope.commandId, "unauthorized");
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
    if ("recovery" in this.current) return;
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
      decision = decide(
        this.current.state,
        activityStartCommand(this.current.state),
      );
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
        control: roomControl(candidate),
      });
    } catch {
      return;
    }
    this.current = candidate;
  }
}

export class RoomExecutorRegistry {
  private readonly executors = new Map<string, RoomExecutor>();
  public readonly challenges: ChallengeLookup;

  public constructor(private readonly database: AppDatabase) {
    this.challenges = new ChallengeLookup(database);
  }

  public async getOrCreate(roomId: string): Promise<RoomExecutor | undefined> {
    const existing = this.executors.get(roomId);
    if (existing !== undefined) {
      return existing;
    }

    let loaded: LoadedRoom | UnrecoverableRoom | undefined;
    try {
      loaded = loadRoom(this.database, roomId);
      if (loaded !== undefined)
        saveRoomControl(this.database, roomControl(loaded));
    } catch (error) {
      if (!(error instanceof UnsupportedPersistedEventError)) throw error;
      loaded = recoverRoomControls(this.database, roomId);
    }
    if (loaded === undefined) return undefined;
    const executor = new RoomExecutor(this.database, loaded, this.challenges);
    this.executors.set(roomId, executor);
    return executor;
  }
}

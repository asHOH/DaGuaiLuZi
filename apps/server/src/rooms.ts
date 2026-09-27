import { asc, eq } from "drizzle-orm";
import {
  derivePlayerView,
  evolve,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type PlayerAccountId,
  type PlayerView as CorePlayerView,
  type Event,
  type RoomCreated,
  type State,
} from "@dglz/game-core";
import {
  CommandIdSchema,
  CardInstanceCodeSchema,
  CardFaceCodeSchema,
  PlayFormSchema,
  PlayRankSchema,
  RoomCommandAckSchema,
  type RoomCommandAck,
  RoomIdSchema,
  RulesConfigurationSchema,
  RoomViewDataSchema,
  TerminalPlayerViewSchema,
  rulesConfigurationPreset,
  SeatingPolicySchema,
  type RulesetId,
  type PlayerViewLastHandResult,
  type RoomViewData,
} from "@dglz/protocol";
import { z } from "zod";

import { ChallengeTemplateSchema } from "./challenge-template.js";
import type { AppDatabase } from "./db/index.js";
import { roomControls, roomEvents } from "./db/schema.js";

const ROOM_EVENT_SCHEMA_VERSION = 1;
const PlayerIdSchema = z.string().min(1).max(128);
const TeamIndexSchema = z.union([z.literal(0), z.literal(1)]);
const TeamLevelSchema = z.enum(["2", "3", "4", "5", "6"]);
const TeamLevelsSchema = z.tuple([TeamLevelSchema, TeamLevelSchema]);
const FailureCountersSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);
const TrumpRankSchema = z.enum(["2", "3", "4", "5"]);

const RoomCreatedPayloadSchema = z
  .object({
    type: z.literal("RoomCreated"),
    roomId: RoomIdSchema,
    ownerId: PlayerIdSchema,
    rulesConfiguration: RulesConfigurationSchema,
    seatingPolicy: SeatingPolicySchema,
  })
  .strict();

const MemberJoinedPayloadSchema = z
  .object({
    type: z.literal("MemberJoined"),
    playerId: PlayerIdSchema,
    joinOrder: z.number().int().nonnegative(),
  })
  .strict();

const MemberLeftPayloadSchema = z
  .object({ type: z.literal("MemberLeft"), playerId: PlayerIdSchema })
  .strict();
const OwnerTransferredPayloadSchema = z
  .object({ type: z.literal("OwnerTransferred"), ownerId: PlayerIdSchema })
  .strict();
const RoomArchivedPayloadSchema = z
  .object({ type: z.literal("RoomArchived") })
  .strict();
const RoomInterruptedPayloadSchema = z
  .object({ type: z.literal("RoomInterrupted") })
  .strict();
const SeatingPolicyReplacedPayloadSchema = z
  .object({
    type: z.literal("SeatingPolicyReplaced"),
    seatingPolicy: SeatingPolicySchema,
  })
  .strict();

const MatchSelectedPayloadSchema = z
  .object({ type: z.literal("MatchSelected") })
  .strict();

const ChallengeHandSelectedPayloadSchema = z
  .object({
    type: z.literal("ChallengeHandSelected"),
    template: ChallengeTemplateSchema,
  })
  .strict();
const ChallengeHandStartedPayloadSchema = z
  .object({
    type: z.literal("ChallengeHandStarted"),
    template: ChallengeTemplateSchema,
    playerIds: z.array(PlayerIdSchema),
    seatingPolicy: SeatingPolicySchema,
  })
  .strict()
  .refine(
    (event) =>
      event.playerIds.length ===
        (event.template.rulesetId === "dglz-6p-3d-v1" ? 6 : 4) &&
      new Set(event.playerIds).size === event.playerIds.length,
    "invalid-players",
  );
const ChallengeHandAbortedPayloadSchema = z
  .object({ type: z.literal("ChallengeHandAborted") })
  .strict();

const MatchRulesConfigurationReplacedPayloadSchema = z
  .object({
    type: z.literal("MatchRulesConfigurationReplaced"),
    rulesConfiguration: RulesConfigurationSchema,
  })
  .strict();

const SeatAssignedPayloadSchema = z
  .object({
    type: z.literal("SeatAssigned"),
    playerId: PlayerIdSchema,
    seatIndex: z.number().int().nonnegative(),
  })
  .strict();

const ReadinessChangedPayloadSchema = z
  .object({
    type: z.literal("ReadinessChanged"),
    playerId: PlayerIdSchema,
    ready: z.boolean(),
  })
  .strict();

const ReadinessClearedPayloadSchema = z
  .object({ type: z.literal("ReadinessCleared") })
  .strict();

const SeatAssignmentsClearedPayloadSchema = z
  .object({ type: z.literal("SeatAssignmentsCleared") })
  .strict();

const MatchStartedPayloadSchema = z
  .object({
    type: z.literal("MatchStarted"),
    rulesetId: z.enum(["dglz-6p-3d-v1", "dglz-4p-2d-v1"]),
    rulesConfiguration: RulesConfigurationSchema,
    seatingPolicy: SeatingPolicySchema,
    handSeed: z.string().min(1).max(256),
    randomnessVersion: z.literal(RANDOMNESS_VERSION),
    shuffleVersion: z.literal(SHUFFLE_VERSION),
    playerIds: z.array(PlayerIdSchema).min(1).max(6),
    dealerSeat: z.number().int().nonnegative(),
    dealerTeam: TeamIndexSchema,
    teamLevels: TeamLevelsSchema,
    trumpRank: TrumpRankSchema,
    failureCounters: FailureCountersSchema,
  })
  .strict()
  .superRefine((event, context) => {
    const playerCount = event.rulesetId === "dglz-6p-3d-v1" ? 6 : 4;
    if (event.rulesConfiguration.rulesetId !== event.rulesetId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ruleset-mismatch",
        path: ["rulesConfiguration", "rulesetId"],
      });
    }
    if (event.playerIds.length !== playerCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid-player-count",
        path: ["playerIds"],
      });
    }
    if (new Set(event.playerIds).size !== event.playerIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duplicate-player",
        path: ["playerIds"],
      });
    }
    if (event.dealerSeat >= playerCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid-dealer-seat",
        path: ["dealerSeat"],
      });
    }
    if (event.dealerTeam !== event.dealerSeat % 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "dealer-team-mismatch",
        path: ["dealerTeam"],
      });
    }
    if (event.trumpRank !== event.teamLevels[event.dealerTeam]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "trump-rank-mismatch",
        path: ["trumpRank"],
      });
    }
  });

const EventCardCodesSchema = z
  .array(CardInstanceCodeSchema)
  .min(1)
  .max(5)
  .refine(
    (cards) =>
      cards.length === 1 ||
      cards.length === 2 ||
      cards.length === 3 ||
      cards.length === 5,
    "invalid-card-count",
  )
  .superRefine((cards, context) => {
    if (new Set(cards).size !== cards.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duplicate-card-instance",
      });
    }
  });
const CardsPlayedPayloadSchema = z
  .object({
    type: z.literal("CardsPlayed"),
    playerId: PlayerIdSchema,
    seatIndex: z.number().int().nonnegative(),
    cards: EventCardCodesSchema,
    form: PlayFormSchema,
    rank: PlayRankSchema,
    representedFaces: z.array(CardFaceCodeSchema).min(1).max(5),
    comparisonRanks: z.array(PlayRankSchema).min(1).max(5),
  })
  .strict();

const PlayerPassedPayloadSchema = z
  .object({
    type: z.literal("PlayerPassed"),
    playerId: PlayerIdSchema,
    seatIndex: z.number().int().nonnegative(),
  })
  .strict();

const PlayerFinishedPayloadSchema = z
  .object({
    type: z.literal("PlayerFinished"),
    playerId: PlayerIdSchema,
    seatIndex: z.number().int().nonnegative(),
    finishPosition: z.number().int().positive(),
  })
  .strict();

const TurnAdvancedPayloadSchema = z
  .object({
    type: z.literal("TurnAdvanced"),
    seatIndex: z.number().int().nonnegative(),
  })
  .strict();

const LeadResetPayloadSchema = z
  .object({
    type: z.literal("LeadReset"),
    seatIndex: z.number().int().nonnegative(),
  })
  .strict();

const HandResultDeterminedPayloadSchema = z
  .object({
    type: z.literal("HandResultDetermined"),
    outcome: z.enum(["win", "draw"]),
    firstFinisherTeam: TeamIndexSchema,
    winningTeam: TeamIndexSchema.optional(),
    nextDealerTeam: TeamIndexSchema,
    caughtPlayerIds: z.array(PlayerIdSchema).max(6),
  })
  .strict()
  .transform((event): Extract<Event, { type: "HandResultDetermined" }> => {
    if (event.winningTeam === undefined) {
      return {
        type: event.type,
        outcome: event.outcome,
        firstFinisherTeam: event.firstFinisherTeam,
        nextDealerTeam: event.nextDealerTeam,
        caughtPlayerIds: event.caughtPlayerIds,
      };
    }
    return {
      type: event.type,
      outcome: event.outcome,
      firstFinisherTeam: event.firstFinisherTeam,
      winningTeam: event.winningTeam,
      nextDealerTeam: event.nextDealerTeam,
      caughtPlayerIds: event.caughtPlayerIds,
    };
  });

const ChallengeHandCompletedPayloadSchema = z
  .object({
    type: z.literal("ChallengeHandCompleted"),
    outcome: z.enum(["win", "draw"]),
    firstFinisherTeam: TeamIndexSchema,
    winningTeam: TeamIndexSchema.optional(),
    nextDealerTeam: TeamIndexSchema,
    caughtPlayerIds: z.array(PlayerIdSchema).max(6),
  })
  .strict()
  .transform((event): Extract<Event, { type: "ChallengeHandCompleted" }> => {
    const { winningTeam, ...result } = event;
    return winningTeam === undefined ? result : { ...result, winningTeam };
  });

const HandSettledPayloadSchema = z
  .object({
    type: z.literal("HandSettled"),
    handNumber: z.number().int().positive(),
    dealerTeam: TeamIndexSchema,
    teamLevels: TeamLevelsSchema,
    failureCounters: FailureCountersSchema,
  })
  .strict();

const MatchCompletedPayloadSchema = z
  .object({
    type: z.literal("MatchCompleted"),
    winningTeam: TeamIndexSchema,
    endingReason: z.enum(["team-level-6", "three-failure-limit-at-5"]),
    teamLevels: TeamLevelsSchema,
    completedHandCount: z.number().int().positive(),
  })
  .strict();

const MatchAbortedPayloadSchema = z
  .object({
    type: z.literal("MatchAborted"),
    teamLevels: TeamLevelsSchema,
    completedHandCount: z.number().int().nonnegative(),
  })
  .strict();

const HandStartedPayloadSchema = z
  .object({
    type: z.literal("HandStarted"),
    handNumber: z.number().int().positive(),
    rulesetId: z.enum(["dglz-6p-3d-v1", "dglz-4p-2d-v1"]),
    rulesConfiguration: RulesConfigurationSchema,
    seatingPolicy: SeatingPolicySchema,
    playerIds: z.array(PlayerIdSchema).min(1).max(6),
    dealerTeam: TeamIndexSchema,
    teamLevels: TeamLevelsSchema,
    failureCounters: FailureCountersSchema,
    trumpRank: TrumpRankSchema,
    handSeed: z.string().min(1).max(256),
    randomnessVersion: z.literal(RANDOMNESS_VERSION),
    shuffleVersion: z.literal(SHUFFLE_VERSION),
  })
  .strict()
  .superRefine((event, context) => {
    const playerCount = event.rulesetId === "dglz-6p-3d-v1" ? 6 : 4;
    if (event.rulesConfiguration.rulesetId !== event.rulesetId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ruleset-mismatch",
        path: ["rulesConfiguration", "rulesetId"],
      });
    }
    if (event.playerIds.length !== playerCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid-player-count",
        path: ["playerIds"],
      });
    }
    if (new Set(event.playerIds).size !== event.playerIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duplicate-player",
        path: ["playerIds"],
      });
    }
    if (event.trumpRank !== event.teamLevels[event.dealerTeam]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "trump-rank-mismatch",
        path: ["trumpRank"],
      });
    }
  });

const TributeCardSelectedPayloadSchema = z
  .object({
    type: z.literal("TributeCardSelected"),
    giverId: PlayerIdSchema,
    giverSeat: z.number().int().nonnegative(),
    card: CardInstanceCodeSchema,
    rank: PlayRankSchema,
  })
  .strict();

const TributeTransferredPayloadSchema = z
  .object({
    type: z.literal("TributeTransferred"),
    giverId: PlayerIdSchema,
    giverSeat: z.number().int().nonnegative(),
    recipientId: PlayerIdSchema,
    recipientSeat: z.number().int().nonnegative(),
    card: CardInstanceCodeSchema,
    rank: PlayRankSchema,
  })
  .strict();

const ReturnCandidatesOfferedPayloadSchema = z
  .object({
    type: z.literal("ReturnCandidatesOffered"),
    giverId: PlayerIdSchema,
    giverSeat: z.number().int().nonnegative(),
    recipientId: PlayerIdSchema,
    recipientSeat: z.number().int().nonnegative(),
    tributeCard: CardInstanceCodeSchema,
    candidateCards: z
      .array(CardInstanceCodeSchema)
      .min(2)
      .max(3)
      .superRefine((cards, context) => {
        if (new Set(cards).size !== cards.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "duplicate-card-instance",
          });
        }
      }),
  })
  .strict();

const ReturnTransferredPayloadSchema = z
  .object({
    type: z.literal("ReturnTransferred"),
    giverId: PlayerIdSchema,
    giverSeat: z.number().int().nonnegative(),
    recipientId: PlayerIdSchema,
    recipientSeat: z.number().int().nonnegative(),
    tributeCard: CardInstanceCodeSchema,
    card: CardInstanceCodeSchema,
  })
  .strict();

const HandLeaderChosenPayloadSchema = z
  .object({
    type: z.literal("HandLeaderChosen"),
    playerId: PlayerIdSchema,
    seatIndex: z.number().int().nonnegative(),
  })
  .strict();

const TieChoiceKindSchema = z.enum(["recipient-pairing", "leader-selection"]);
const TieChoiceBallotSubmittedPayloadSchema = z
  .object({
    type: z.literal("TieChoiceBallotSubmitted"),
    tieKind: TieChoiceKindSchema,
    round: z.number().int().min(1).max(3),
    voterId: PlayerIdSchema,
    candidateId: PlayerIdSchema.nullable(),
  })
  .strict();
const TieChoiceRoundResolvedPayloadSchema = z
  .object({
    type: z.literal("TieChoiceRoundResolved"),
    tieKind: TieChoiceKindSchema,
    round: z.number().int().min(1).max(3),
    ballots: z.array(
      z
        .object({
          voterId: PlayerIdSchema,
          candidateId: PlayerIdSchema.nullable(),
        })
        .strict(),
    ),
    committedPairs: z.array(
      z
        .object({
          giverId: PlayerIdSchema,
          giverSeat: z.number().int().nonnegative(),
          recipientId: PlayerIdSchema,
          recipientSeat: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    remainingVoterIds: z.array(PlayerIdSchema),
    remainingCandidateIds: z.array(PlayerIdSchema),
    fallback: z.boolean(),
    selectedLeaderId: PlayerIdSchema.optional(),
  })
  .strict()
  .transform((event): Extract<Event, { type: "TieChoiceRoundResolved" }> => ({
    type: event.type,
    tieKind: event.tieKind,
    round: event.round,
    ballots: event.ballots,
    committedPairs: event.committedPairs,
    remainingVoterIds: event.remainingVoterIds,
    remainingCandidateIds: event.remainingCandidateIds,
    fallback: event.fallback,
    ...(event.selectedLeaderId === undefined
      ? {}
      : { selectedLeaderId: event.selectedLeaderId }),
  }));

const RoomEventPayloadSchemas = {
  RoomCreated: RoomCreatedPayloadSchema,
  MemberJoined: MemberJoinedPayloadSchema,
  MemberLeft: MemberLeftPayloadSchema,
  OwnerTransferred: OwnerTransferredPayloadSchema,
  RoomArchived: RoomArchivedPayloadSchema,
  RoomInterrupted: RoomInterruptedPayloadSchema,
  SeatingPolicyReplaced: SeatingPolicyReplacedPayloadSchema,
  MatchSelected: MatchSelectedPayloadSchema,
  ChallengeHandSelected: ChallengeHandSelectedPayloadSchema,
  ChallengeHandStarted: ChallengeHandStartedPayloadSchema,
  ChallengeHandCompleted: ChallengeHandCompletedPayloadSchema,
  ChallengeHandAborted: ChallengeHandAbortedPayloadSchema,
  SeatAssigned: SeatAssignedPayloadSchema,
  // Core-only event; persistence remains unsupported.
  SeatRemoved: undefined,
  ReadinessChanged: ReadinessChangedPayloadSchema,
  ReadinessCleared: ReadinessClearedPayloadSchema,
  SeatAssignmentsCleared: SeatAssignmentsClearedPayloadSchema,
  MatchRulesConfigurationReplaced: MatchRulesConfigurationReplacedPayloadSchema,
  MatchStarted: MatchStartedPayloadSchema,
  CardsPlayed: CardsPlayedPayloadSchema,
  PlayerPassed: PlayerPassedPayloadSchema,
  PlayerFinished: PlayerFinishedPayloadSchema,
  TurnAdvanced: TurnAdvancedPayloadSchema,
  LeadReset: LeadResetPayloadSchema,
  HandResultDetermined: HandResultDeterminedPayloadSchema,
  HandSettled: HandSettledPayloadSchema,
  MatchCompleted: MatchCompletedPayloadSchema,
  MatchAborted: MatchAbortedPayloadSchema,
  HandStarted: HandStartedPayloadSchema,
  TributeCardSelected: TributeCardSelectedPayloadSchema,
  TributeTransferred: TributeTransferredPayloadSchema,
  ReturnCandidatesOffered: ReturnCandidatesOfferedPayloadSchema,
  ReturnTransferred: ReturnTransferredPayloadSchema,
  HandLeaderChosen: HandLeaderChosenPayloadSchema,
  TieChoiceBallotSubmitted: TieChoiceBallotSubmittedPayloadSchema,
  TieChoiceRoundResolved: TieChoiceRoundResolvedPayloadSchema,
} satisfies {
  [Type in Event["type"]]:
    z.ZodType<Extract<Event, { type: Type }>> | undefined;
};

const PersistedRoomEventRowSchema = z
  .object({
    roomId: z.string().min(1).max(128),
    sequence: z.number().int().positive(),
    eventType: z.enum(Object.keys(RoomEventPayloadSchemas) as Event["type"][]),
    eventSchemaVersion: z.number().int().positive(),
    causationCommandId: CommandIdSchema.nullable(),
    recordedAt: z.number().int().positive(),
    payload: z.string(),
  })
  .strict();

export class UnsupportedPersistedEventError extends Error {
  public constructor() {
    super("unsupported-persisted-event");
    this.name = "UnsupportedPersistedEventError";
  }
}

export function defaultRoomRulesConfiguration(
  rulesetId: RulesetId,
): RoomCreated["rulesConfiguration"] {
  return rulesConfigurationPreset(rulesetId, "省心");
}

export function appendRoomCreated(
  database: AppDatabase,
  event: RoomCreated,
  authorize?: () => void,
): void {
  const payload = RoomCreatedPayloadSchema.parse(event);
  database.sqlite
    .transaction(() => {
      authorize?.();
      database.db
        .insert(roomEvents)
        .values({
          roomId: event.roomId,
          sequence: 1,
          eventType: event.type,
          eventSchemaVersion: ROOM_EVENT_SCHEMA_VERSION,
          causationCommandId: null,
          recordedAt: Date.now(),
          payload: JSON.stringify(payload),
        })
        .run();
      saveRoomControl(
        database,
        roomControl({
          roomId: event.roomId,
          revision: 1,
          state: evolve(undefined, event),
        }),
      );
    })
    .immediate();
}

export type AcceptedCommandRecord = Readonly<{
  accountId: string;
  roomId: string;
  requestFingerprint: string;
  acknowledgement: RoomCommandAck;
}>;

const AcceptedCommandRowSchema = z.object({
  commandId: CommandIdSchema,
  accountId: z.string().min(1),
  roomId: RoomIdSchema,
  requestFingerprint: z.string().min(1),
  acknowledgement: z.string().min(1),
});

export function decodePersistedRoomCommandAck(value: unknown): RoomCommandAck {
  const parsed = RoomCommandAckSchema.safeParse(value);
  if (!parsed.success) throw new UnsupportedPersistedEventError();
  return parsed.data;
}

export function findAcceptedCommand(
  database: AppDatabase,
  commandId: string,
): AcceptedCommandRecord | undefined {
  const row = database.sqlite
    .prepare(
      `SELECT command_id AS commandId,
              account_id AS accountId,
              room_id AS roomId,
              request_fingerprint AS requestFingerprint,
              acknowledgement
         FROM accepted_commands
        WHERE command_id = ?`,
    )
    .get(commandId);
  if (row === undefined) {
    return undefined;
  }
  const parsedRow = AcceptedCommandRowSchema.parse(row);
  let acknowledgement: unknown;
  try {
    acknowledgement = JSON.parse(parsedRow.acknowledgement) as unknown;
  } catch {
    throw new UnsupportedPersistedEventError();
  }
  let parsedAcknowledgement: RoomCommandAck;
  try {
    parsedAcknowledgement = decodePersistedRoomCommandAck(acknowledgement);
  } catch {
    throw new UnsupportedPersistedEventError();
  }
  if (parsedAcknowledgement.commandId !== parsedRow.commandId) {
    throw new UnsupportedPersistedEventError();
  }
  return {
    accountId: parsedRow.accountId,
    roomId: parsedRow.roomId,
    requestFingerprint: parsedRow.requestFingerprint,
    acknowledgement: parsedAcknowledgement,
  };
}

export type CommittedRoomCommand = Readonly<{
  commandId: string;
  accountId: string;
  roomId: string;
  requestFingerprint: string;
  acknowledgement: RoomCommandAck;
  expectedRevision: number;
  events: readonly Event[];
  control?: RoomControl;
  replacement?: RoomCreated;
}>;

function eventPayload(event: Event): string {
  const schema = RoomEventPayloadSchemas[event.type];
  if (schema === undefined) throw new UnsupportedPersistedEventError();
  return JSON.stringify(schema.parse(event));
}

export type CommittedRoomEvents = Readonly<{
  roomId: string;
  expectedRevision: number;
  causationCommandId: string | null;
  events: readonly Event[];
  control?: RoomControl;
  replacement?: RoomCreated;
}>;

function appendEventRows(
  insertEvent: { run: (...values: unknown[]) => unknown },
  command: CommittedRoomEvents,
): void {
  command.events.forEach((event, offset) => {
    insertEvent.run(
      command.roomId,
      command.expectedRevision + offset + 1,
      event.type,
      ROOM_EVENT_SCHEMA_VERSION,
      command.causationCommandId,
      Date.now(),
      eventPayload(event),
    );
  });
}

export function appendRoomEvents(
  database: AppDatabase,
  events: CommittedRoomEvents,
  authorize?: () => void,
): void {
  const insertEvent = database.sqlite.prepare(
    `INSERT INTO room_events
       (room_id, sequence, event_type, event_schema_version, causation_command_id, recorded_at, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  database.sqlite
    .transaction(() => {
      authorize?.();
      checkRoomRevision(database, events.roomId, events.expectedRevision);
      appendEventRows(insertEvent, events);
      updateRoomControl(database, events);
    })
    .immediate();
}

export function commitRoomCommand(
  database: AppDatabase,
  command: CommittedRoomCommand,
  authorize?: () => void,
): void {
  const acknowledgement = RoomCommandAckSchema.parse(command.acknowledgement);
  const insertCommand = database.sqlite.prepare(
    `INSERT INTO accepted_commands
       (command_id, account_id, room_id, request_fingerprint, acknowledgement)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertEvent = database.sqlite.prepare(
    `INSERT INTO room_events
       (room_id, sequence, event_type, event_schema_version, causation_command_id, recorded_at, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const commit = database.sqlite.transaction(() => {
    authorize?.();
    checkRoomRevision(database, command.roomId, command.expectedRevision);
    insertCommand.run(
      command.commandId,
      command.accountId,
      command.roomId,
      command.requestFingerprint,
      JSON.stringify(acknowledgement),
    );
    appendEventRows(insertEvent, {
      roomId: command.roomId,
      expectedRevision: command.expectedRevision,
      causationCommandId: command.commandId,
      events: command.events,
    });
    updateRoomControl(database, command);
    if (command.replacement !== undefined)
      appendRoomCreated(database, command.replacement);
  });
  commit.immediate();
}

export type LoadedRoom = Readonly<{
  roomId: string;
  state: State;
  revision: number;
  lastHandResult?: PlayerViewLastHandResult;
  handStartSequence?: number;
  challengeParticipantIds?: readonly PlayerAccountId[];
}>;

// Recovery controls contain no gameplay state, cards, results, or Seeds.
const RoomControlSchema = z
  .object({
    revision: z.number().int().positive(),
    view: TerminalPlayerViewSchema.pick({
      roomId: true,
      ownerId: true,
      members: true,
      seats: true,
      rulesConfiguration: true,
      seatingPolicy: true,
      matchRulesConfigurationLocked: true,
      seatingPolicyLocked: true,
    }).extend({
      lifecycle: z.enum(["LOBBY", "ACTIVE", "INTERRUPTED", "ARCHIVED"]),
    }),
  })
  .strict()
  .superRefine(({ view }, ctx) => {
    const ids = new Set(view.members.map((member) => member.playerId));
    if (
      ids.size !== view.members.length ||
      (view.members.length === 0
        ? view.lifecycle !== "ARCHIVED"
        : !ids.has(view.ownerId)) ||
      view.seats.some(
        (seat) => seat.playerId !== undefined && !ids.has(seat.playerId),
      )
    )
      ctx.addIssue({ code: "custom", message: "invalid-room-authority" });
  });
export type RoomControl = z.infer<typeof RoomControlSchema>;
export type UnrecoverableRoom = {
  roomId: string;
  revision: number;
  recovery: z.infer<typeof TerminalPlayerViewSchema>;
};

export function roomControl(room: LoadedRoom): RoomControl {
  const view = derivePlayerView(room.state, "__room_control__");
  return RoomControlSchema.parse({
    revision: room.revision,
    view: {
      roomId: room.roomId,
      lifecycle: view.lifecycle,
      ownerId: view.ownerId,
      members: view.members,
      seats: view.seats,
      rulesConfiguration: view.rulesConfiguration,
      seatingPolicy: view.seatingPolicy,
      matchRulesConfigurationLocked: view.matchRulesConfigurationLocked,
      seatingPolicyLocked: view.seatingPolicyLocked,
    },
  });
}

function checkRoomRevision(
  database: AppDatabase,
  roomId: string,
  revision: number,
): void {
  const row = database.sqlite
    .prepare(
      "SELECT MAX(sequence) AS revision FROM room_events WHERE room_id = ?",
    )
    .get(roomId) as { revision: number | null };
  if (row.revision !== revision) throw new UnsupportedPersistedEventError();
}

export function saveRoomControl(
  database: AppDatabase,
  control: RoomControl,
): void {
  const validated = RoomControlSchema.parse(control);
  checkRoomRevision(database, validated.view.roomId, validated.revision);
  database.db
    .insert(roomControls)
    .values({
      roomId: validated.view.roomId,
      schemaVersion: 1,
      payload: JSON.stringify(validated),
    })
    .onConflictDoUpdate({
      target: roomControls.roomId,
      set: { schemaVersion: 1, payload: JSON.stringify(validated) },
    })
    .run();
}

function updateRoomControl(
  database: AppDatabase,
  command: Omit<CommittedRoomEvents, "causationCommandId">,
): void {
  if (command.control !== undefined) {
    if (
      command.control.view.roomId !== command.roomId ||
      command.control.revision !==
        command.expectedRevision + command.events.length
    )
      throw new UnsupportedPersistedEventError();
    saveRoomControl(database, command.control);
  } else if (command.events.length > 0) {
    // Non-executor imports/fixtures must never leave an older authority record usable.
    database.db
      .delete(roomControls)
      .where(eq(roomControls.roomId, command.roomId))
      .run();
  }
}

export function recoverRoomControls(
  database: AppDatabase,
  roomId: string,
): UnrecoverableRoom {
  const row = database.db
    .select()
    .from(roomControls)
    .where(eq(roomControls.roomId, roomId))
    .get();
  if (row?.schemaVersion !== 1) throw new UnsupportedPersistedEventError();
  let control: RoomControl;
  try {
    control = RoomControlSchema.parse(JSON.parse(row.payload));
  } catch {
    throw new UnsupportedPersistedEventError();
  }
  if (control.view.roomId !== roomId || control.view.lifecycle === "LOBBY")
    throw new UnsupportedPersistedEventError();
  checkRoomRevision(database, roomId, control.revision);
  const count = database.sqlite
    .prepare("SELECT COUNT(*) AS count FROM room_events WHERE room_id = ?")
    .get(roomId) as { count: number };
  if (count.count !== control.revision)
    throw new UnsupportedPersistedEventError();
  const recovery = TerminalPlayerViewSchema.parse({
    ...control.view,
    lifecycle:
      control.view.lifecycle === "ARCHIVED" ? "ARCHIVED" : "INTERRUPTED",
    members: control.view.members.map((member) => ({
      ...member,
      ready: false,
    })),
  });
  let revision = control.revision;
  if (control.view.lifecycle === "ACTIVE") {
    revision++;
    appendRoomEvents(database, {
      roomId,
      expectedRevision: control.revision,
      causationCommandId: null,
      events: [{ type: "RoomInterrupted" }],
      control: { revision, view: recovery },
    });
  }
  return { roomId, revision, recovery };
}

function captureLastHandResult(
  state: State,
  handNumber: number,
): PlayerViewLastHandResult {
  const view = derivePlayerView(state, "__room_projection__");
  if (
    view.handResult === undefined ||
    view.finishPositions === undefined ||
    view.teamLevels === undefined
  ) {
    throw new UnsupportedPersistedEventError();
  }
  return {
    handNumber,
    result: {
      outcome: view.handResult.outcome,
      firstFinisherTeam: view.handResult.firstFinisherTeam,
      ...(view.handResult.winningTeam === undefined
        ? {}
        : { winningTeam: view.handResult.winningTeam }),
      nextDealerTeam: view.handResult.nextDealerTeam,
      caughtPlayerIds: [...view.handResult.caughtPlayerIds],
    },
    finishPositions: view.finishPositions.map((position) => position ?? null),
    teamLevels: [...view.teamLevels] as [
      "2" | "3" | "4" | "5" | "6",
      "2" | "3" | "4" | "5" | "6",
    ],
    seats: view.seats.map((seat) => ({
      seatIndex: seat.seatIndex,
      ...(seat.playerId === undefined ? {} : { playerId: seat.playerId }),
    })),
  };
}

/** Fold committed events once, retaining the latest public Hand settlement. */
export function foldRoomEvents(
  loadedRoom: LoadedRoom,
  events: readonly Event[],
): LoadedRoom {
  let state = loadedRoom.state;
  let lastHandResult = loadedRoom.lastHandResult;
  let revision = loadedRoom.revision;
  let handStartSequence = loadedRoom.handStartSequence;
  let challengeParticipantIds = loadedRoom.challengeParticipantIds;
  for (const event of events) {
    state = evolve(state, event);
    revision += 1;
    if (
      event.type === "MatchStarted" ||
      event.type === "HandStarted" ||
      event.type === "ChallengeHandStarted"
    ) {
      handStartSequence = revision;
      challengeParticipantIds =
        event.type === "ChallengeHandStarted" ? event.playerIds : undefined;
    }
    if (
      event.type === "MatchStarted" ||
      event.type === "ChallengeHandStarted"
    ) {
      lastHandResult = undefined;
    } else if (event.type === "HandSettled") {
      lastHandResult = {
        ...captureLastHandResult(state, event.handNumber),
        ...(handStartSequence === undefined ? {} : { handStartSequence }),
      };
    }
  }
  return {
    roomId: loadedRoom.roomId,
    state,
    revision,
    ...(handStartSequence === undefined ? {} : { handStartSequence }),
    ...(challengeParticipantIds === undefined
      ? {}
      : { challengeParticipantIds }),
    ...(lastHandResult === undefined ? {} : { lastHandResult }),
  };
}

function parsePersistedRoomEvent(
  eventType: Event["type"],
  decoded: unknown,
): Event | undefined {
  const parsed = RoomEventPayloadSchemas[eventType]?.safeParse(decoded);
  return parsed?.success ? parsed.data : undefined;
}

export function* readRoomEvents(
  database: AppDatabase,
  roomId: string,
): Generator<{ sequence: number; recordedAt: number; event: Event }> {
  const rows = database.db
    .select()
    .from(roomEvents)
    .where(eq(roomEvents.roomId, roomId))
    .orderBy(asc(roomEvents.sequence))
    .all();
  let sequence = 0;
  for (const unvalidatedRow of rows) {
    const row = PersistedRoomEventRowSchema.safeParse(unvalidatedRow);
    if (!row.success || row.data.sequence !== sequence + 1) {
      throw new UnsupportedPersistedEventError();
    }
    if (row.data.eventSchemaVersion !== ROOM_EVENT_SCHEMA_VERSION) {
      throw new UnsupportedPersistedEventError();
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(row.data.payload) as unknown;
    } catch {
      throw new UnsupportedPersistedEventError();
    }
    const parsedEvent = parsePersistedRoomEvent(row.data.eventType, decoded);
    if (parsedEvent === undefined) {
      throw new UnsupportedPersistedEventError();
    }
    if (sequence === 0 && parsedEvent.type !== "RoomCreated") {
      throw new UnsupportedPersistedEventError();
    }
    if (sequence !== 0 && parsedEvent.type === "RoomCreated") {
      throw new UnsupportedPersistedEventError();
    }
    if (parsedEvent.type === "RoomCreated" && parsedEvent.roomId !== roomId) {
      throw new UnsupportedPersistedEventError();
    }
    sequence = row.data.sequence;
    yield { sequence, recordedAt: row.data.recordedAt, event: parsedEvent };
  }
}

export function loadRoom(
  database: AppDatabase,
  roomId: string,
): LoadedRoom | undefined {
  let loaded: LoadedRoom | undefined;
  for (const { sequence, event } of readRoomEvents(database, roomId)) {
    try {
      if (loaded === undefined) {
        const state = evolve(undefined, event);
        loaded = { roomId, state, revision: sequence };
      } else {
        loaded = foldRoomEvents(loaded, [event]);
      }
    } catch {
      throw new UnsupportedPersistedEventError();
    }
  }
  return loaded;
}

export function deriveRoomView(
  loadedRoom: LoadedRoom,
  playerId: PlayerAccountId,
): RoomViewData | undefined {
  const view: CorePlayerView = derivePlayerView(loadedRoom.state, playerId);
  if (!view.members.some((member) => member.playerId === playerId)) {
    return undefined;
  }
  if (view.lifecycle === "INTERRUPTED" || view.lifecycle === "ARCHIVED") {
    const control = roomControl(loadedRoom);
    return {
      revision: loadedRoom.revision,
      view: TerminalPlayerViewSchema.parse(control.view),
    };
  }
  const lastHandResult =
    loadedRoom.lastHandResult === undefined
      ? undefined
      : { ...loadedRoom.lastHandResult };
  if (
    lastHandResult !== undefined &&
    !lastHandResult.seats.some((seat) => seat.playerId === playerId)
  ) {
    delete lastHandResult.handStartSequence;
  }
  return RoomViewDataSchema.parse({
    revision: loadedRoom.revision,
    view: {
      roomId: view.roomId,
      lifecycle: view.lifecycle,
      ownerId: view.ownerId,
      members: view.members,
      seats: view.seats,
      rulesConfiguration: view.rulesConfiguration,
      seatingPolicy: view.seatingPolicy,
      matchRulesConfigurationLocked: view.matchRulesConfigurationLocked,
      seatingPolicyLocked: view.seatingPolicyLocked,
      ...(view.selectedActivity === undefined
        ? {}
        : { selectedActivity: view.selectedActivity }),
      ...(view.effectiveRulesetId === undefined
        ? {}
        : {
            effectiveRulesetId: view.effectiveRulesetId,
            effectiveRulesConfiguration: view.effectiveRulesConfiguration,
          }),
      ...(view.challengeSummary === undefined
        ? {}
        : {
            challengeSummary: {
              ...view.challengeSummary,
              ...(loadedRoom.challengeParticipantIds?.includes(playerId) &&
              loadedRoom.handStartSequence !== undefined
                ? { handStartSequence: loadedRoom.handStartSequence }
                : {}),
            },
          }),
      ...(view.lifecycle === "LOBBY" && view.selectedActivity === "challenge"
        ? { teamLevels: view.teamLevels, trumpRank: view.trumpRank }
        : {}),
      ...(view.teamLevels === undefined || view.selectedActivity === "challenge"
        ? {}
        : {
            teamLevels: view.teamLevels,
            completedHandCount: view.completedHandCount,
            ...(view.matchSummary === undefined
              ? {}
              : { matchSummary: view.matchSummary }),
            ...(lastHandResult === undefined ? {} : { lastHandResult }),
          }),
      ...(view.lifecycle !== "ACTIVE"
        ? {}
        : {
            dealerSeat: view.dealerSeat,
            dealerTeam: view.dealerTeam,
            teamLevels: view.teamLevels,
            trumpRank: view.trumpRank,
            failureCounters: view.failureCounters,
            ...(view.selectedActivity === "challenge"
              ? {}
              : { completedHandCount: view.completedHandCount }),
            handNumber:
              view.selectedActivity === "challenge"
                ? 1
                : (view.completedHandCount ?? 0) +
                  (view.handResult === undefined ? 1 : 0),
            handSizes: view.handSizes,
            hand: view.hand,
            ...(view.currentActor === undefined
              ? {}
              : {
                  currentActor: view.currentActor,
                  currentActorSeat: view.currentActorSeat,
                }),
            ...(view.unbeatenPlay === undefined
              ? {}
              : { unbeatenPlay: view.unbeatenPlay }),
            ...(view.handResult === undefined
              ? {}
              : { handResult: view.handResult }),
            ...(lastHandResult === undefined ? {} : { lastHandResult }),
            passedPlayerIds: view.passedPlayerIds,
            finishPositions: view.finishPositions?.map(
              (position) => position ?? null,
            ),
            setupStage: view.setupStage,
            tributeTransfers: view.tributeTransfers,
            returnCandidates: view.returnCandidates,
            pendingPlayerIds: view.pendingPlayerIds,
            eligibleTributeCards: view.eligibleTributeCards,
            ...(view.tieKind === undefined
              ? {}
              : {
                  tieKind: view.tieKind,
                  tieRound: view.tieRound,
                  tieVoterIds: view.tieVoterIds,
                  tieCandidateIds: view.tieCandidateIds,
                  tieSubmittedPlayerIds: view.tieSubmittedPlayerIds,
                }),
            ...(view.tieOwnBallot === undefined
              ? {}
              : { tieOwnBallot: view.tieOwnBallot }),
            tieResolvedRounds: (view.tieResolvedRounds ?? []).map((round) => ({
              ...round,
              ballots: round.ballots.map((ballot) => ({ ...ballot })),
              committedPairs: round.committedPairs.map((pair) => ({
                ...pair,
              })),
              remainingVoterIds: [...round.remainingVoterIds],
              remainingCandidateIds: [...round.remainingCandidateIds],
            })),
          }),
    },
  });
}

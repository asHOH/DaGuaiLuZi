import { z } from "zod";

export const PROTOCOL_VERSION = 3 as const;
export const PROTOCOL_VERSION_HEADER = "x-dglz-protocol-version" as const;

const identifier = z.string().trim().min(1).max(128);
export const UsernameSchema = z.string().trim().min(1).max(64);
export const PasswordSchema = z.string().min(1).max(1024);

export const RulesetIdSchema = z.enum(["dglz-6p-3d-v1", "dglz-4p-2d-v1"]);
export const SeatingPolicySchema = z.enum(["fixed", "randomized"]);
export const RoomIdSchema = z.string().uuid();
export const CommandIdSchema = z.string().uuid();
export const RoomRevisionSchema = z.number().int().positive();

const sharedRulesConfiguration = {
  wildcardRank: z.enum(["weakest-rank", "strongest-rank"]),
  finishingWildcardInterpretation: z.enum(["normal", "weakest-form-and-rank"]),
  flushTieBreaking: z.enum(["highest-card-only", "descending-ranks"]),
  nextHandLeader: z.enum(["first-finisher", "highest-tribute"]),
  tributeCardSelection: z.enum(["fair-random", "giver-choice"]),
  tributeRecipientPairing: z.enum([
    "finish-position-by-tribute-rank",
    "adjacent-first-automatic",
  ]),
  matchEnding: z.enum(["no-failure-limit-at-5", "three-failure-limit-at-5"]),
} as const;

export const SixPlayerRulesConfigurationSchema = z
  .object({
    rulesetId: z.literal("dglz-6p-3d-v1"),
    ...sharedRulesConfiguration,
    jokerPairComparison: z.enum([
      "two-small-and-mixed-are-equal",
      "two-small-jokers-win",
    ]),
    returnCardSelection: z.enum([
      "recipient-choice",
      "giver-choice-from-candidates",
    ]),
  })
  .strict();

export const FourPlayerRulesConfigurationSchema = z
  .object({
    rulesetId: z.literal("dglz-4p-2d-v1"),
    ...sharedRulesConfiguration,
  })
  .strict();

export const RulesConfigurationSchema = z.discriminatedUnion("rulesetId", [
  SixPlayerRulesConfigurationSchema,
  FourPlayerRulesConfigurationSchema,
]);

export type RulesConfiguration = z.infer<typeof RulesConfigurationSchema>;
export type RulesetId = z.infer<typeof RulesetIdSchema>;
export type SeatingPolicy = z.infer<typeof SeatingPolicySchema>;

export type RulesConfigurationPreset = "省心" | "自主";

export function rulesConfigurationPreset(
  rulesetId: RulesetId,
  preset: RulesConfigurationPreset,
): RulesConfiguration {
  const shared = {
    wildcardRank: "strongest-rank" as const,
    finishingWildcardInterpretation: "weakest-form-and-rank" as const,
    flushTieBreaking: "descending-ranks" as const,
    nextHandLeader:
      preset === "自主"
        ? ("highest-tribute" as const)
        : ("first-finisher" as const),
    tributeCardSelection:
      preset === "自主" ? ("giver-choice" as const) : ("fair-random" as const),
    tributeRecipientPairing:
      preset === "自主"
        ? ("finish-position-by-tribute-rank" as const)
        : ("adjacent-first-automatic" as const),
    matchEnding: "no-failure-limit-at-5" as const,
  };
  if (rulesetId === "dglz-6p-3d-v1") {
    return {
      rulesetId,
      ...shared,
      jokerPairComparison: "two-small-and-mixed-are-equal",
      returnCardSelection:
        preset === "自主" ? "giver-choice-from-candidates" : "recipient-choice",
    };
  }
  return { rulesetId, ...shared };
}

export const JoinRoomPayloadSchema = z
  .object({ type: z.literal("JoinRoom") })
  .strict();
export type JoinRoomPayload = z.infer<typeof JoinRoomPayloadSchema>;

export const SelectMatchPayloadSchema = z
  .object({ type: z.literal("SelectMatch") })
  .strict();
export type SelectMatchPayload = z.infer<typeof SelectMatchPayloadSchema>;

export const AssignSeatPayloadSchema = z
  .object({
    type: z.literal("AssignSeat"),
    seatIndex: z.number().int().nonnegative(),
  })
  .strict();
export type AssignSeatPayload = z.infer<typeof AssignSeatPayloadSchema>;

export const SetReadinessPayloadSchema = z
  .object({
    type: z.literal("SetReadiness"),
    ready: z.boolean(),
  })
  .strict();
export type SetReadinessPayload = z.infer<typeof SetReadinessPayloadSchema>;

export type CardFaceCode =
  | `${
      | "2"
      | "3"
      | "4"
      | "5"
      | "6"
      | "7"
      | "8"
      | "9"
      | "10"
      | "J"
      | "Q"
      | "K"
      | "A"}${"S" | "H" | "D" | "C"}`
  | "SMALL"
  | "BIG";
export type CardInstanceCode = `${CardFaceCode}#${1 | 2 | 3}`;
export const CardInstanceCodeSchema = z
  .string()
  .regex(
    /^(?:(?:10|[2-9JQKA])[SHDC]|(?:SMALL|BIG))#[1-3]$/,
  ) as z.ZodType<CardInstanceCode>;
const CardInstanceCodesSchema = z
  .array(CardInstanceCodeSchema)
  .min(1)
  .max(5)
  .superRefine((cards, context) => {
    if (new Set(cards).size !== cards.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duplicate-card-instance",
      });
    }
  });

export const PlayPayloadSchema = z
  .object({
    type: z.literal("Play"),
    cards: CardInstanceCodesSchema,
  })
  .strict();
export type PlayPayload = z.infer<typeof PlayPayloadSchema>;

export const PassPayloadSchema = z.object({ type: z.literal("Pass") }).strict();
export type PassPayload = z.infer<typeof PassPayloadSchema>;

export const ReplaceMatchRulesConfigurationPayloadSchema = z
  .object({
    type: z.literal("ReplaceMatchRulesConfiguration"),
    rulesConfiguration: RulesConfigurationSchema,
  })
  .strict();
export type ReplaceMatchRulesConfigurationPayload = z.infer<
  typeof ReplaceMatchRulesConfigurationPayloadSchema
>;

export const SelectTributeCardPayloadSchema = z
  .object({
    type: z.literal("SelectTributeCard"),
    card: CardInstanceCodeSchema,
  })
  .strict();
export type SelectTributeCardPayload = z.infer<
  typeof SelectTributeCardPayloadSchema
>;

const ReturnCandidateCardsSchema = z
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
  });
export const OfferReturnCandidatesPayloadSchema = z
  .object({
    type: z.literal("OfferReturnCandidates"),
    candidateCards: ReturnCandidateCardsSchema,
  })
  .strict();
export type OfferReturnCandidatesPayload = z.infer<
  typeof OfferReturnCandidatesPayloadSchema
>;

export const SelectReturnCardPayloadSchema = z
  .object({
    type: z.literal("SelectReturnCard"),
    card: CardInstanceCodeSchema,
  })
  .strict();
export type SelectReturnCardPayload = z.infer<
  typeof SelectReturnCardPayloadSchema
>;

const TieChoiceKindSchema = z.enum(["recipient-pairing", "leader-selection"]);
export const SubmitTieChoiceBallotPayloadSchema = z
  .object({
    type: z.literal("SubmitTieChoiceBallot"),
    tieKind: TieChoiceKindSchema,
    round: z.number().int().min(1).max(3),
    candidateId: identifier.nullable(),
  })
  .strict();
export type SubmitTieChoiceBallotPayload = z.infer<
  typeof SubmitTieChoiceBallotPayloadSchema
>;

export const RoomCommandPayloadSchema = z.discriminatedUnion("type", [
  JoinRoomPayloadSchema,
  SelectMatchPayloadSchema,
  AssignSeatPayloadSchema,
  SetReadinessPayloadSchema,
  PlayPayloadSchema,
  PassPayloadSchema,
  ReplaceMatchRulesConfigurationPayloadSchema,
  SelectTributeCardPayloadSchema,
  OfferReturnCandidatesPayloadSchema,
  SelectReturnCardPayloadSchema,
  SubmitTieChoiceBallotPayloadSchema,
]);
export type RoomCommandPayload = z.infer<typeof RoomCommandPayloadSchema>;

export const RoomCommandEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    commandId: CommandIdSchema,
    roomId: RoomIdSchema,
    expectedRevision: RoomRevisionSchema,
    payload: RoomCommandPayloadSchema,
  })
  .strict();
export type RoomCommandEnvelope = z.infer<typeof RoomCommandEnvelopeSchema>;
export const JoinRoomCommandEnvelopeSchema = RoomCommandEnvelopeSchema.extend({
  payload: JoinRoomPayloadSchema,
});

export const LoginCommandSchema = z
  .object({ username: UsernameSchema, password: PasswordSchema })
  .strict();
export type LoginCommand = z.infer<typeof LoginCommandSchema>;

export const CreateRoomCommandSchema = z
  .object({
    rulesetId: RulesetIdSchema,
    seatingPolicy: SeatingPolicySchema,
  })
  .strict();
export type CreateRoomCommand = z.infer<typeof CreateRoomCommandSchema>;

export const ProtocolErrorCodeSchema = z.enum([
  "reload-required",
  "malformed-input",
  "invalid-credentials",
  "unauthorized",
  "forbidden",
  "origin-forbidden",
  "not-found",
  "room-not-found",
  "rate-limited",
  "unsupported-persisted-event",
  "internal-error",
  "domain-rejected",
  "stale-revision",
  "command-id-reused",
]);

export type ProtocolErrorCode = z.infer<typeof ProtocolErrorCodeSchema>;

export const RoomCommandErrorSchema = z
  .object({
    code: ProtocolErrorCodeSchema,
    reason: z.string().min(1).optional(),
    currentRevision: RoomRevisionSchema.optional(),
  })
  .strict();

export const RoomCommandSuccessDataSchema = z.lazy(() => RoomViewDataSchema);
export type RoomCommandSuccessData = z.infer<
  typeof RoomCommandSuccessDataSchema
>;

export const RoomCommandSuccessEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    ok: z.literal(true),
    commandId: CommandIdSchema,
    data: RoomCommandSuccessDataSchema,
  })
  .strict();

export const RoomCommandErrorEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    ok: z.literal(false),
    commandId: CommandIdSchema,
    error: RoomCommandErrorSchema,
  })
  .strict();

export const RoomCommandAckSchema = z.discriminatedUnion("ok", [
  RoomCommandSuccessEnvelopeSchema,
  RoomCommandErrorEnvelopeSchema,
]);
export type RoomCommandAck = z.infer<typeof RoomCommandAckSchema>;

export const SOCKET_ROOM_COMMAND_EVENT = "room:command" as const;
export const SOCKET_ROOM_VIEW_EVENT = "room:view" as const;

export const ErrorEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    ok: z.literal(false),
    error: z.object({ code: ProtocolErrorCodeSchema }).strict(),
  })
  .strict();

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export type SuccessEnvelope<T> = Readonly<{
  protocolVersion: typeof PROTOCOL_VERSION;
  ok: true;
  data: T;
}>;

export function successEnvelope<T>(data: T): SuccessEnvelope<T> {
  return { protocolVersion: PROTOCOL_VERSION, ok: true, data };
}

export function errorEnvelope(code: ProtocolErrorCode): ErrorEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    error: { code },
  };
}

export function parseProtocolVersion(
  value: string | readonly string[] | undefined,
): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export const LoginResponseDataSchema = z
  .object({
    accountId: identifier,
    username: UsernameSchema,
  })
  .strict();

export const LogoutResponseDataSchema = z.object({}).strict();

export const PlayerViewMemberSchema = z
  .object({
    playerId: identifier,
    joinOrder: z.number().int().nonnegative(),
    ready: z.boolean(),
  })
  .strict();

export const PlayerViewSeatSchema = z
  .object({
    seatIndex: z.number().int().nonnegative(),
    playerId: identifier.optional(),
  })
  .strict();

const SelectedActivitySchema = z.enum(["match", "challenge"]);
const TeamIndexSchema = z.union([z.literal(0), z.literal(1)]);
const TeamLevelSchema = z.enum(["2", "3", "4", "5", "6"]);
const TeamLevelsSchema = z.tuple([TeamLevelSchema, TeamLevelSchema]);
const FailureCountersSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);
const TrumpRankSchema = z.enum(["2", "3", "4", "5"]);
export const PlayRankSchema = z.enum([
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "SMALL",
  "BIG",
]);
export const PlayFormSchema = z.enum([
  "single",
  "pair",
  "triple",
  "mixed-suit-straight",
  "flush",
  "full-house",
  "four-plus-one",
  "straight-flush",
  "five-of-a-kind",
]);
export const CardFaceCodeSchema = z
  .string()
  .regex(
    /^(?:(?:10|[2-9JQKA])[SHDC]|(?:SMALL|BIG))$/,
  ) as z.ZodType<CardFaceCode>;
const BoundedCardInstanceCodesSchema = z
  .array(CardInstanceCodeSchema)
  .max(5)
  .refine(
    (cards) =>
      cards.length === 1 ||
      cards.length === 2 ||
      cards.length === 3 ||
      cards.length === 5,
    "invalid-card-count",
  );
export const PlayerViewHandResultSchema = z
  .object({
    outcome: z.enum(["win", "draw"]),
    firstFinisherTeam: TeamIndexSchema,
    winningTeam: TeamIndexSchema.optional(),
    nextDealerTeam: TeamIndexSchema,
    caughtPlayerIds: z.array(identifier).max(6),
  })
  .strict();
const TieChoiceBallotSchema = z
  .object({
    voterId: identifier,
    candidateId: identifier.nullable(),
  })
  .strict();
const TieChoiceRecipientPairSchema = z
  .object({
    giverId: identifier,
    giverSeat: z.number().int().nonnegative(),
    recipientId: identifier,
    recipientSeat: z.number().int().nonnegative(),
  })
  .strict();
const TieChoiceRoundResolvedSchema = z
  .object({
    type: z.literal("TieChoiceRoundResolved"),
    tieKind: TieChoiceKindSchema,
    round: z.number().int().min(1).max(3),
    ballots: z.array(TieChoiceBallotSchema),
    committedPairs: z.array(TieChoiceRecipientPairSchema),
    remainingVoterIds: z.array(identifier),
    remainingCandidateIds: z.array(identifier),
    fallback: z.boolean(),
    selectedLeaderId: identifier.optional(),
  })
  .strict();
export const PlayerViewLastHandResultSchema = z
  .object({
    handNumber: z.number().int().positive(),
    result: PlayerViewHandResultSchema,
    finishPositions: z.array(z.number().int().nonnegative().nullable()),
    teamLevels: TeamLevelsSchema,
    seats: z.array(PlayerViewSeatSchema),
  })
  .strict();
export type PlayerViewLastHandResult = z.infer<
  typeof PlayerViewLastHandResultSchema
>;
const PlayerViewMatchSummarySchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("completed"),
      winningTeam: TeamIndexSchema,
      endingReason: z.enum(["team-level-6", "three-failure-limit-at-5"]),
      teamLevels: TeamLevelsSchema,
      completedHandCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("aborted"),
      teamLevels: TeamLevelsSchema,
      completedHandCount: z.number().int().nonnegative(),
    })
    .strict(),
]);
const PlayerViewPlaySchema = z
  .object({
    playerId: identifier,
    seatIndex: z.number().int().nonnegative(),
    cards: BoundedCardInstanceCodesSchema,
    form: PlayFormSchema,
    rank: PlayRankSchema,
    representedFaces: z.array(CardFaceCodeSchema).max(5),
    comparisonRanks: z.array(PlayRankSchema).max(5),
  })
  .strict();
const SetupStageSchema = z.enum([
  "tribute-selection",
  "recipient-pairing-tie",
  "return-card-selection",
  "leader-selection-tie",
  "play",
]);

const PlayerViewTributeTransferSchema = z
  .object({
    giverId: identifier,
    giverSeat: z.number().int().nonnegative(),
    recipientId: identifier,
    recipientSeat: z.number().int().nonnegative(),
    card: CardInstanceCodeSchema,
    rank: z.string().min(1).max(32),
  })
  .strict();

const PlayerViewReturnCandidatesSchema = z
  .object({
    giverId: identifier,
    giverSeat: z.number().int().nonnegative(),
    recipientId: identifier,
    recipientSeat: z.number().int().nonnegative(),
    tributeCard: CardInstanceCodeSchema,
    candidateCards: z.array(CardInstanceCodeSchema),
  })
  .strict();

const playerViewBaseShape = {
  roomId: RoomIdSchema,
  ownerId: identifier,
  members: z.array(PlayerViewMemberSchema),
  seats: z.array(PlayerViewSeatSchema),
  rulesConfiguration: RulesConfigurationSchema,
  seatingPolicy: SeatingPolicySchema,
  matchRulesConfigurationLocked: z.boolean(),
  seatingPolicyLocked: z.boolean(),
};

const lobbyPlayerViewSchema = z
  .object({
    ...playerViewBaseShape,
    lifecycle: z.literal("LOBBY"),
    selectedActivity: SelectedActivitySchema.optional(),
    teamLevels: TeamLevelsSchema.optional(),
    completedHandCount: z.number().int().nonnegative().optional(),
    matchSummary: PlayerViewMatchSummarySchema.optional(),
    lastHandResult: PlayerViewLastHandResultSchema.optional(),
  })
  .strict();

const activePlayerViewSchema = z
  .object({
    ...playerViewBaseShape,
    lifecycle: z.literal("ACTIVE"),
    selectedActivity: z.literal("match"),
    dealerSeat: z.number().int().nonnegative(),
    dealerTeam: TeamIndexSchema,
    teamLevels: TeamLevelsSchema,
    trumpRank: TrumpRankSchema,
    failureCounters: FailureCountersSchema,
    completedHandCount: z.number().int().nonnegative(),
    handNumber: z.number().int().positive().optional(),
    handSizes: z.array(z.number().int().nonnegative()),
    hand: z.array(CardInstanceCodeSchema),
    currentActor: identifier.optional(),
    currentActorSeat: z.number().int().nonnegative().optional(),
    unbeatenPlay: PlayerViewPlaySchema.optional(),
    handResult: PlayerViewHandResultSchema.optional(),
    lastHandResult: PlayerViewLastHandResultSchema.optional(),
    matchSummary: PlayerViewMatchSummarySchema.optional(),
    passedPlayerIds: z.array(identifier),
    finishPositions: z.array(z.number().int().nonnegative().nullable()),
    setupStage: SetupStageSchema,
    tributeTransfers: z.array(PlayerViewTributeTransferSchema),
    returnCandidates: z.array(PlayerViewReturnCandidatesSchema),
    pendingPlayerIds: z.array(identifier),
    eligibleTributeCards: z.array(CardInstanceCodeSchema),
    tieKind: TieChoiceKindSchema.optional(),
    tieRound: z.number().int().min(1).max(3).optional(),
    tieVoterIds: z.array(identifier).optional(),
    tieCandidateIds: z.array(identifier).optional(),
    tieSubmittedPlayerIds: z.array(identifier).optional(),
    tieOwnBallot: identifier.nullable().optional(),
    tieResolvedRounds: z.array(TieChoiceRoundResolvedSchema).optional(),
  })
  .strict();

export const PlayerViewSchema = z.discriminatedUnion("lifecycle", [
  lobbyPlayerViewSchema,
  activePlayerViewSchema,
]);

export type PlayerView = z.infer<typeof PlayerViewSchema>;

export const RoomViewDataSchema = z
  .object({
    revision: z.number().int().positive(),
    view: PlayerViewSchema,
  })
  .strict();

export type RoomViewData = z.infer<typeof RoomViewDataSchema>;

export const RoomViewSyncEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("room:view"),
    data: RoomViewDataSchema,
  })
  .strict();
export type RoomViewSyncEnvelope = z.infer<typeof RoomViewSyncEnvelopeSchema>;

export const LoginResponseEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    ok: z.literal(true),
    data: LoginResponseDataSchema,
  })
  .strict();

export const LogoutResponseEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    ok: z.literal(true),
    data: LogoutResponseDataSchema,
  })
  .strict();

export const RoomResponseEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    ok: z.literal(true),
    data: RoomViewDataSchema,
  })
  .strict();

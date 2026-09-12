import {
  decodeCardInstance,
  evaluatePlay,
  hasAutomaticResponseClosure,
  RULESET_DEFINITIONS,
  type CardInstance,
  type CardFaceCode,
  type CardInstanceCode,
  type ClassifiedPlay,
  type PlayForm,
  type PlayRank,
  type PlayRejectionReason,
  type RulesConfiguration,
  type RulesetId,
  type TrumpRank,
} from "@dglz/game-rules";

export type RoomId = string;
export type PlayerAccountId = string;
export type SeatIndex = number;

export type Lifecycle =
  "LOBBY" | "ACTIVE" | "COMPLETED" | "ABORTED" | "INTERRUPTED" | "ARCHIVED";

export type SeatingPolicy = "fixed" | "randomized";
export type SelectedActivity = "match" | "challenge";
export type TeamIndex = 0 | 1;
export type TeamLevel = "2" | "3" | "4" | "5" | "6";
export type TeamLevels = readonly [TeamLevel, TeamLevel];
export type FailureCounters = readonly [number, number];
export type HandSeed = string;

export type ChallengeHandResultFacts = Readonly<{
  outcome: "win" | "draw";
  firstFinisherTeam: TeamIndex;
  winningTeam?: TeamIndex;
  nextDealerTeam: TeamIndex;
  caughtSeatIndices: readonly SeatIndex[];
}>;

export type ChallengeTemplateSetup =
  | Readonly<{
      kind: "initial-hand";
      dealerSeat: SeatIndex;
    }>
  | Readonly<{
      kind: "subsequent-hand";
      finishPositions: readonly (number | undefined)[];
      result: ChallengeHandResultFacts;
    }>;

/** Server-private reusable setup. It intentionally contains no Challenge Code or source identity. */
export type ChallengeTemplate = Readonly<{
  rulesetId: RulesetId;
  rulesConfiguration: RulesConfiguration;
  handSeed: HandSeed;
  randomnessVersion: RandomnessVersion;
  shuffleVersion: ShuffleVersion;
  dealerTeam: TeamIndex;
  teamLevels: TeamLevels;
  failureCounters: FailureCounters;
  trumpRank: TrumpRank;
  setup: ChallengeTemplateSetup;
}>;

export type SetupStage =
  | "tribute-selection"
  | "recipient-pairing-tie"
  | "return-card-selection"
  | "leader-selection-tie"
  | "play";

export const RANDOMNESS_VERSION = "dglz-random-v1" as const;
export const SHUFFLE_VERSION = "dglz-shuffle-v1" as const;
export type RandomnessVersion = typeof RANDOMNESS_VERSION;
export type ShuffleVersion = typeof SHUFFLE_VERSION;

export type RoomCreated = Readonly<{
  type: "RoomCreated";
  roomId: RoomId;
  ownerId: PlayerAccountId;
  rulesConfiguration: RulesConfiguration;
  seatingPolicy: SeatingPolicy;
}>;

export type MemberJoined = Readonly<{
  type: "MemberJoined";
  playerId: PlayerAccountId;
  joinOrder: number;
}>;

export type MemberLeft = Readonly<{
  type: "MemberLeft";
  playerId: PlayerAccountId;
}>;

export type OwnerTransferred = Readonly<{
  type: "OwnerTransferred";
  ownerId: PlayerAccountId;
}>;

export type SeatAssigned = Readonly<{
  type: "SeatAssigned";
  playerId: PlayerAccountId;
  seatIndex: SeatIndex;
}>;

export type SeatRemoved = Readonly<{
  type: "SeatRemoved";
  playerId: PlayerAccountId;
  seatIndex: SeatIndex;
}>;

export type ReadinessChanged = Readonly<{
  type: "ReadinessChanged";
  playerId: PlayerAccountId;
  ready: boolean;
}>;

export type ReadinessCleared = Readonly<{
  type: "ReadinessCleared";
}>;

export type SeatAssignmentsCleared = Readonly<{
  type: "SeatAssignmentsCleared";
}>;

export type MatchRulesConfigurationReplaced = Readonly<{
  type: "MatchRulesConfigurationReplaced";
  rulesConfiguration: RulesConfiguration;
}>;

export type SeatingPolicyReplaced = Readonly<{
  type: "SeatingPolicyReplaced";
  seatingPolicy: SeatingPolicy;
}>;

export type MatchSelected = Readonly<{
  type: "MatchSelected";
}>;

export type ChallengeHandSelected = Readonly<{
  type: "ChallengeHandSelected";
  template: ChallengeTemplate;
}>;

export type MatchStarted = Readonly<{
  type: "MatchStarted";
  rulesetId: RulesetId;
  rulesConfiguration: RulesConfiguration;
  seatingPolicy: SeatingPolicy;
  handSeed: HandSeed;
  randomnessVersion: RandomnessVersion;
  shuffleVersion: ShuffleVersion;
  playerIds: readonly PlayerAccountId[];
  dealerSeat: SeatIndex;
  dealerTeam: TeamIndex;
  teamLevels: TeamLevels;
  trumpRank: TrumpRank;
  failureCounters: FailureCounters;
}>;

export type CardsPlayed = Readonly<{
  type: "CardsPlayed";
  playerId: PlayerAccountId;
  seatIndex: SeatIndex;
  cards: readonly CardInstanceCode[];
  form: PlayForm;
  rank: PlayRank;
  representedFaces: readonly CardFaceCode[];
  comparisonRanks: readonly PlayRank[];
}>;

export type PlayerPassed = Readonly<{
  type: "PlayerPassed";
  playerId: PlayerAccountId;
  seatIndex: SeatIndex;
}>;

export type PlayerFinished = Readonly<{
  type: "PlayerFinished";
  playerId: PlayerAccountId;
  seatIndex: SeatIndex;
  finishPosition: number;
}>;

export type TurnAdvanced = Readonly<{
  type: "TurnAdvanced";
  seatIndex: SeatIndex;
}>;

export type LeadReset = Readonly<{
  type: "LeadReset";
  seatIndex: SeatIndex;
}>;

export type HandResultDetermined = Readonly<{
  type: "HandResultDetermined";
  outcome: "win" | "draw";
  firstFinisherTeam: TeamIndex;
  winningTeam?: TeamIndex;
  nextDealerTeam: TeamIndex;
  caughtPlayerIds: readonly PlayerAccountId[];
}>;

export type HandSettled = Readonly<{
  type: "HandSettled";
  handNumber: number;
  dealerTeam: TeamIndex;
  teamLevels: TeamLevels;
  failureCounters: FailureCounters;
}>;

export type MatchCompleted = Readonly<{
  type: "MatchCompleted";
  winningTeam: TeamIndex;
  endingReason: "team-level-6" | "three-failure-limit-at-5";
  teamLevels: TeamLevels;
  completedHandCount: number;
}>;

export type MatchAborted = Readonly<{
  type: "MatchAborted";
  teamLevels: TeamLevels;
  completedHandCount: number;
}>;

export type ChallengeHandStarted = Readonly<{
  type: "ChallengeHandStarted";
  template: ChallengeTemplate;
  /** Current accounts ordered by the template's logical seat indices. */
  playerIds: readonly PlayerAccountId[];
  seatingPolicy: SeatingPolicy;
}>;

export type ChallengeHandCompleted = Readonly<{
  type: "ChallengeHandCompleted";
  outcome: "win" | "draw";
  firstFinisherTeam: TeamIndex;
  winningTeam?: TeamIndex;
  nextDealerTeam: TeamIndex;
  caughtPlayerIds: readonly PlayerAccountId[];
}>;

export type ChallengeHandAborted = Readonly<{
  type: "ChallengeHandAborted";
}>;

export type RoomInterrupted = Readonly<{
  type: "RoomInterrupted";
}>;

export type RoomArchived = Readonly<{
  type: "RoomArchived";
}>;

export type HandStarted = Readonly<{
  type: "HandStarted";
  handNumber: number;
  rulesetId: RulesetId;
  rulesConfiguration: RulesConfiguration;
  seatingPolicy: SeatingPolicy;
  playerIds: readonly PlayerAccountId[];
  dealerTeam: TeamIndex;
  teamLevels: TeamLevels;
  failureCounters: FailureCounters;
  trumpRank: TrumpRank;
  handSeed: HandSeed;
  randomnessVersion: RandomnessVersion;
  shuffleVersion: ShuffleVersion;
}>;

export type TributeCardSelected = Readonly<{
  type: "TributeCardSelected";
  giverId: PlayerAccountId;
  giverSeat: SeatIndex;
  card: CardInstanceCode;
  rank: PlayRank;
}>;

export type TributeTransferred = Readonly<{
  type: "TributeTransferred";
  giverId: PlayerAccountId;
  giverSeat: SeatIndex;
  recipientId: PlayerAccountId;
  recipientSeat: SeatIndex;
  card: CardInstanceCode;
  rank: PlayRank;
}>;

export type ReturnCandidatesOffered = Readonly<{
  type: "ReturnCandidatesOffered";
  giverId: PlayerAccountId;
  giverSeat: SeatIndex;
  recipientId: PlayerAccountId;
  recipientSeat: SeatIndex;
  tributeCard: CardInstanceCode;
  candidateCards: readonly CardInstanceCode[];
}>;

export type ReturnTransferred = Readonly<{
  type: "ReturnTransferred";
  giverId: PlayerAccountId;
  giverSeat: SeatIndex;
  recipientId: PlayerAccountId;
  recipientSeat: SeatIndex;
  tributeCard: CardInstanceCode;
  card: CardInstanceCode;
}>;

export type HandLeaderChosen = Readonly<{
  type: "HandLeaderChosen";
  playerId: PlayerAccountId;
  seatIndex: SeatIndex;
}>;

export type TieChoiceKind = "recipient-pairing" | "leader-selection";
export type TieChoiceCandidate = PlayerAccountId | null;

export type SubmitTieChoiceBallot = Readonly<{
  type: "SubmitTieChoiceBallot";
  playerId: PlayerAccountId;
  tieKind: TieChoiceKind;
  round: number;
  candidateId: TieChoiceCandidate;
}>;

export type TieChoiceBallotSubmitted = Readonly<{
  type: "TieChoiceBallotSubmitted";
  tieKind: TieChoiceKind;
  round: number;
  voterId: PlayerAccountId;
  candidateId: TieChoiceCandidate;
}>;

export type TieChoiceRecipientPair = Readonly<{
  giverId: PlayerAccountId;
  giverSeat: SeatIndex;
  recipientId: PlayerAccountId;
  recipientSeat: SeatIndex;
}>;

export type TieChoiceRevealedBallot = Readonly<{
  voterId: PlayerAccountId;
  candidateId: TieChoiceCandidate;
}>;

export type TieChoiceRoundResolved = Readonly<{
  type: "TieChoiceRoundResolved";
  tieKind: TieChoiceKind;
  round: number;
  ballots: readonly TieChoiceRevealedBallot[];
  committedPairs: readonly TieChoiceRecipientPair[];
  remainingVoterIds: readonly PlayerAccountId[];
  remainingCandidateIds: readonly PlayerAccountId[];
  fallback: boolean;
  selectedLeaderId?: PlayerAccountId;
}>;

export type Event =
  | RoomCreated
  | MemberJoined
  | MemberLeft
  | OwnerTransferred
  | SeatAssigned
  | SeatRemoved
  | ReadinessChanged
  | ReadinessCleared
  | SeatAssignmentsCleared
  | MatchRulesConfigurationReplaced
  | SeatingPolicyReplaced
  | MatchSelected
  | ChallengeHandSelected
  | MatchStarted
  | CardsPlayed
  | PlayerPassed
  | PlayerFinished
  | TurnAdvanced
  | LeadReset
  | HandResultDetermined
  | HandSettled
  | MatchCompleted
  | MatchAborted
  | ChallengeHandStarted
  | ChallengeHandCompleted
  | ChallengeHandAborted
  | RoomInterrupted
  | RoomArchived
  | HandStarted
  | TributeCardSelected
  | TributeTransferred
  | ReturnCandidatesOffered
  | ReturnTransferred
  | HandLeaderChosen
  | TieChoiceBallotSubmitted
  | TieChoiceRoundResolved;

export type JoinRoom = Readonly<{
  type: "JoinRoom";
  playerId: PlayerAccountId;
}>;

export type LeaveRoom = Readonly<{
  type: "LeaveRoom";
  playerId: PlayerAccountId;
}>;

export type AssignSeat = Readonly<{
  type: "AssignSeat";
  playerId: PlayerAccountId;
  seatIndex: SeatIndex;
}>;

export type RemoveSeat = Readonly<{
  type: "RemoveSeat";
  playerId: PlayerAccountId;
}>;

export type SetReadiness = Readonly<{
  type: "SetReadiness";
  playerId: PlayerAccountId;
  ready: boolean;
}>;

export type ReplaceMatchRulesConfiguration = Readonly<{
  type: "ReplaceMatchRulesConfiguration";
  playerId: PlayerAccountId;
  rulesConfiguration: RulesConfiguration;
}>;

export type ReplaceSeatingPolicy = Readonly<{
  type: "ReplaceSeatingPolicy";
  playerId: PlayerAccountId;
  seatingPolicy: SeatingPolicy;
}>;

export type SelectMatch = Readonly<{
  type: "SelectMatch";
  playerId: PlayerAccountId;
}>;

export type SelectChallengeHand = Readonly<{
  type: "SelectChallengeHand";
  playerId: PlayerAccountId;
  template: ChallengeTemplate;
}>;

/** Internal command submitted by the Room executor after its external presence check. */
export type StartMatch = Readonly<{
  type: "StartMatch";
  handSeed: HandSeed;
  randomnessVersion: RandomnessVersion;
  shuffleVersion: ShuffleVersion;
}>;

export type Play = Readonly<{
  type: "Play";
  playerId: PlayerAccountId;
  cards: readonly CardInstanceCode[];
}>;

export type Pass = Readonly<{
  type: "Pass";
  playerId: PlayerAccountId;
}>;

export type AbortMatch = Readonly<{
  type: "AbortMatch";
  playerId: PlayerAccountId;
}>;

export type StartChallengeHand = Readonly<{
  type: "StartChallengeHand";
}>;

export type AbortChallengeHand = Readonly<{
  type: "AbortChallengeHand";
  playerId: PlayerAccountId;
}>;

export type InterruptRoom = Readonly<{
  type: "InterruptRoom";
}>;

export type ArchiveRoom = Readonly<{
  type: "ArchiveRoom";
  playerId: PlayerAccountId;
}>;

/** Internal command submitted by the Room executor after the previous Hand settles. */
export type StartNextHand = Readonly<{
  type: "StartNextHand";
  handSeed: HandSeed;
  randomnessVersion: RandomnessVersion;
  shuffleVersion: ShuffleVersion;
}>;

export type SelectTributeCard = Readonly<{
  type: "SelectTributeCard";
  playerId: PlayerAccountId;
  card: CardInstanceCode;
}>;

export type OfferReturnCandidates = Readonly<{
  type: "OfferReturnCandidates";
  playerId: PlayerAccountId;
  candidateCards: readonly CardInstanceCode[];
}>;

export type SelectReturnCard = Readonly<{
  type: "SelectReturnCard";
  playerId: PlayerAccountId;
  card: CardInstanceCode;
}>;

export type Command =
  | JoinRoom
  | LeaveRoom
  | AssignSeat
  | RemoveSeat
  | SetReadiness
  | ReplaceMatchRulesConfiguration
  | ReplaceSeatingPolicy
  | SelectMatch
  | SelectChallengeHand
  | StartMatch
  | Play
  | Pass
  | AbortMatch
  | StartChallengeHand
  | AbortChallengeHand
  | InterruptRoom
  | ArchiveRoom
  | StartNextHand
  | SelectTributeCard
  | OfferReturnCandidates
  | SelectReturnCard
  | SubmitTieChoiceBallot;

export type RejectionReason =
  | "room-not-created"
  | "room-not-in-lobby"
  | "not-a-member"
  | "already-a-member"
  | "membership-capacity-reached"
  | "sole-owner-cannot-leave"
  | "owner-only"
  | "invalid-seat-index"
  | "seat-occupied"
  | "seat-unchanged"
  | "seat-not-assigned"
  | "member-must-be-seated"
  | "readiness-unchanged"
  | "ruleset-change-would-exceed-capacity"
  | "rules-configuration-unchanged"
  | "seating-policy-unchanged"
  | "match-already-selected"
  | "challenge-already-selected"
  | "challenge-not-selected"
  | "activity-kind-mismatch"
  | "challenge-template-invalid"
  | "challenge-ruleset-too-small"
  | "room-not-interrupted"
  | "room-archived"
  | "match-rules-configuration-locked"
  | "seating-policy-locked"
  | "start-requirements-not-met"
  | "invalid-hand-seed"
  | "room-not-active"
  | "hand-result-determined"
  | "hand-not-settled"
  | "hand-setup-incomplete"
  | "unsupported-randomness-version"
  | "unsupported-shuffle-version"
  | "tribute-card-not-eligible"
  | "not-pending-setup-actor"
  | "return-candidates-invalid"
  | "return-card-not-eligible"
  | "recipient-pairing-tie"
  | "leader-selection-tie"
  | "tie-choice-not-eligible"
  | "tie-choice-duplicate"
  | "tie-choice-stale"
  | "not-current-player"
  | "card-not-in-hand"
  | "pass-on-open-lead"
  | PlayRejectionReason;

export type Rejection = Readonly<{
  reason: RejectionReason;
}>;

export type Decision =
  | Readonly<{ ok: true; events: readonly Event[] }>
  | Readonly<{ ok: false; rejection: Rejection }>;

export type StartRequirements = Readonly<{
  playerIds: readonly PlayerAccountId[];
}>;

export type PlayerViewMember = Readonly<{
  playerId: PlayerAccountId;
  joinOrder: number;
  ready: boolean;
}>;

export type PlayerViewSeat = Readonly<{
  seatIndex: SeatIndex;
  playerId: PlayerAccountId | undefined;
}>;

export type PlayerViewPlay = Readonly<{
  playerId: PlayerAccountId;
  seatIndex: SeatIndex;
  cards: readonly CardInstanceCode[];
  form: PlayForm;
  rank: PlayRank;
  representedFaces: readonly CardFaceCode[];
  comparisonRanks: readonly PlayRank[];
}>;

export type PlayerViewHandResult = Readonly<{
  outcome: "win" | "draw";
  firstFinisherTeam: TeamIndex;
  winningTeam?: TeamIndex;
  nextDealerTeam: TeamIndex;
  caughtPlayerIds: readonly PlayerAccountId[];
}>;

export type PlayerViewMatchSummary =
  | Readonly<{
      outcome: "completed";
      winningTeam: TeamIndex;
      endingReason: "team-level-6" | "three-failure-limit-at-5";
      teamLevels: TeamLevels;
      completedHandCount: number;
    }>
  | Readonly<{
      outcome: "aborted";
      teamLevels: TeamLevels;
      completedHandCount: number;
    }>;

export type PlayerViewChallengeSummary = Readonly<{
  outcome: "completed";
  result: PlayerViewHandResult;
}>;

export type PlayerViewTributeTransfer = Readonly<{
  giverId: PlayerAccountId;
  giverSeat: SeatIndex;
  recipientId: PlayerAccountId;
  recipientSeat: SeatIndex;
  card: CardInstanceCode;
  rank: PlayRank;
}>;

export type PlayerViewReturnCandidates = Readonly<{
  giverId: PlayerAccountId;
  giverSeat: SeatIndex;
  recipientId: PlayerAccountId;
  recipientSeat: SeatIndex;
  tributeCard: CardInstanceCode;
  candidateCards: readonly CardInstanceCode[];
}>;

export type PlayerView = Readonly<{
  roomId: RoomId;
  lifecycle: Lifecycle;
  ownerId: PlayerAccountId;
  members: readonly PlayerViewMember[];
  seats: readonly PlayerViewSeat[];
  rulesConfiguration: RulesConfiguration;
  seatingPolicy: SeatingPolicy;
  matchRulesConfigurationLocked: boolean;
  seatingPolicyLocked: boolean;
  selectedActivity: SelectedActivity | undefined;
  effectiveRulesetId?: RulesetId;
  effectiveRulesConfiguration?: RulesConfiguration;
  dealerSeat?: SeatIndex;
  dealerTeam?: TeamIndex;
  teamLevels?: TeamLevels;
  trumpRank?: TrumpRank;
  failureCounters?: FailureCounters;
  completedHandCount?: number;
  matchSummary?: PlayerViewMatchSummary;
  challengeSummary?: PlayerViewChallengeSummary;
  handSizes?: readonly number[];
  hand?: readonly CardInstanceCode[];
  currentActor?: PlayerAccountId;
  currentActorSeat?: SeatIndex;
  unbeatenPlay?: PlayerViewPlay;
  passedPlayerIds?: readonly PlayerAccountId[];
  finishPositions?: readonly (number | undefined)[];
  handResult?: PlayerViewHandResult;
  setupStage?: SetupStage;
  tributeTransfers?: readonly PlayerViewTributeTransfer[];
  returnCandidates?: readonly PlayerViewReturnCandidates[];
  pendingPlayerIds?: readonly PlayerAccountId[];
  eligibleTributeCards?: readonly CardInstanceCode[];
  tieKind?: TieChoiceKind;
  tieRound?: number;
  tieVoterIds?: readonly PlayerAccountId[];
  tieCandidateIds?: readonly PlayerAccountId[];
  tieSubmittedPlayerIds?: readonly PlayerAccountId[];
  tieOwnBallot?: TieChoiceCandidate;
  tieResolvedRounds?: readonly TieChoiceRoundResolved[];
}>;

declare const STATE_BRAND: unique symbol;

/** The authoritative room state is intentionally opaque to callers. */
export type State = Readonly<{
  readonly [STATE_BRAND]: true;
}>;

type Member = Readonly<{
  playerId: PlayerAccountId;
  joinOrder: number;
}>;

type Seat = Readonly<{
  seatIndex: SeatIndex;
  playerId: PlayerAccountId;
}>;

type PlayerHand = Readonly<{
  playerId: PlayerAccountId;
  cards: readonly CardInstance[];
}>;

type ActivePlay = Readonly<{
  playerId: PlayerAccountId;
  seatIndex: SeatIndex;
  play: ClassifiedPlay;
}>;

type SetupGiver = Readonly<{
  playerId: PlayerAccountId;
  seatIndex: SeatIndex;
  rank: PlayRank;
  eligibleCards: readonly CardInstanceCode[];
}>;

type TributeSelection = Readonly<{
  giverSeat: SeatIndex;
  card: CardInstanceCode;
  rank: PlayRank;
}>;

type TributeTransferState = Readonly<{
  giverId: PlayerAccountId;
  giverSeat: SeatIndex;
  recipientId: PlayerAccountId;
  recipientSeat: SeatIndex;
  card: CardInstanceCode;
  rank: PlayRank;
}>;

type ReturnOfferState = Readonly<{
  giverId: PlayerAccountId;
  giverSeat: SeatIndex;
  recipientId: PlayerAccountId;
  recipientSeat: SeatIndex;
  tributeCard: CardInstanceCode;
  candidateCards: readonly CardInstanceCode[];
}>;

type ReturnTransferState = Readonly<{
  giverSeat: SeatIndex;
  recipientSeat: SeatIndex;
  tributeCard: CardInstanceCode;
  card: CardInstanceCode;
}>;

type TieChoiceState = Readonly<{
  tieKind: TieChoiceKind;
  round: number;
  voters: readonly PlayerAccountId[];
  candidates: readonly PlayerAccountId[];
  ballots: readonly TieChoiceRevealedBallot[];
}>;

type HandSetup = Readonly<{
  stage: SetupStage;
  firstFinisherSeat: SeatIndex;
  givers: readonly SetupGiver[];
  recipientSeats: readonly SeatIndex[];
  tributeSelections: readonly TributeSelection[];
  tributeTransfers: readonly TributeTransferState[];
  returnOffers: readonly ReturnOfferState[];
  returnTransfers: readonly ReturnTransferState[];
  tieChoice: TieChoiceState | undefined;
  resolvedTieRounds: readonly TieChoiceRoundResolved[];
}>;

type ActiveHand = Readonly<{
  handSeed: HandSeed;
  currentActorSeat: SeatIndex;
  unbeatenPlay: ActivePlay | undefined;
  passedSeats: readonly SeatIndex[];
  finishPositions: readonly (number | undefined)[];
  result: HandResultDetermined | undefined;
  setup: HandSetup;
}>;

type ActiveMatch = Readonly<{
  kind: SelectedActivity;
  rulesConfiguration: RulesConfiguration;
  dealerSeat: SeatIndex;
  dealerTeam: TeamIndex;
  teamLevels: TeamLevels;
  trumpRank: TrumpRank;
  failureCounters: FailureCounters;
  completedHandCount: number;
  hands: readonly PlayerHand[];
  hand: ActiveHand;
  summary: PlayerViewMatchSummary | undefined;
  challengeSummary: PlayerViewChallengeSummary | undefined;
}>;

type InternalState = {
  roomId: RoomId;
  lifecycle: Lifecycle;
  ownerId: PlayerAccountId;
  members: readonly Member[];
  seats: readonly Seat[];
  readyPlayerIds: readonly PlayerAccountId[];
  rulesConfiguration: RulesConfiguration;
  seatingPolicy: SeatingPolicy;
  matchRulesConfigurationLocked: boolean;
  seatingPolicyLocked: boolean;
  selectedActivity: SelectedActivity | undefined;
  challengeTemplate: ChallengeTemplate | undefined;
  nextJoinOrder: number;
  activeMatch: ActiveMatch | undefined;
};

function cloneRulesConfiguration(
  configuration: RulesConfiguration,
): RulesConfiguration {
  return { ...configuration };
}

function cloneChallengeTemplate(
  template: ChallengeTemplate,
): ChallengeTemplate {
  const setup =
    template.setup.kind === "initial-hand"
      ? { ...template.setup }
      : {
          ...template.setup,
          finishPositions: [...template.setup.finishPositions],
          result: {
            ...template.setup.result,
            caughtSeatIndices: [...template.setup.result.caughtSeatIndices],
          },
        };
  return {
    ...template,
    rulesConfiguration: cloneRulesConfiguration(template.rulesConfiguration),
    teamLevels: [...template.teamLevels] as [TeamLevel, TeamLevel],
    failureCounters: [...template.failureCounters] as [number, number],
    setup,
  };
}

function sameRulesConfiguration(
  left: RulesConfiguration,
  right: RulesConfiguration,
): boolean {
  if (left.rulesetId !== right.rulesetId) {
    return false;
  }

  const leftValues = left as unknown as Record<string, unknown>;
  const rightValues = right as unknown as Record<string, unknown>;
  return RULESET_DEFINITIONS[left.rulesetId].supportedRuleVariants.every(
    (variant) => leftValues[variant] === rightValues[variant],
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function cloneHandSetup(setup: HandSetup): HandSetup {
  return {
    ...setup,
    givers: setup.givers.map((giver) => ({
      ...giver,
      eligibleCards: [...giver.eligibleCards],
    })),
    recipientSeats: [...setup.recipientSeats],
    tributeSelections: setup.tributeSelections.map((selection) => ({
      ...selection,
    })),
    tributeTransfers: setup.tributeTransfers.map((transfer) => ({
      ...transfer,
    })),
    returnOffers: setup.returnOffers.map((offer) => ({
      ...offer,
      candidateCards: [...offer.candidateCards],
    })),
    returnTransfers: setup.returnTransfers.map((transfer) => ({
      ...transfer,
    })),
    tieChoice:
      setup.tieChoice === undefined
        ? undefined
        : {
            ...setup.tieChoice,
            voters: [...setup.tieChoice.voters],
            candidates: [...setup.tieChoice.candidates],
            ballots: setup.tieChoice.ballots.map((ballot) => ({ ...ballot })),
          },
    resolvedTieRounds: setup.resolvedTieRounds.map((round) => ({
      ...round,
      ballots: round.ballots.map((ballot) => ({ ...ballot })),
      committedPairs: round.committedPairs.map((pair) => ({ ...pair })),
      remainingVoterIds: [...round.remainingVoterIds],
      remainingCandidateIds: [...round.remainingCandidateIds],
    })),
  };
}

function makeState(value: InternalState): State {
  const activeMatch =
    value.activeMatch === undefined
      ? undefined
      : {
          ...value.activeMatch,
          rulesConfiguration: cloneRulesConfiguration(
            value.activeMatch.rulesConfiguration,
          ),
          teamLevels: [...value.activeMatch.teamLevels] as [
            TeamLevel,
            TeamLevel,
          ],
          failureCounters: [...value.activeMatch.failureCounters] as [
            number,
            number,
          ],
          summary:
            value.activeMatch.summary === undefined
              ? undefined
              : {
                  ...value.activeMatch.summary,
                  teamLevels: [...value.activeMatch.summary.teamLevels] as [
                    TeamLevel,
                    TeamLevel,
                  ],
                },
          challengeSummary:
            value.activeMatch.challengeSummary === undefined
              ? undefined
              : {
                  ...value.activeMatch.challengeSummary,
                  result: {
                    ...value.activeMatch.challengeSummary.result,
                    caughtPlayerIds: [
                      ...value.activeMatch.challengeSummary.result
                        .caughtPlayerIds,
                    ],
                  },
                },
          hands: value.activeMatch.hands.map((hand) => ({
            playerId: hand.playerId,
            cards: [...hand.cards],
          })),
          hand: {
            ...value.activeMatch.hand,
            setup: cloneHandSetup(value.activeMatch.hand.setup),
            passedSeats: [...value.activeMatch.hand.passedSeats],
            finishPositions: [...value.activeMatch.hand.finishPositions],
            result:
              value.activeMatch.hand.result === undefined
                ? undefined
                : {
                    ...value.activeMatch.hand.result,
                    caughtPlayerIds: [
                      ...value.activeMatch.hand.result.caughtPlayerIds,
                    ],
                  },
            unbeatenPlay:
              value.activeMatch.hand.unbeatenPlay === undefined
                ? undefined
                : {
                    ...value.activeMatch.hand.unbeatenPlay,
                    play: {
                      ...value.activeMatch.hand.unbeatenPlay.play,
                      cards: [
                        ...value.activeMatch.hand.unbeatenPlay.play.cards,
                      ],
                      representedFaces: [
                        ...value.activeMatch.hand.unbeatenPlay.play
                          .representedFaces,
                      ],
                      comparisonRanks: [
                        ...value.activeMatch.hand.unbeatenPlay.play
                          .comparisonRanks,
                      ],
                    },
                  },
          },
        };

  return deepFreeze({
    ...value,
    members: value.members.map((member) => ({ ...member })),
    seats: value.seats.map((seat) => ({ ...seat })),
    readyPlayerIds: [...value.readyPlayerIds],
    rulesConfiguration: cloneRulesConfiguration(value.rulesConfiguration),
    challengeTemplate:
      value.challengeTemplate === undefined
        ? undefined
        : cloneChallengeTemplate(value.challengeTemplate),
    activeMatch,
  }) as unknown as State;
}

function readState(state: State): InternalState {
  return state as unknown as InternalState;
}

function accepted(events: readonly Event[]): Decision {
  return {
    ok: true,
    events: deepFreeze(events.map((event) => cloneEvent(event))),
  };
}

function rejected(reason: RejectionReason): Decision {
  return { ok: false, rejection: { reason } };
}

function cloneEvent(event: Event): Event {
  if (event.type === "MatchRulesConfigurationReplaced") {
    return {
      ...event,
      rulesConfiguration: cloneRulesConfiguration(event.rulesConfiguration),
    };
  }

  if (event.type === "MatchStarted") {
    return {
      ...event,
      rulesConfiguration: cloneRulesConfiguration(event.rulesConfiguration),
      playerIds: [...event.playerIds],
      teamLevels: [...event.teamLevels] as [TeamLevel, TeamLevel],
      failureCounters: [...event.failureCounters] as [number, number],
    };
  }

  if (event.type === "ChallengeHandSelected") {
    return { ...event, template: cloneChallengeTemplate(event.template) };
  }

  if (event.type === "ChallengeHandStarted") {
    return {
      ...event,
      template: cloneChallengeTemplate(event.template),
      playerIds: [...event.playerIds],
    };
  }

  if (event.type === "ChallengeHandCompleted") {
    return { ...event, caughtPlayerIds: [...event.caughtPlayerIds] };
  }

  if (event.type === "HandStarted") {
    return {
      ...event,
      rulesConfiguration: cloneRulesConfiguration(event.rulesConfiguration),
      playerIds: [...event.playerIds],
      teamLevels: [...event.teamLevels] as [TeamLevel, TeamLevel],
      failureCounters: [...event.failureCounters] as [number, number],
    };
  }

  if (event.type === "CardsPlayed") {
    return {
      ...event,
      cards: [...event.cards],
      representedFaces: [...event.representedFaces],
      comparisonRanks: [...event.comparisonRanks],
    };
  }

  if (event.type === "ReturnCandidatesOffered") {
    return { ...event, candidateCards: [...event.candidateCards] };
  }

  if (event.type === "TieChoiceRoundResolved") {
    return {
      ...event,
      ballots: event.ballots.map((ballot) => ({ ...ballot })),
      committedPairs: event.committedPairs.map((pair) => ({ ...pair })),
      remainingVoterIds: [...event.remainingVoterIds],
      remainingCandidateIds: [...event.remainingCandidateIds],
    };
  }

  if (event.type === "HandResultDetermined") {
    return { ...event, caughtPlayerIds: [...event.caughtPlayerIds] };
  }

  if (event.type === "HandSettled") {
    return {
      ...event,
      teamLevels: [...event.teamLevels] as [TeamLevel, TeamLevel],
      failureCounters: [...event.failureCounters] as [number, number],
    };
  }

  if (event.type === "MatchCompleted" || event.type === "MatchAborted") {
    return {
      ...event,
      teamLevels: [...event.teamLevels] as [TeamLevel, TeamLevel],
    };
  }

  return event;
}

function isLobby(state: InternalState): boolean {
  return state.lifecycle === "LOBBY";
}

function effectiveRulesConfiguration(state: InternalState): RulesConfiguration {
  if (state.lifecycle === "ACTIVE" && state.activeMatch !== undefined) {
    return state.activeMatch.rulesConfiguration;
  }
  return state.selectedActivity === "challenge" &&
    state.challengeTemplate !== undefined
    ? state.challengeTemplate.rulesConfiguration
    : state.rulesConfiguration;
}

function effectiveRulesetId(state: InternalState): RulesetId {
  return effectiveRulesConfiguration(state).rulesetId;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function validRuleVariant(name: string, value: unknown): boolean {
  switch (name) {
    case "jokerPairComparison":
      return ["two-small-and-mixed-are-equal", "two-small-jokers-win"].includes(
        value as string,
      );
    case "wildcardRank":
      return ["weakest-rank", "strongest-rank"].includes(value as string);
    case "finishingWildcardInterpretation":
      return ["normal", "weakest-form-and-rank"].includes(value as string);
    case "flushTieBreaking":
      return ["highest-card-only", "descending-ranks"].includes(
        value as string,
      );
    case "nextHandLeader":
      return ["first-finisher", "highest-tribute"].includes(value as string);
    case "tributeCardSelection":
      return ["fair-random", "giver-choice"].includes(value as string);
    case "returnCardSelection":
      return ["recipient-choice", "giver-choice-from-candidates"].includes(
        value as string,
      );
    case "tributeRecipientPairing":
      return [
        "finish-position-by-tribute-rank",
        "adjacent-first-automatic",
      ].includes(value as string);
    case "matchEnding":
      return ["no-failure-limit-at-5", "three-failure-limit-at-5"].includes(
        value as string,
      );
    default:
      return false;
  }
}

function validRulesConfiguration(
  configuration: unknown,
): configuration is RulesConfiguration {
  if (
    typeof configuration !== "object" ||
    configuration === null ||
    Array.isArray(configuration)
  ) {
    return false;
  }
  const values = configuration as Readonly<Record<string, unknown>>;
  const rulesetId = values.rulesetId;
  if (rulesetId !== "dglz-4p-2d-v1" && rulesetId !== "dglz-6p-3d-v1") {
    return false;
  }
  const variants = RULESET_DEFINITIONS[rulesetId].supportedRuleVariants;
  return (
    hasExactKeys(values, ["rulesetId", ...variants]) &&
    variants.every((variant) => validRuleVariant(variant, values[variant]))
  );
}

export function isChallengeTemplate(
  value: unknown,
): value is ChallengeTemplate {
  const template = value as ChallengeTemplate;
  if (
    typeof template !== "object" ||
    template === null ||
    Array.isArray(template)
  ) {
    return false;
  }
  const values = template as unknown as Readonly<Record<string, unknown>>;
  if (
    typeof template.handSeed !== "string" ||
    !validRulesConfiguration(template.rulesConfiguration) ||
    !Array.isArray(template.teamLevels) ||
    template.teamLevels.length !== 2 ||
    !Array.isArray(template.failureCounters) ||
    template.failureCounters.length !== 2 ||
    typeof template.setup !== "object" ||
    template.setup === null
  ) {
    return false;
  }
  if (
    !hasExactKeys(values, [
      "rulesetId",
      "rulesConfiguration",
      "handSeed",
      "randomnessVersion",
      "shuffleVersion",
      "dealerTeam",
      "teamLevels",
      "failureCounters",
      "trumpRank",
      "setup",
    ])
  ) {
    return false;
  }
  if (
    template.handSeed.length === 0 ||
    template.randomnessVersion !== RANDOMNESS_VERSION ||
    template.shuffleVersion !== SHUFFLE_VERSION ||
    template.rulesConfiguration.rulesetId !== template.rulesetId
  ) {
    return false;
  }

  const definition = RULESET_DEFINITIONS[template.rulesetId];
  if (
    template.teamLevels.some(
      (level) => !["2", "3", "4", "5", "6"].includes(level),
    ) ||
    template.failureCounters.some(
      (counter) => !Number.isInteger(counter) || counter < 0,
    )
  ) {
    return false;
  }

  if (
    !["2", "3", "4", "5"].includes(template.trumpRank) ||
    (template.dealerTeam !== 0 && template.dealerTeam !== 1) ||
    template.trumpRank !== template.teamLevels[template.dealerTeam]
  ) {
    return false;
  }

  if (template.setup.kind === "initial-hand") {
    return (
      hasExactKeys(template.setup as Readonly<Record<string, unknown>>, [
        "kind",
        "dealerSeat",
      ]) &&
      validSeatIndex(template.rulesetId, template.setup.dealerSeat) &&
      template.dealerTeam === template.setup.dealerSeat % 2
    );
  }

  if (template.setup.kind !== "subsequent-hand") return false;
  if (
    !hasExactKeys(template.setup as Readonly<Record<string, unknown>>, [
      "kind",
      "finishPositions",
      "result",
    ])
  ) {
    return false;
  }

  if (
    !Array.isArray(template.setup.finishPositions) ||
    template.setup.finishPositions.length !== definition.playerCount
  ) {
    return false;
  }
  const positions = template.setup.finishPositions.filter(
    (position): position is number => position !== undefined,
  );
  if (
    positions.some(
      (position) =>
        !Number.isInteger(position) ||
        position < 1 ||
        position > definition.playerCount,
    ) ||
    new Set(positions).size !== positions.length ||
    [...positions]
      .sort((left, right) => left - right)
      .some((position, index) => position !== index + 1)
  ) {
    return false;
  }
  const result = template.setup.result;
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return false;
  }
  const resultValues = result as unknown as Readonly<Record<string, unknown>>;
  const requiredResultKeys = [
    "outcome",
    "firstFinisherTeam",
    "nextDealerTeam",
    "caughtSeatIndices",
  ];
  const resultKeys = Object.keys(resultValues);
  if (
    requiredResultKeys.some(
      (key) => !Object.prototype.hasOwnProperty.call(resultValues, key),
    ) ||
    resultKeys.some(
      (key) => ![...requiredResultKeys, "winningTeam"].includes(key),
    )
  ) {
    return false;
  }
  const firstFinisherSeat = template.setup.finishPositions.findIndex(
    (position) => position === 1,
  );
  if (
    firstFinisherSeat < 0 ||
    (result.firstFinisherTeam !== 0 && result.firstFinisherTeam !== 1) ||
    result.firstFinisherTeam !== firstFinisherSeat % 2 ||
    result.nextDealerTeam !== result.firstFinisherTeam ||
    template.dealerTeam !== result.nextDealerTeam
  ) {
    return false;
  }
  if (
    !Array.isArray(result.caughtSeatIndices) ||
    new Set(result.caughtSeatIndices).size !==
      result.caughtSeatIndices.length ||
    result.caughtSeatIndices.some(
      (seatIndex) => !validSeatIndex(template.rulesetId, seatIndex),
    )
  ) {
    return false;
  }
  const firstTeamFinished = template.setup.finishPositions.every(
    (position, seatIndex) =>
      seatIndex % 2 !== result.firstFinisherTeam || position !== undefined,
  );
  const otherTeamFinished = template.setup.finishPositions.every(
    (position, seatIndex) =>
      seatIndex % 2 === result.firstFinisherTeam || position !== undefined,
  );
  if (result.outcome === "draw") {
    return (
      result.winningTeam === undefined &&
      !firstTeamFinished &&
      otherTeamFinished &&
      result.caughtSeatIndices.length === 0
    );
  }
  if (result.outcome !== "win") return false;
  const expectedCaughtSeats = template.setup.finishPositions.flatMap(
    (position, seatIndex) =>
      position === undefined && seatIndex % 2 !== result.firstFinisherTeam
        ? [seatIndex]
        : [],
  );
  return (
    result.winningTeam === result.firstFinisherTeam &&
    firstTeamFinished &&
    !otherTeamFinished &&
    expectedCaughtSeats.length === result.caughtSeatIndices.length &&
    expectedCaughtSeats.every(
      (seatIndex, index) => result.caughtSeatIndices[index] === seatIndex,
    )
  );
}

function findMember(
  state: InternalState,
  playerId: PlayerAccountId,
): Member | undefined {
  return state.members.find((member) => member.playerId === playerId);
}

function findSeat(
  state: InternalState,
  playerId: PlayerAccountId,
): Seat | undefined {
  return state.seats.find((seat) => seat.playerId === playerId);
}

function hasReady(state: InternalState, playerId: PlayerAccountId): boolean {
  return state.readyPlayerIds.includes(playerId);
}

function validSeatIndex(rulesetId: RulesetId, seatIndex: number): boolean {
  const definition = RULESET_DEFINITIONS[rulesetId];
  return (
    Number.isInteger(seatIndex) &&
    seatIndex >= 0 &&
    seatIndex < definition.playerCount
  );
}

function requireLobbyMember(
  state: InternalState | undefined,
  playerId: PlayerAccountId,
): RejectionReason | undefined {
  if (state === undefined) {
    return "room-not-created";
  }

  if (!isLobby(state)) {
    return "room-not-in-lobby";
  }

  if (findMember(state, playerId) === undefined) {
    return "not-a-member";
  }

  return undefined;
}

const UINT64_MASK = (1n << 64n) - 1n;
const UINT64_RANGE = 1n << 64n;
const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const SPLIT_MIX_GAMMA = 0x9e3779b97f4a7c15n;
const SPLIT_MIX_MULTIPLIER_1 = 0xbf58476d1ce4e5b9n;
const SPLIT_MIX_MULTIPLIER_2 = 0x94d049bb133111ebn;

function fnv1a64(value: string): bigint {
  let hash = FNV64_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV64_PRIME) & UINT64_MASK;
  }
  return hash;
}

function makeRandomStream(
  handSeed: HandSeed,
  rulesetId: RulesetId,
  domain: string,
): () => bigint {
  let state = fnv1a64(`${handSeed}/${rulesetId}/${domain}`);
  return () => {
    state = (state + SPLIT_MIX_GAMMA) & UINT64_MASK;
    let value = state;
    value = ((value ^ (value >> 30n)) * SPLIT_MIX_MULTIPLIER_1) & UINT64_MASK;
    value = ((value ^ (value >> 27n)) * SPLIT_MIX_MULTIPLIER_2) & UINT64_MASK;
    return (value ^ (value >> 31n)) & UINT64_MASK;
  };
}

function boundedChoice(nextUint64: () => bigint, bound: number): number {
  if (!Number.isSafeInteger(bound) || bound <= 0) {
    throw new Error("Random choice bound must be a positive safe integer");
  }

  const boundBigInt = BigInt(bound);
  const limit = UINT64_RANGE - (UINT64_RANGE % boundBigInt);
  let value = nextUint64();
  while (value >= limit) {
    value = nextUint64();
  }
  return Number(value % boundBigInt);
}

function shuffled<T>(values: readonly T[], nextUint64: () => bigint): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = boundedChoice(nextUint64, index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

const STANDARD_RANKS = [
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
] as const;
const SUITS = ["S", "H", "D", "C"] as const;
const JOKER_RANKS = ["SMALL", "BIG"] as const;

function buildDeck(rulesetId: RulesetId): CardInstance[] {
  const deckCount = RULESET_DEFINITIONS[rulesetId].deckCount;
  const cards: CardInstance[] = [];
  const addCard = (code: string) => {
    const decoded = decodeCardInstance(code);
    if (!decoded.ok) {
      throw new Error("Built an invalid card instance");
    }
    cards.push(decoded.card);
  };

  for (let copyNumber = 1; copyNumber <= deckCount; copyNumber += 1) {
    for (const rank of STANDARD_RANKS) {
      for (const suit of SUITS) {
        addCard(`${rank}${suit}#${copyNumber}`);
      }
    }
    for (const jokerRank of JOKER_RANKS) {
      addCard(`${jokerRank}#${copyNumber}`);
    }
  }

  return cards;
}

type HandDealInput = Readonly<{
  handSeed: HandSeed;
  rulesetId: RulesetId;
  playerIds: readonly PlayerAccountId[];
}>;

function dealHands(event: HandDealInput): PlayerHand[] {
  const nextDeckValue = makeRandomStream(
    event.handSeed,
    event.rulesetId,
    "deck",
  );
  const deck = shuffled(buildDeck(event.rulesetId), nextDeckValue);
  const hands = event.playerIds.map((playerId) => ({
    playerId,
    cards: [] as CardInstance[],
  }));

  for (const [cardIndex, card] of deck.entries()) {
    const hand = hands[cardIndex % hands.length];
    if (hand === undefined) {
      throw new Error("Cannot deal a deck without players");
    }
    hand.cards.push(card);
  }

  return hands;
}

function tributeRankStrength(rank: PlayRank, trumpRank: TrumpRank): number {
  if (rank === "BIG") return 16;
  if (rank === "SMALL") return 15;
  if (rank === trumpRank) return 14;
  return STANDARD_RANKS.indexOf(rank as (typeof STANDARD_RANKS)[number]);
}

function cardTributeRank(card: CardInstance): PlayRank {
  return card.face.rank;
}

function tributeEligibleCards(
  hand: PlayerHand,
  rulesetId: RulesetId,
  trumpRank: TrumpRank,
): { rank: PlayRank; cards: readonly CardInstance[] } | undefined {
  const candidates =
    rulesetId === "dglz-4p-2d-v1"
      ? hand.cards.filter((card) => card.face.kind === "suited")
      : hand.cards;
  if (candidates.length === 0) return undefined;

  const rank = candidates.reduce(
    (highest, card) =>
      tributeRankStrength(cardTributeRank(card), trumpRank) >
      tributeRankStrength(highest, trumpRank)
        ? cardTributeRank(card)
        : highest,
    cardTributeRank(candidates[0]!),
  );
  return {
    rank,
    cards: candidates.filter((card) => cardTributeRank(card) === rank),
  };
}

function tributeRankCompare(
  left: PlayRank,
  right: PlayRank,
  trumpRank: TrumpRank,
): number {
  return (
    tributeRankStrength(left, trumpRank) - tributeRankStrength(right, trumpRank)
  );
}

function setupForNextHand(
  previous: ActiveMatch,
  hands: readonly PlayerHand[],
  rulesetId: RulesetId,
  trumpRank: TrumpRank,
): HandSetup {
  const previousResult = previous.hand.result;
  const firstFinisherSeat = Math.max(
    0,
    previous.hand.finishPositions.findIndex((position) => position === 1),
  );
  const caughtIds = new Set(previousResult?.caughtPlayerIds ?? []);
  const givers: SetupGiver[] = [];
  for (const [seatIndex, hand] of hands.entries()) {
    if (!caughtIds.has(hand.playerId)) continue;
    const eligible = tributeEligibleCards(hand, rulesetId, trumpRank);
    if (eligible === undefined) continue;
    givers.push({
      playerId: hand.playerId,
      seatIndex,
      rank: eligible.rank,
      eligibleCards: eligible.cards.map((card) => card.code),
    });
  }

  const recipientSeats: SeatIndex[] = [];
  const winningTeam = previousResult?.winningTeam;
  if (winningTeam !== undefined) {
    const wanted = givers.length;
    hands
      .map((hand, seatIndex) => ({
        hand,
        seatIndex,
        finishPosition: previous.hand.finishPositions[seatIndex],
      }))
      .filter(
        (entry) =>
          entry.seatIndex % 2 === winningTeam &&
          entry.finishPosition !== undefined,
      )
      .sort((left, right) => left.finishPosition! - right.finishPosition!)
      .slice(0, wanted)
      .forEach((entry) => recipientSeats.push(entry.seatIndex));
  }

  return {
    stage: givers.length === 0 ? "play" : "tribute-selection",
    firstFinisherSeat,
    givers,
    recipientSeats,
    tributeSelections: [],
    tributeTransfers: [],
    returnOffers: [],
    returnTransfers: [],
    tieChoice: undefined,
    resolvedTieRounds: [],
  };
}

function initialHandSetup(dealerSeat: SeatIndex): HandSetup {
  return {
    stage: "play",
    firstFinisherSeat: dealerSeat,
    givers: [],
    recipientSeats: [],
    tributeSelections: [],
    tributeTransfers: [],
    returnOffers: [],
    returnTransfers: [],
    tieChoice: undefined,
    resolvedTieRounds: [],
  };
}

function setupForChallengeTemplate(
  template: ChallengeTemplate,
  hands: readonly PlayerHand[],
): HandSetup {
  if (template.setup.kind === "initial-hand") {
    return initialHandSetup(template.setup.dealerSeat);
  }

  const result = template.setup.result;
  const firstFinisherSeat = template.setup.finishPositions.findIndex(
    (position) => position === 1,
  );
  const previous: ActiveMatch = {
    kind: "challenge",
    rulesConfiguration: template.rulesConfiguration,
    dealerSeat: firstFinisherSeat < 0 ? 0 : firstFinisherSeat,
    dealerTeam: result.nextDealerTeam,
    teamLevels: template.teamLevels,
    trumpRank: template.trumpRank,
    failureCounters: template.failureCounters,
    completedHandCount: 0,
    hands,
    hand: {
      handSeed: template.handSeed,
      currentActorSeat: firstFinisherSeat < 0 ? 0 : firstFinisherSeat,
      unbeatenPlay: undefined,
      passedSeats: [],
      finishPositions: [...template.setup.finishPositions],
      result: {
        type: "HandResultDetermined",
        outcome: result.outcome,
        firstFinisherTeam: result.firstFinisherTeam,
        ...(result.winningTeam === undefined
          ? {}
          : { winningTeam: result.winningTeam }),
        nextDealerTeam: result.nextDealerTeam,
        caughtPlayerIds: result.caughtSeatIndices.flatMap((seatIndex) =>
          hands[seatIndex] === undefined ? [] : [hands[seatIndex]!.playerId],
        ),
      },
      setup: initialHandSetup(firstFinisherSeat < 0 ? 0 : firstFinisherSeat),
    },
    summary: undefined,
    challengeSummary: undefined,
  };
  return setupForNextHand(
    previous,
    hands,
    template.rulesetId,
    template.trumpRank,
  );
}

type TributeRankGroup = Readonly<{
  givers: readonly SetupGiver[];
  recipientSeats: readonly SeatIndex[];
}>;

function tributeRankGroups(
  state: InternalState,
  setup: HandSetup,
): TributeRankGroup[] {
  const activeMatch = state.activeMatch;
  if (
    activeMatch === undefined ||
    setup.tributeSelections.length !== setup.givers.length
  ) {
    return [];
  }

  const ordered = [...setup.givers].sort((left, right) =>
    tributeRankCompare(right.rank, left.rank, activeMatch.trumpRank),
  );
  const groups: TributeRankGroup[] = [];
  let giverIndex = 0;
  let recipientIndex = 0;
  while (giverIndex < ordered.length) {
    const rank = ordered[giverIndex]!.rank;
    const givers: SetupGiver[] = [];
    while (
      giverIndex < ordered.length &&
      tributeRankCompare(
        ordered[giverIndex]!.rank,
        rank,
        activeMatch.trumpRank,
      ) === 0
    ) {
      givers.push(ordered[giverIndex]!);
      giverIndex += 1;
    }
    groups.push({
      givers,
      recipientSeats: setup.recipientSeats.slice(
        recipientIndex,
        recipientIndex + givers.length,
      ),
    });
    recipientIndex += givers.length;
  }
  return groups;
}

function recipientTieGroup(
  state: InternalState,
  setup: HandSetup,
): TributeRankGroup | undefined {
  if (
    effectiveRulesConfiguration(state).tributeRecipientPairing !==
    "finish-position-by-tribute-rank"
  ) {
    return undefined;
  }

  for (const group of tributeRankGroups(state, setup)) {
    const unresolvedGivers = group.givers.filter(
      (giver) => !hasTributeTransfer(setup, giver.seatIndex),
    );
    const availableRecipients = group.recipientSeats.filter(
      (seatIndex) =>
        !setup.tributeTransfers.some(
          (transfer) => transfer.recipientSeat === seatIndex,
        ),
    );
    if (unresolvedGivers.length > 1 && availableRecipients.length > 1) {
      return {
        givers: unresolvedGivers,
        recipientSeats: availableRecipients,
      };
    }
  }
  return undefined;
}

function recipientTieState(
  state: InternalState,
  setup: HandSetup,
): TieChoiceState | undefined {
  const group = recipientTieGroup(state, setup);
  if (group === undefined) return undefined;
  const activeMatch = state.activeMatch;
  if (activeMatch === undefined) return undefined;
  const candidates = group.recipientSeats
    .map((seatIndex) => playerAtSeat(activeMatch, seatIndex))
    .filter((playerId): playerId is PlayerAccountId => playerId !== undefined);
  if (candidates.length !== group.givers.length) return undefined;
  return {
    tieKind: "recipient-pairing",
    round: 1,
    voters: group.givers.map((giver) => giver.playerId),
    candidates,
    ballots: [],
  };
}

function highestTributeGivers(
  activeMatch: ActiveMatch,
  setup: HandSetup,
): SetupGiver[] {
  if (setup.givers.length === 0) return [];
  const highest = setup.givers.reduce(
    (best, giver) =>
      tributeRankCompare(giver.rank, best.rank, activeMatch.trumpRank) > 0
        ? giver
        : best,
    setup.givers[0]!,
  );
  return setup.givers.filter(
    (giver) =>
      tributeRankCompare(giver.rank, highest.rank, activeMatch.trumpRank) === 0,
  );
}

function leaderTieState(
  state: InternalState,
  setup: HandSetup,
): TieChoiceState | undefined {
  if (
    effectiveRulesConfiguration(state).nextHandLeader !== "highest-tribute" ||
    setup.givers.length < 2
  ) {
    return undefined;
  }
  const activeMatch = state.activeMatch;
  if (activeMatch === undefined) return undefined;
  const tied = highestTributeGivers(activeMatch, setup);
  if (tied.length < 2) return undefined;
  return {
    tieKind: "leader-selection",
    round: 1,
    voters: tied.map((giver) => giver.playerId),
    candidates: tied.map((giver) => giver.playerId),
    ballots: [],
  };
}

function selectedTribute(
  setup: HandSetup,
  giverSeat: SeatIndex,
): TributeSelection | undefined {
  return setup.tributeSelections.find(
    (selection) => selection.giverSeat === giverSeat,
  );
}

function hasTributeTransfer(setup: HandSetup, giverSeat: SeatIndex): boolean {
  return setup.tributeTransfers.some(
    (transfer) => transfer.giverSeat === giverSeat,
  );
}

function pendingResolvedRecipientPairs(
  setup: HandSetup,
): TieChoiceRecipientPair[] {
  return setup.resolvedTieRounds
    .flatMap((round) => round.committedPairs)
    .filter(
      (pair) =>
        !setup.tributeTransfers.some(
          (transfer) =>
            transfer.giverSeat === pair.giverSeat &&
            transfer.recipientSeat === pair.recipientSeat,
        ),
    );
}

function tributeTransferEvents(state: InternalState): TributeTransferred[] {
  const activeMatch = state.activeMatch;
  if (activeMatch === undefined) return [];
  const setup = activeMatch.hand.setup;
  if (setup.tributeSelections.length !== setup.givers.length) return [];

  const availableRecipients = new Set(
    setup.recipientSeats.filter(
      (seatIndex) =>
        !setup.tributeTransfers.some(
          (transfer) => transfer.recipientSeat === seatIndex,
        ),
    ),
  );
  const pairs: Array<{
    giver: SetupGiver;
    recipientSeat: SeatIndex;
  }> = [];

  if (
    effectiveRulesConfiguration(state).tributeRecipientPairing ===
    "adjacent-first-automatic"
  ) {
    for (const giver of setup.givers) {
      if (hasTributeTransfer(setup, giver.seatIndex)) continue;
      const precedingSeat =
        (giver.seatIndex - 1 + activeMatch.hands.length) %
        activeMatch.hands.length;
      if (availableRecipients.delete(precedingSeat)) {
        pairs.push({ giver, recipientSeat: precedingSeat });
      }
    }

    const remainingGivers = setup.givers.filter(
      (giver) =>
        !hasTributeTransfer(setup, giver.seatIndex) &&
        !pairs.some((pair) => pair.giver.seatIndex === giver.seatIndex),
    );
    const remainingRecipients = [...availableRecipients];
    if (remainingGivers.length === remainingRecipients.length) {
      remainingGivers.forEach((giver, index) => {
        const recipientSeat = remainingRecipients[index];
        if (recipientSeat !== undefined) pairs.push({ giver, recipientSeat });
      });
    }
  } else {
    for (const group of tributeRankGroups(state, setup)) {
      const givers = group.givers.filter(
        (giver) => !hasTributeTransfer(setup, giver.seatIndex),
      );
      const recipients = group.recipientSeats.filter((seatIndex) =>
        availableRecipients.has(seatIndex),
      );
      if (givers.length === 1 && recipients.length === 1) {
        pairs.push({ giver: givers[0]!, recipientSeat: recipients[0]! });
        availableRecipients.delete(recipients[0]!);
      }
    }
  }

  return pairs.flatMap(({ giver, recipientSeat }) => {
    const recipient = handAtSeat(activeMatch, recipientSeat);
    const selection = selectedTribute(setup, giver.seatIndex);
    if (recipient === undefined || selection === undefined) return [];
    return [
      {
        type: "TributeTransferred",
        giverId: giver.playerId,
        giverSeat: giver.seatIndex,
        recipientId: recipient.playerId,
        recipientSeat,
        card: selection.card,
        rank: giver.rank,
      },
    ];
  });
}

function allTributesTransferred(setup: HandSetup): boolean {
  return setup.tributeTransfers.length === setup.givers.length;
}

function allReturnsTransferred(setup: HandSetup): boolean {
  return setup.returnTransfers.length === setup.tributeTransfers.length;
}

function leaderEvent(state: InternalState): HandLeaderChosen | undefined {
  const activeMatch = state.activeMatch;
  if (activeMatch === undefined) return undefined;
  const setup = activeMatch.hand.setup;
  if (!allTributesTransferred(setup) || !allReturnsTransferred(setup)) {
    return undefined;
  }

  let leaderSeat = setup.firstFinisherSeat;
  if (
    effectiveRulesConfiguration(state).nextHandLeader === "highest-tribute" &&
    setup.givers.length > 0
  ) {
    const tied = highestTributeGivers(activeMatch, setup);
    if (tied.length > 1) return undefined;
    leaderSeat = tied[0]!.seatIndex;
  }

  const playerId = playerAtSeat(activeMatch, leaderSeat);
  return playerId === undefined
    ? undefined
    : { type: "HandLeaderChosen", playerId, seatIndex: leaderSeat };
}

function startPlayerIds(state: InternalState): PlayerAccountId[] | undefined {
  if (!isLobby(state) || state.selectedActivity === undefined) {
    return undefined;
  }

  const seatCount = RULESET_DEFINITIONS[effectiveRulesetId(state)].playerCount;
  const playerIds: PlayerAccountId[] = [];
  for (let seatIndex = 0; seatIndex < seatCount; seatIndex += 1) {
    const assignment = state.seats.find((seat) => seat.seatIndex === seatIndex);
    if (assignment === undefined || !hasReady(state, assignment.playerId)) {
      return undefined;
    }
    playerIds.push(assignment.playerId);
  }
  return playerIds;
}

function foldAcceptedState(
  state: InternalState,
  events: readonly Event[],
): InternalState {
  let next = state as unknown as State;
  for (const event of events) next = evolve(next, event);
  return readState(next);
}

function decideStartNextHand(
  state: InternalState,
  command: StartNextHand,
): Decision {
  if (state.lifecycle !== "ACTIVE" || state.activeMatch === undefined) {
    return rejected("room-not-active");
  }
  if (state.activeMatch.kind !== "match") {
    return rejected("activity-kind-mismatch");
  }
  if (state.activeMatch.hand.result === undefined) {
    return rejected("hand-not-settled");
  }
  if (command.handSeed.length === 0) {
    return rejected("invalid-hand-seed");
  }
  if (command.randomnessVersion !== RANDOMNESS_VERSION) {
    return rejected("unsupported-randomness-version");
  }
  if (command.shuffleVersion !== SHUFFLE_VERSION) {
    return rejected("unsupported-shuffle-version");
  }

  const handNumber = state.activeMatch.completedHandCount + 1;
  const event: HandStarted = {
    type: "HandStarted",
    handNumber,
    rulesetId: state.activeMatch.rulesConfiguration.rulesetId,
    rulesConfiguration: state.activeMatch.rulesConfiguration,
    seatingPolicy: state.seatingPolicy,
    playerIds: state.activeMatch.hands.map((hand) => hand.playerId),
    dealerTeam: state.activeMatch.hand.result.nextDealerTeam,
    teamLevels: state.activeMatch.teamLevels,
    failureCounters: state.activeMatch.failureCounters,
    trumpRank: state.activeMatch.teamLevels[
      state.activeMatch.hand.result.nextDealerTeam
    ] as TrumpRank,
    handSeed: command.handSeed,
    randomnessVersion: command.randomnessVersion,
    shuffleVersion: command.shuffleVersion,
  };
  const events: Event[] = [event];
  let candidate = foldAcceptedState(state, events);
  const activeHand = candidate.activeMatch!.hand;
  if (activeHand.setup.givers.length === 0) {
    const leader = leaderEvent(candidate);
    if (leader !== undefined) events.push(leader);
    return accepted(events);
  }

  if (
    state.activeMatch.rulesConfiguration.tributeCardSelection === "fair-random"
  ) {
    for (const giver of activeHand.setup.givers) {
      const index = boundedChoice(
        makeRandomStream(
          command.handSeed,
          state.activeMatch.rulesConfiguration.rulesetId,
          `tribute-card/${giver.seatIndex}`,
        ),
        giver.eligibleCards.length,
      );
      events.push({
        type: "TributeCardSelected",
        giverId: giver.playerId,
        giverSeat: giver.seatIndex,
        card: giver.eligibleCards[index]!,
        rank: giver.rank,
      });
    }
    candidate = foldAcceptedState(candidate, events.slice(1));
    const transfers = tributeTransferEvents(candidate);
    events.push(...transfers);
  }

  return accepted(events);
}

function activeSetup(state: InternalState): ActiveMatch | undefined {
  return state.lifecycle === "ACTIVE" ? state.activeMatch : undefined;
}

function pendingReturn(activeMatch: ActiveMatch):
  | {
      transfer: TributeTransferState;
      offer: ReturnOfferState | undefined;
    }
  | undefined {
  const setup = activeMatch.hand.setup;
  const transfer = setup.tributeTransfers.find(
    (candidate) =>
      !setup.returnTransfers.some(
        (returned) =>
          returned.giverSeat === candidate.giverSeat &&
          returned.recipientSeat === candidate.recipientSeat,
      ),
  );
  if (transfer === undefined) return undefined;
  return {
    transfer,
    offer: setup.returnOffers.find(
      (candidate) =>
        candidate.giverSeat === transfer.giverSeat &&
        candidate.recipientSeat === transfer.recipientSeat,
    ),
  };
}

function decideSelectTributeCard(
  state: InternalState,
  command: SelectTributeCard,
): Decision {
  const activeMatch = activeSetup(state);
  if (activeMatch === undefined) return rejected("room-not-active");
  if (findMember(state, command.playerId) === undefined) {
    return rejected("not-a-member");
  }
  if (activeMatch.hand.result !== undefined) {
    return rejected("hand-result-determined");
  }
  if (activeMatch.hand.setup.stage !== "tribute-selection") {
    return rejected(
      activeMatch.hand.setup.stage === "recipient-pairing-tie"
        ? "recipient-pairing-tie"
        : activeMatch.hand.setup.stage === "leader-selection-tie"
          ? "leader-selection-tie"
          : "hand-setup-incomplete",
    );
  }
  const giver = activeMatch.hand.setup.givers.find(
    (candidate) => candidate.playerId === command.playerId,
  );
  if (giver === undefined) return rejected("not-pending-setup-actor");
  if (selectedTribute(activeMatch.hand.setup, giver.seatIndex) !== undefined) {
    return rejected("not-pending-setup-actor");
  }
  if (!giver.eligibleCards.includes(command.card)) {
    return rejected("tribute-card-not-eligible");
  }

  const events: Event[] = [
    {
      type: "TributeCardSelected",
      giverId: giver.playerId,
      giverSeat: giver.seatIndex,
      card: command.card,
      rank: giver.rank,
    },
  ];
  const candidate = foldAcceptedState(state, events);
  events.push(...tributeTransferEvents(candidate));
  return accepted(events);
}

function returnSelectionConfiguration(
  configuration: RulesConfiguration,
): "recipient-choice" | "giver-choice-from-candidates" {
  return configuration.rulesetId === "dglz-6p-3d-v1"
    ? configuration.returnCardSelection
    : "recipient-choice";
}

function decideOfferReturnCandidates(
  state: InternalState,
  command: OfferReturnCandidates,
): Decision {
  const activeMatch = activeSetup(state);
  if (activeMatch === undefined) return rejected("room-not-active");
  if (findMember(state, command.playerId) === undefined) {
    return rejected("not-a-member");
  }
  if (activeMatch.hand.setup.stage !== "return-card-selection") {
    return rejected("hand-setup-incomplete");
  }
  const pending = pendingReturn(activeMatch);
  if (pending === undefined || pending.offer !== undefined) {
    return rejected("not-pending-setup-actor");
  }
  const { transfer } = pending;
  const selection = returnSelectionConfiguration(
    activeMatch.rulesConfiguration,
  );
  if (selection !== "giver-choice-from-candidates") {
    return rejected("return-candidates-invalid");
  }
  const tribute = decodeCardInstance(transfer.card);
  if (!tribute.ok || tribute.card.face.kind !== "joker") {
    return rejected("return-candidates-invalid");
  }
  const expectedCount = tribute.card.face.rank === "SMALL" ? 2 : 3;
  if (command.playerId !== transfer.recipientId) {
    return rejected("not-pending-setup-actor");
  }
  if (command.candidateCards.length !== expectedCount) {
    return rejected("return-candidates-invalid");
  }
  if (new Set(command.candidateCards).size !== expectedCount) {
    return rejected("return-candidates-invalid");
  }
  const recipientHand = handAtSeat(activeMatch, transfer.recipientSeat);
  if (recipientHand === undefined) return rejected("return-candidates-invalid");
  const candidates = command.candidateCards.map((code) =>
    recipientHand.cards.find((card) => card.code === code),
  );
  if (candidates.some((card) => card === undefined)) {
    return rejected("return-candidates-invalid");
  }
  if (
    new Set(candidates.map((card) => card!.face.rank)).size !== expectedCount
  ) {
    return rejected("return-candidates-invalid");
  }
  return accepted([
    {
      type: "ReturnCandidatesOffered",
      giverId: transfer.giverId,
      giverSeat: transfer.giverSeat,
      recipientId: transfer.recipientId,
      recipientSeat: transfer.recipientSeat,
      tributeCard: transfer.card,
      candidateCards: [...command.candidateCards],
    },
  ]);
}

function decideSelectReturnCard(
  state: InternalState,
  command: SelectReturnCard,
): Decision {
  const activeMatch = activeSetup(state);
  if (activeMatch === undefined) return rejected("room-not-active");
  if (findMember(state, command.playerId) === undefined) {
    return rejected("not-a-member");
  }
  if (activeMatch.hand.setup.stage !== "return-card-selection") {
    return rejected("hand-setup-incomplete");
  }
  const pending = pendingReturn(activeMatch);
  if (pending === undefined) return rejected("not-pending-setup-actor");
  const { transfer, offer } = pending;
  if (
    offer === undefined &&
    returnSelectionConfiguration(activeMatch.rulesConfiguration) ===
      "giver-choice-from-candidates"
  ) {
    const tribute = decodeCardInstance(transfer.card);
    if (tribute.ok && tribute.card.face.kind === "joker") {
      return rejected("return-candidates-invalid");
    }
  }
  const expectedActor = offer?.giverId ?? transfer.recipientId;
  if (command.playerId !== expectedActor) {
    return rejected("not-pending-setup-actor");
  }
  if (offer !== undefined && !offer.candidateCards.includes(command.card)) {
    return rejected("return-card-not-eligible");
  }
  const recipientHand = handAtSeat(activeMatch, transfer.recipientSeat);
  if (
    recipientHand === undefined ||
    !recipientHand.cards.some((card) => card.code === command.card)
  ) {
    return rejected("return-card-not-eligible");
  }

  const events: Event[] = [
    {
      type: "ReturnTransferred",
      giverId: transfer.giverId,
      giverSeat: transfer.giverSeat,
      recipientId: transfer.recipientId,
      recipientSeat: transfer.recipientSeat,
      tributeCard: transfer.card,
      card: command.card,
    },
  ];
  const candidate = foldAcceptedState(state, events);
  const leader = leaderEvent(candidate);
  if (leader !== undefined) events.push(leader);
  return accepted(events);
}

function recipientPairForTransfer(
  activeMatch: ActiveMatch,
  setup: HandSetup,
  pair: TieChoiceRecipientPair,
): TributeTransferred | undefined {
  const giver = setup.givers.find(
    (candidate) => candidate.playerId === pair.giverId,
  );
  const selection =
    giver === undefined ? undefined : selectedTribute(setup, giver.seatIndex);
  const recipient = handAtSeat(activeMatch, pair.recipientSeat);
  if (
    giver === undefined ||
    selection === undefined ||
    recipient === undefined
  ) {
    return undefined;
  }
  return {
    type: "TributeTransferred",
    giverId: giver.playerId,
    giverSeat: giver.seatIndex,
    recipientId: recipient.playerId,
    recipientSeat: pair.recipientSeat,
    card: selection.card,
    rank: giver.rank,
  };
}

function orderedTieBallots(
  tieChoice: TieChoiceState,
): TieChoiceRevealedBallot[] {
  return tieChoice.voters.flatMap((voterId) => {
    const ballot = tieChoice.ballots.find(
      (candidate) => candidate.voterId === voterId,
    );
    return ballot === undefined ? [] : [{ ...ballot }];
  });
}

function recipientPairingResolution(
  state: InternalState,
  tieChoice: TieChoiceState,
): {
  committedPairs: TieChoiceRecipientPair[];
  remainingVoterIds: PlayerAccountId[];
  remainingCandidateIds: PlayerAccountId[];
  fallback: boolean;
} {
  const activeMatch = state.activeMatch;
  if (activeMatch === undefined) {
    return {
      committedPairs: [],
      remainingVoterIds: [...tieChoice.voters],
      remainingCandidateIds: [...tieChoice.candidates],
      fallback: false,
    };
  }

  const ballotsByVoter = new Map(
    tieChoice.ballots.map((ballot) => [ballot.voterId, ballot.candidateId]),
  );
  const candidateCounts = new Map<PlayerAccountId, number>();
  for (const ballot of tieChoice.ballots) {
    if (ballot.candidateId === null) continue;
    candidateCounts.set(
      ballot.candidateId,
      (candidateCounts.get(ballot.candidateId) ?? 0) + 1,
    );
  }

  const committedPairs: TieChoiceRecipientPair[] = [];
  const committedVoters = new Set<PlayerAccountId>();
  const committedCandidates = new Set<PlayerAccountId>();
  for (const voterId of tieChoice.voters) {
    const candidateId = ballotsByVoter.get(voterId);
    if (
      candidateId === undefined ||
      candidateId === null ||
      candidateCounts.get(candidateId) !== 1
    ) {
      continue;
    }
    const giver = state.activeMatch!.hand.setup.givers.find(
      (entry) => entry.playerId === voterId,
    );
    const recipientSeat = activeMatch.hands.findIndex(
      (hand) => hand.playerId === candidateId,
    );
    if (giver === undefined || recipientSeat < 0) continue;
    committedPairs.push({
      giverId: voterId,
      giverSeat: giver.seatIndex,
      recipientId: candidateId,
      recipientSeat,
    });
    committedVoters.add(voterId);
    committedCandidates.add(candidateId);
  }

  let remainingVoterIds = tieChoice.voters.filter(
    (voterId) => !committedVoters.has(voterId),
  );
  let remainingCandidateIds = tieChoice.candidates.filter(
    (candidateId) => !committedCandidates.has(candidateId),
  );
  let fallback = false;

  const pairRemaining = (
    voterId: PlayerAccountId,
    candidateId: PlayerAccountId,
  ) => {
    const giver = state.activeMatch!.hand.setup.givers.find(
      (entry) => entry.playerId === voterId,
    );
    const recipientSeat = state.activeMatch!.hands.findIndex(
      (hand) => hand.playerId === candidateId,
    );
    if (giver === undefined || recipientSeat < 0) return;
    committedPairs.push({
      giverId: voterId,
      giverSeat: giver.seatIndex,
      recipientId: candidateId,
      recipientSeat,
    });
    remainingVoterIds = remainingVoterIds.filter((id) => id !== voterId);
    remainingCandidateIds = remainingCandidateIds.filter(
      (id) => id !== candidateId,
    );
  };

  if (remainingVoterIds.length === 1 && remainingCandidateIds.length === 1) {
    pairRemaining(remainingVoterIds[0]!, remainingCandidateIds[0]!);
  } else if (tieChoice.round >= 3 && remainingVoterIds.length > 0) {
    fallback = true;
    const candidateSet = new Set(remainingCandidateIds);
    for (const voterId of [...remainingVoterIds]) {
      const giver = state.activeMatch!.hand.setup.givers.find(
        (entry) => entry.playerId === voterId,
      );
      if (giver === undefined) continue;
      const precedingSeat =
        (giver.seatIndex - 1 + activeMatch.hands.length) %
        activeMatch.hands.length;
      const candidateId = activeMatch.hands[precedingSeat]?.playerId;
      if (candidateId !== undefined && candidateSet.has(candidateId)) {
        pairRemaining(voterId, candidateId);
        candidateSet.delete(candidateId);
      }
    }
    while (
      remainingVoterIds.length > 0 &&
      remainingVoterIds.length === remainingCandidateIds.length
    ) {
      pairRemaining(remainingVoterIds[0]!, remainingCandidateIds[0]!);
    }
  }

  return {
    committedPairs,
    remainingVoterIds,
    remainingCandidateIds,
    fallback,
  };
}

function leaderSelectionResolution(
  state: InternalState,
  tieChoice: TieChoiceState,
): {
  remainingCandidateIds: PlayerAccountId[];
  fallback: boolean;
  selectedLeaderId: PlayerAccountId | undefined;
} {
  const counts = new Map<PlayerAccountId, number>();
  for (const ballot of tieChoice.ballots) {
    if (ballot.candidateId === null) continue;
    counts.set(ballot.candidateId, (counts.get(ballot.candidateId) ?? 0) + 1);
  }
  const highestCount = Math.max(
    0,
    ...tieChoice.candidates.map((candidateId) => counts.get(candidateId) ?? 0),
  );
  const highest = tieChoice.candidates.filter(
    (candidateId) => (counts.get(candidateId) ?? 0) === highestCount,
  );
  const nonGiveUpHighest = highestCount > 0 ? highest : [];
  if (nonGiveUpHighest.length === 1) {
    return {
      remainingCandidateIds: nonGiveUpHighest,
      fallback: false,
      selectedLeaderId: nonGiveUpHighest[0],
    };
  }

  if (tieChoice.round >= 3) {
    const activeMatch = state.activeMatch;
    const fallbackCandidates =
      nonGiveUpHighest.length === 0 ? tieChoice.candidates : nonGiveUpHighest;
    if (activeMatch === undefined || fallbackCandidates.length === 0) {
      return {
        remainingCandidateIds: [...fallbackCandidates],
        fallback: true,
        selectedLeaderId: undefined,
      };
    }
    const index = boundedChoice(
      makeRandomStream(
        activeMatch.hand.handSeed,
        activeMatch.rulesConfiguration.rulesetId,
        "tie-choice/leader-fallback",
      ),
      fallbackCandidates.length,
    );
    return {
      remainingCandidateIds: [...fallbackCandidates],
      fallback: true,
      selectedLeaderId: fallbackCandidates[index],
    };
  }

  return {
    remainingCandidateIds:
      nonGiveUpHighest.length === 0
        ? [...tieChoice.candidates]
        : nonGiveUpHighest,
    fallback: false,
    selectedLeaderId: undefined,
  };
}

function decideSubmitTieChoiceBallot(
  state: InternalState,
  command: SubmitTieChoiceBallot,
): Decision {
  const activeMatch = activeSetup(state);
  if (activeMatch === undefined) return rejected("room-not-active");
  if (findMember(state, command.playerId) === undefined) {
    return rejected("not-a-member");
  }
  const setup = activeMatch.hand.setup;
  const tieChoice = setup.tieChoice;
  if (tieChoice === undefined) {
    return rejected("hand-setup-incomplete");
  }
  const expectedStage =
    tieChoice.tieKind === "recipient-pairing"
      ? "recipient-pairing-tie"
      : "leader-selection-tie";
  if (setup.stage !== expectedStage) {
    return rejected("hand-setup-incomplete");
  }
  if (
    command.tieKind !== tieChoice.tieKind ||
    command.round !== tieChoice.round
  ) {
    return rejected("tie-choice-stale");
  }
  if (!tieChoice.voters.includes(command.playerId)) {
    return rejected("not-pending-setup-actor");
  }
  if (tieChoice.ballots.some((ballot) => ballot.voterId === command.playerId)) {
    return rejected("tie-choice-duplicate");
  }
  if (
    command.candidateId !== null &&
    !tieChoice.candidates.includes(command.candidateId)
  ) {
    return rejected("tie-choice-not-eligible");
  }

  const ballot: TieChoiceBallotSubmitted = {
    type: "TieChoiceBallotSubmitted",
    tieKind: tieChoice.tieKind,
    round: tieChoice.round,
    voterId: command.playerId,
    candidateId: command.candidateId,
  };
  const events: Event[] = [ballot];
  let candidate = foldAcceptedState(state, events);
  const committed = candidate.activeMatch!.hand.setup.tieChoice!;
  if (committed.ballots.length < committed.voters.length) {
    return accepted(events);
  }

  let resolution: {
    committedPairs: TieChoiceRecipientPair[];
    remainingVoterIds: PlayerAccountId[];
    remainingCandidateIds: PlayerAccountId[];
    fallback: boolean;
    selectedLeaderId: PlayerAccountId | undefined;
  };
  if (committed.tieKind === "recipient-pairing") {
    resolution = {
      ...recipientPairingResolution(candidate, committed),
      selectedLeaderId: undefined,
    };
  } else {
    const leader = leaderSelectionResolution(candidate, committed);
    resolution = {
      ...leader,
      committedPairs: [],
      remainingVoterIds:
        leader.selectedLeaderId === undefined ? [...committed.voters] : [],
    };
  }
  const resolved: TieChoiceRoundResolved = {
    type: "TieChoiceRoundResolved",
    tieKind: committed.tieKind,
    round: committed.round,
    ballots: orderedTieBallots(committed),
    committedPairs: resolution.committedPairs,
    remainingVoterIds: resolution.remainingVoterIds,
    remainingCandidateIds: resolution.remainingCandidateIds,
    fallback: resolution.fallback,
    ...(resolution.selectedLeaderId === undefined
      ? {}
      : { selectedLeaderId: resolution.selectedLeaderId }),
  };
  events.push(resolved);
  candidate = foldAcceptedState(candidate, [resolved]);

  if (committed.tieKind === "recipient-pairing") {
    const transfers = resolution.committedPairs.flatMap((pair) => {
      const transfer = recipientPairForTransfer(
        candidate.activeMatch!,
        candidate.activeMatch!.hand.setup,
        pair,
      );
      return transfer === undefined ? [] : [transfer];
    });
    events.push(...transfers);
    candidate = foldAcceptedState(candidate, transfers);
    const automaticTransfers = tributeTransferEvents(candidate);
    events.push(...automaticTransfers);
  } else if (resolution.selectedLeaderId !== undefined) {
    const seatIndex = candidate.activeMatch!.hands.findIndex(
      (hand) => hand.playerId === resolution.selectedLeaderId,
    );
    if (seatIndex >= 0) {
      events.push({
        type: "HandLeaderChosen",
        playerId: resolution.selectedLeaderId,
        seatIndex,
      });
    }
  }

  return accepted(events);
}

function decideStartMatch(state: InternalState, command: StartMatch): Decision {
  if (!isLobby(state)) {
    return rejected("room-not-in-lobby");
  }
  if (state.selectedActivity === "challenge") {
    return rejected("activity-kind-mismatch");
  }

  const playerIds = startPlayerIds(state);
  if (playerIds === undefined) {
    return rejected("start-requirements-not-met");
  }
  if (command.handSeed.length === 0) {
    return rejected("invalid-hand-seed");
  }
  if (command.randomnessVersion !== RANDOMNESS_VERSION) {
    return rejected("unsupported-randomness-version");
  }
  if (command.shuffleVersion !== SHUFFLE_VERSION) {
    return rejected("unsupported-shuffle-version");
  }
  const resolvedPlayerIds =
    state.seatingPolicy === "fixed"
      ? [...playerIds]
      : shuffled(
          playerIds,
          makeRandomStream(
            command.handSeed,
            state.rulesConfiguration.rulesetId,
            "seating",
          ),
        );
  const dealerSeat = boundedChoice(
    makeRandomStream(
      command.handSeed,
      state.rulesConfiguration.rulesetId,
      "initial-dealer",
    ),
    resolvedPlayerIds.length,
  );

  return accepted([
    {
      type: "MatchStarted",
      rulesetId: state.rulesConfiguration.rulesetId,
      rulesConfiguration: state.rulesConfiguration,
      seatingPolicy: state.seatingPolicy,
      handSeed: command.handSeed,
      randomnessVersion: command.randomnessVersion,
      shuffleVersion: command.shuffleVersion,
      playerIds: resolvedPlayerIds,
      dealerSeat,
      dealerTeam: (dealerSeat % 2) as TeamIndex,
      teamLevels: ["2", "2"],
      trumpRank: "2",
      failureCounters: [0, 0],
    },
  ]);
}

function sameChallengeTemplate(
  left: ChallengeTemplate,
  right: ChallengeTemplate,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function decideSelectChallengeHand(
  state: InternalState,
  command: SelectChallengeHand,
): Decision {
  const membershipRejection = requireLobbyMember(state, command.playerId);
  if (membershipRejection !== undefined) return rejected(membershipRejection);
  if (command.playerId !== state.ownerId) return rejected("owner-only");
  if (!isChallengeTemplate(command.template)) {
    return rejected("challenge-template-invalid");
  }
  const capacity = RULESET_DEFINITIONS[command.template.rulesetId].playerCount;
  if (state.members.length > capacity) {
    return rejected("challenge-ruleset-too-small");
  }
  if (
    state.selectedActivity === "challenge" &&
    state.challengeTemplate !== undefined &&
    sameChallengeTemplate(state.challengeTemplate, command.template)
  ) {
    return rejected("challenge-already-selected");
  }
  const events: Event[] = [
    {
      type: "ChallengeHandSelected",
      template: command.template,
    },
  ];
  if (
    state.readyPlayerIds.length > 0 &&
    (state.selectedActivity !== undefined ||
      effectiveRulesetId(state) !== command.template.rulesetId)
  ) {
    events.push({ type: "ReadinessCleared" });
  }
  if (state.seats.some((seat) => seat.seatIndex >= capacity)) {
    events.push({ type: "SeatAssignmentsCleared" });
  }
  return accepted(events);
}

function decideStartChallengeHand(state: InternalState): Decision {
  if (!isLobby(state)) return rejected("room-not-in-lobby");
  if (
    state.selectedActivity !== "challenge" ||
    state.challengeTemplate === undefined
  ) {
    return rejected("challenge-not-selected");
  }
  const template = state.challengeTemplate;
  if (!isChallengeTemplate(template)) {
    return rejected("challenge-template-invalid");
  }
  const playerIds = startPlayerIds(state);
  if (playerIds === undefined) {
    return rejected("start-requirements-not-met");
  }
  const resolvedPlayerIds =
    state.seatingPolicy === "fixed"
      ? [...playerIds]
      : shuffled(
          playerIds,
          makeRandomStream(template.handSeed, template.rulesetId, "seating"),
        );
  const event: ChallengeHandStarted = {
    type: "ChallengeHandStarted",
    template,
    playerIds: resolvedPlayerIds,
    seatingPolicy: state.seatingPolicy,
  };
  const events: Event[] = [event];
  let candidate = foldAcceptedState(state, events);
  const activeHand = candidate.activeMatch!.hand;
  if (activeHand.setup.givers.length === 0) {
    const leader = leaderEvent(candidate);
    if (leader !== undefined) events.push(leader);
    return accepted(events);
  }

  if (template.rulesConfiguration.tributeCardSelection === "fair-random") {
    for (const giver of activeHand.setup.givers) {
      const index = boundedChoice(
        makeRandomStream(
          template.handSeed,
          template.rulesetId,
          `tribute-card/${giver.seatIndex}`,
        ),
        giver.eligibleCards.length,
      );
      events.push({
        type: "TributeCardSelected",
        giverId: giver.playerId,
        giverSeat: giver.seatIndex,
        card: giver.eligibleCards[index]!,
        rank: giver.rank,
      });
    }
    candidate = foldAcceptedState(candidate, events.slice(1));
    events.push(...tributeTransferEvents(candidate));
  }
  return accepted(events);
}

function handAtSeat(
  activeMatch: ActiveMatch,
  seatIndex: SeatIndex,
): PlayerHand | undefined {
  return activeMatch.hands[seatIndex];
}

function nextUnfinishedSeat(
  activeMatch: ActiveMatch,
  fromSeat: SeatIndex,
  hands: readonly PlayerHand[] = activeMatch.hands,
): SeatIndex | undefined {
  for (let offset = 1; offset <= hands.length; offset += 1) {
    const seatIndex = (fromSeat + offset) % hands.length;
    const hand = hands[seatIndex];
    if (hand !== undefined && hand.cards.length > 0) {
      return seatIndex;
    }
  }

  return undefined;
}

function playerAtSeat(
  activeMatch: ActiveMatch,
  seatIndex: SeatIndex,
): PlayerAccountId | undefined {
  return handAtSeat(activeMatch, seatIndex)?.playerId;
}

function resolveCardsFromHand(
  codes: readonly CardInstanceCode[],
  hand: PlayerHand,
):
  | Readonly<{ ok: true; cards: readonly CardInstance[] }>
  | Readonly<{ ok: false; reason: "card-not-in-hand" }> {
  const cards: CardInstance[] = [];
  for (const code of codes) {
    const card = hand.cards.find((candidate) => candidate.code === code);
    if (card === undefined) {
      return { ok: false, reason: "card-not-in-hand" };
    }
    cards.push(card);
  }
  return { ok: true, cards };
}

function remainingHands(
  activeMatch: ActiveMatch,
  seatIndex: SeatIndex,
  playedCodes: ReadonlySet<CardInstanceCode>,
): PlayerHand[] {
  return activeMatch.hands.map((hand, index) =>
    index === seatIndex
      ? {
          playerId: hand.playerId,
          cards: hand.cards.filter((card) => !playedCodes.has(card.code)),
        }
      : { playerId: hand.playerId, cards: [...hand.cards] },
  );
}

function serializePlayed(
  playerId: PlayerAccountId,
  seatIndex: SeatIndex,
  play: ClassifiedPlay,
): CardsPlayed {
  return {
    type: "CardsPlayed",
    playerId,
    seatIndex,
    cards: play.cards.map((card) => card.code),
    form: play.form,
    rank: play.rank,
    representedFaces: [...play.representedFaces],
    comparisonRanks: [...play.comparisonRanks],
  };
}

function teamFinished(hands: readonly PlayerHand[], team: TeamIndex): boolean {
  return hands.every(
    (hand, seatIndex) => seatIndex % 2 !== team || hand.cards.length === 0,
  );
}

function resultAfterFinish(
  hands: readonly PlayerHand[],
  finishPositions: readonly (number | undefined)[],
): HandResultDetermined | undefined {
  const firstFinisherSeat = finishPositions.findIndex(
    (position) => position === 1,
  );
  if (firstFinisherSeat < 0) {
    return undefined;
  }

  const firstFinisherTeam = (firstFinisherSeat % 2) as TeamIndex;
  if (teamFinished(hands, firstFinisherTeam)) {
    return {
      type: "HandResultDetermined",
      outcome: "win",
      firstFinisherTeam,
      winningTeam: firstFinisherTeam,
      nextDealerTeam: firstFinisherTeam,
      caughtPlayerIds: hands
        .filter(
          (hand, seatIndex) =>
            seatIndex % 2 !== firstFinisherTeam && hand.cards.length > 0,
        )
        .map((hand) => hand.playerId),
    };
  }

  const otherTeam = (1 - firstFinisherTeam) as TeamIndex;
  if (!teamFinished(hands, otherTeam)) {
    return undefined;
  }

  return {
    type: "HandResultDetermined",
    outcome: "draw",
    firstFinisherTeam,
    nextDealerTeam: firstFinisherTeam,
    caughtPlayerIds: [],
  };
}

function advanceTeamLevel(level: TeamLevel): TeamLevel {
  switch (level) {
    case "2":
      return "3";
    case "3":
      return "4";
    case "4":
      return "5";
    case "5":
      return "6";
    case "6":
      return "6";
  }
}

function settleHand(
  state: InternalState,
  activeMatch: ActiveMatch,
  result: HandResultDetermined,
): { settlement: HandSettled; completion: MatchCompleted | undefined } {
  const currentDealerTeam = activeMatch.dealerTeam;
  const winningCurrentDealer =
    result.outcome === "win" && result.winningTeam === currentDealerTeam;
  const teamLevels = [...activeMatch.teamLevels] as [TeamLevel, TeamLevel];
  if (winningCurrentDealer) {
    teamLevels[currentDealerTeam] = advanceTeamLevel(
      teamLevels[currentDealerTeam],
    );
  }

  const failureCounters = [...activeMatch.failureCounters] as [number, number];
  const startedAtFive = activeMatch.trumpRank === "5";
  if (startedAtFive && !winningCurrentDealer) {
    failureCounters[currentDealerTeam] += 1;
  }

  const handNumber = activeMatch.completedHandCount + 1;
  const nextDealerTeam = result.nextDealerTeam;
  const settlement: HandSettled = {
    type: "HandSettled",
    handNumber,
    dealerTeam: nextDealerTeam,
    teamLevels,
    failureCounters,
  };

  let completion: MatchCompleted | undefined;
  if (
    winningCurrentDealer &&
    activeMatch.teamLevels[currentDealerTeam] === "5"
  ) {
    completion = {
      type: "MatchCompleted",
      winningTeam: currentDealerTeam,
      endingReason: "team-level-6",
      teamLevels,
      completedHandCount: handNumber,
    };
  } else if (
    activeMatch.rulesConfiguration.matchEnding === "three-failure-limit-at-5" &&
    startedAtFive &&
    failureCounters[currentDealerTeam] >= 3
  ) {
    completion = {
      type: "MatchCompleted",
      winningTeam: (1 - currentDealerTeam) as TeamIndex,
      endingReason: "three-failure-limit-at-5",
      teamLevels,
      completedHandCount: handNumber,
    };
  }

  return { settlement, completion };
}

function responseCircuitComplete(
  activeMatch: ActiveMatch,
  activeHand: ActiveHand,
  passedSeats: readonly SeatIndex[],
): boolean {
  const unbeatenSeat = activeHand.unbeatenPlay?.seatIndex;
  if (unbeatenSeat === undefined) {
    return false;
  }

  return activeMatch.hands.every(
    (hand, seatIndex) =>
      seatIndex === unbeatenSeat ||
      hand.cards.length === 0 ||
      passedSeats.includes(seatIndex),
  );
}

function decideAbortMatch(state: InternalState, command: AbortMatch): Decision {
  if (state.lifecycle !== "ACTIVE" || state.activeMatch === undefined) {
    return rejected("room-not-active");
  }
  if (state.activeMatch.kind !== "match") {
    return rejected("activity-kind-mismatch");
  }
  if (findMember(state, command.playerId) === undefined) {
    return rejected("not-a-member");
  }
  if (command.playerId !== state.ownerId) {
    return rejected("owner-only");
  }
  return accepted([
    {
      type: "MatchAborted",
      teamLevels: state.activeMatch.teamLevels,
      completedHandCount: state.activeMatch.completedHandCount,
    },
  ]);
}

function decideAbortChallengeHand(
  state: InternalState,
  command: AbortChallengeHand,
): Decision {
  if (state.lifecycle !== "ACTIVE" || state.activeMatch === undefined) {
    return rejected("room-not-active");
  }
  if (state.activeMatch.kind !== "challenge") {
    return rejected("activity-kind-mismatch");
  }
  if (findMember(state, command.playerId) === undefined) {
    return rejected("not-a-member");
  }
  if (command.playerId !== state.ownerId) return rejected("owner-only");
  return accepted([{ type: "ChallengeHandAborted" }]);
}

function decideInterruptRoom(state: InternalState): Decision {
  if (state.lifecycle !== "ACTIVE" || state.activeMatch === undefined) {
    return rejected("room-not-active");
  }
  return accepted([{ type: "RoomInterrupted" }]);
}

function decideArchiveRoom(
  state: InternalState,
  command: ArchiveRoom,
): Decision {
  if (state.lifecycle === "ARCHIVED") return rejected("room-archived");
  if (state.lifecycle !== "INTERRUPTED") {
    return rejected("room-not-interrupted");
  }
  if (findMember(state, command.playerId) === undefined) {
    return rejected("not-a-member");
  }
  if (command.playerId !== state.ownerId) return rejected("owner-only");
  return accepted([{ type: "RoomArchived" }]);
}

function decidePlay(state: InternalState, command: Play): Decision {
  if (state.lifecycle !== "ACTIVE" || state.activeMatch === undefined) {
    return rejected("room-not-active");
  }

  const activeMatch = state.activeMatch;
  const activeHand = activeMatch.hand;
  if (findMember(state, command.playerId) === undefined) {
    return rejected("not-a-member");
  }
  if (activeHand.result !== undefined) {
    return rejected("hand-result-determined");
  }
  if (activeHand.setup.stage !== "play") {
    return rejected("hand-setup-incomplete");
  }

  const seatIndex = activeHand.currentActorSeat;
  const hand = handAtSeat(activeMatch, seatIndex);
  if (hand?.playerId !== command.playerId) {
    return rejected("not-current-player");
  }

  const cardsResult = resolveCardsFromHand(command.cards, hand);
  if (!cardsResult.ok) {
    return rejected(cardsResult.reason);
  }

  const playResult = evaluatePlay({
    cards: cardsResult.cards,
    configuration: activeMatch.rulesConfiguration,
    trumpRank: activeMatch.trumpRank,
    isFinishingPlay: cardsResult.cards.length === hand.cards.length,
    ...(activeHand.unbeatenPlay === undefined
      ? {}
      : { previousPlay: activeHand.unbeatenPlay.play }),
  });
  if (!playResult.ok) {
    return rejected(playResult.reason);
  }

  const play = playResult.play;
  const playedCodes = new Set(play.cards.map((card) => card.code));
  const hands = remainingHands(activeMatch, seatIndex, playedCodes);
  const events: Event[] = [serializePlayed(command.playerId, seatIndex, play)];
  const remainingHand = hands[seatIndex];
  if (remainingHand === undefined) {
    throw new Error("Current player hand disappeared");
  }

  const finishing = remainingHand.cards.length === 0;
  let finishPositions = [...activeHand.finishPositions];
  if (finishing) {
    const finishPosition =
      finishPositions.filter((position) => position !== undefined).length + 1;
    finishPositions[seatIndex] = finishPosition;
    events.push({
      type: "PlayerFinished",
      playerId: command.playerId,
      seatIndex,
      finishPosition,
    });
  }

  const result = resultAfterFinish(hands, finishPositions);
  if (result !== undefined) {
    events.push(result);
    if (activeMatch.kind === "challenge") {
      events.push({
        type: "ChallengeHandCompleted",
        outcome: result.outcome,
        firstFinisherTeam: result.firstFinisherTeam,
        ...(result.winningTeam === undefined
          ? {}
          : { winningTeam: result.winningTeam }),
        nextDealerTeam: result.nextDealerTeam,
        caughtPlayerIds: result.caughtPlayerIds,
      });
      return accepted(events);
    }
    const settled = settleHand(state, activeMatch, result);
    events.push(settled.settlement);
    if (settled.completion !== undefined) {
      events.push(settled.completion);
    }
    return accepted(events);
  }

  if (hasAutomaticResponseClosure(play)) {
    const leadSeat = finishing
      ? nextUnfinishedSeat(activeMatch, seatIndex, hands)
      : seatIndex;
    if (leadSeat === undefined) {
      throw new Error("No unfinished player remains after automatic closure");
    }
    events.push({ type: "LeadReset", seatIndex: leadSeat });
    return accepted(events);
  }

  const nextSeat = nextUnfinishedSeat(activeMatch, seatIndex, hands);
  if (nextSeat !== undefined) {
    events.push({ type: "TurnAdvanced", seatIndex: nextSeat });
  }
  return accepted(events);
}

function decidePass(state: InternalState, command: Pass): Decision {
  if (state.lifecycle !== "ACTIVE" || state.activeMatch === undefined) {
    return rejected("room-not-active");
  }

  const activeMatch = state.activeMatch;
  const activeHand = activeMatch.hand;
  if (findMember(state, command.playerId) === undefined) {
    return rejected("not-a-member");
  }
  if (activeHand.result !== undefined) {
    return rejected("hand-result-determined");
  }
  if (activeHand.setup.stage !== "play") {
    return rejected("hand-setup-incomplete");
  }

  const seatIndex = activeHand.currentActorSeat;
  const hand = handAtSeat(activeMatch, seatIndex);
  if (hand?.playerId !== command.playerId) {
    return rejected("not-current-player");
  }
  if (activeHand.unbeatenPlay === undefined) {
    return rejected("pass-on-open-lead");
  }

  const passedSeats = activeHand.passedSeats.includes(seatIndex)
    ? [...activeHand.passedSeats]
    : [...activeHand.passedSeats, seatIndex];
  const events: Event[] = [
    { type: "PlayerPassed", playerId: command.playerId, seatIndex },
  ];

  if (responseCircuitComplete(activeMatch, activeHand, passedSeats)) {
    const unbeatenSeat = activeHand.unbeatenPlay.seatIndex;
    const leadSeat =
      handAtSeat(activeMatch, unbeatenSeat)?.cards.length === 0
        ? nextUnfinishedSeat(activeMatch, unbeatenSeat)
        : unbeatenSeat;
    if (leadSeat === undefined) {
      throw new Error("No unfinished player remains after lead reset");
    }
    events.push({ type: "LeadReset", seatIndex: leadSeat });
    return accepted(events);
  }

  const nextSeat = nextUnfinishedSeat(activeMatch, seatIndex);
  if (nextSeat !== undefined) {
    events.push({ type: "TurnAdvanced", seatIndex: nextSeat });
  }
  return accepted(events);
}

export function decide(state: State | undefined, command: Command): Decision {
  if (command.type === "JoinRoom") {
    if (state === undefined) {
      return rejected("room-not-created");
    }

    const current = readState(state);
    if (!isLobby(current)) {
      return rejected("room-not-in-lobby");
    }

    if (findMember(current, command.playerId) !== undefined) {
      return rejected("already-a-member");
    }

    const capacity =
      RULESET_DEFINITIONS[effectiveRulesetId(current)].playerCount;
    if (current.members.length >= capacity) {
      return rejected("membership-capacity-reached");
    }

    return accepted([
      {
        type: "MemberJoined",
        playerId: command.playerId,
        joinOrder: current.nextJoinOrder,
      },
    ]);
  }

  if (command.type === "StartMatch") {
    if (state === undefined) {
      return rejected("room-not-created");
    }
    return decideStartMatch(readState(state), command);
  }

  if (command.type === "SelectChallengeHand") {
    if (state === undefined) return rejected("room-not-created");
    return decideSelectChallengeHand(readState(state), command);
  }

  if (command.type === "StartChallengeHand") {
    if (state === undefined) return rejected("room-not-created");
    return decideStartChallengeHand(readState(state));
  }

  if (command.type === "Play") {
    if (state === undefined) {
      return rejected("room-not-created");
    }
    return decidePlay(readState(state), command);
  }

  if (command.type === "Pass") {
    if (state === undefined) {
      return rejected("room-not-created");
    }
    return decidePass(readState(state), command);
  }

  if (command.type === "AbortMatch") {
    if (state === undefined) {
      return rejected("room-not-created");
    }
    return decideAbortMatch(readState(state), command);
  }

  if (command.type === "AbortChallengeHand") {
    if (state === undefined) return rejected("room-not-created");
    return decideAbortChallengeHand(readState(state), command);
  }

  if (command.type === "InterruptRoom") {
    if (state === undefined) return rejected("room-not-created");
    return decideInterruptRoom(readState(state));
  }

  if (command.type === "ArchiveRoom") {
    if (state === undefined) return rejected("room-not-created");
    return decideArchiveRoom(readState(state), command);
  }

  if (command.type === "StartNextHand") {
    if (state === undefined) {
      return rejected("room-not-created");
    }
    return decideStartNextHand(readState(state), command);
  }

  if (command.type === "SelectTributeCard") {
    if (state === undefined) {
      return rejected("room-not-created");
    }
    return decideSelectTributeCard(readState(state), command);
  }

  if (command.type === "OfferReturnCandidates") {
    if (state === undefined) {
      return rejected("room-not-created");
    }
    return decideOfferReturnCandidates(readState(state), command);
  }

  if (command.type === "SelectReturnCard") {
    if (state === undefined) {
      return rejected("room-not-created");
    }
    return decideSelectReturnCard(readState(state), command);
  }

  if (command.type === "SubmitTieChoiceBallot") {
    if (state === undefined) {
      return rejected("room-not-created");
    }
    return decideSubmitTieChoiceBallot(readState(state), command);
  }

  const membershipRejection = requireLobbyMember(
    state === undefined ? undefined : readState(state),
    command.playerId,
  );
  if (membershipRejection !== undefined) {
    return rejected(membershipRejection);
  }

  const current = readState(state as State);

  switch (command.type) {
    case "LeaveRoom": {
      if (current.members.length === 1) {
        return rejected("sole-owner-cannot-leave");
      }

      const events: Event[] = [
        { type: "MemberLeft", playerId: command.playerId },
      ];
      if (command.playerId === current.ownerId) {
        const nextOwner = current.members
          .filter((member) => member.playerId !== command.playerId)
          .sort((left, right) => left.joinOrder - right.joinOrder)[0];
        if (nextOwner === undefined) {
          return rejected("sole-owner-cannot-leave");
        }
        events.push({ type: "OwnerTransferred", ownerId: nextOwner.playerId });
      }
      return accepted(events);
    }

    case "AssignSeat": {
      if (!validSeatIndex(effectiveRulesetId(current), command.seatIndex)) {
        return rejected("invalid-seat-index");
      }

      const occupied = current.seats.find(
        (seat) => seat.seatIndex === command.seatIndex,
      );
      if (occupied !== undefined && occupied.playerId !== command.playerId) {
        return rejected("seat-occupied");
      }

      const existing = findSeat(current, command.playerId);
      if (existing?.seatIndex === command.seatIndex) {
        return rejected("seat-unchanged");
      }

      return accepted([
        {
          type: "SeatAssigned",
          playerId: command.playerId,
          seatIndex: command.seatIndex,
        },
      ]);
    }

    case "RemoveSeat": {
      const existing = findSeat(current, command.playerId);
      if (existing === undefined) {
        return rejected("seat-not-assigned");
      }
      return accepted([
        {
          type: "SeatRemoved",
          playerId: command.playerId,
          seatIndex: existing.seatIndex,
        },
      ]);
    }

    case "SetReadiness": {
      if (command.ready && findSeat(current, command.playerId) === undefined) {
        return rejected("member-must-be-seated");
      }
      if (hasReady(current, command.playerId) === command.ready) {
        return rejected("readiness-unchanged");
      }
      return accepted([
        {
          type: "ReadinessChanged",
          playerId: command.playerId,
          ready: command.ready,
        },
      ]);
    }

    case "ReplaceMatchRulesConfiguration": {
      if (command.playerId !== current.ownerId) {
        return rejected("owner-only");
      }
      if (current.matchRulesConfigurationLocked) {
        return rejected("match-rules-configuration-locked");
      }
      if (
        sameRulesConfiguration(
          current.rulesConfiguration,
          command.rulesConfiguration,
        )
      ) {
        return rejected("rules-configuration-unchanged");
      }

      const currentRuleset = current.rulesConfiguration.rulesetId;
      const nextRuleset = command.rulesConfiguration.rulesetId;
      const nextCapacity = RULESET_DEFINITIONS[nextRuleset].playerCount;
      if (
        current.selectedActivity !== "challenge" &&
        current.members.length > nextCapacity
      ) {
        return rejected("ruleset-change-would-exceed-capacity");
      }

      const events: Event[] = [
        {
          type: "MatchRulesConfigurationReplaced",
          rulesConfiguration: command.rulesConfiguration,
        },
      ];

      if (
        currentRuleset !== nextRuleset &&
        current.selectedActivity !== "challenge"
      ) {
        events.push({ type: "ReadinessCleared" });
        if (
          nextCapacity < RULESET_DEFINITIONS[currentRuleset].playerCount &&
          current.seats.some((seat) => seat.seatIndex >= nextCapacity)
        ) {
          events.push({ type: "SeatAssignmentsCleared" });
        }
      }

      return accepted(events);
    }

    case "ReplaceSeatingPolicy": {
      if (command.playerId !== current.ownerId) {
        return rejected("owner-only");
      }
      if (current.seatingPolicyLocked) {
        return rejected("seating-policy-locked");
      }
      if (command.seatingPolicy === current.seatingPolicy) {
        return rejected("seating-policy-unchanged");
      }
      return accepted([
        {
          type: "SeatingPolicyReplaced",
          seatingPolicy: command.seatingPolicy,
        },
      ]);
    }

    case "SelectMatch": {
      if (command.playerId !== current.ownerId) {
        return rejected("owner-only");
      }
      if (current.selectedActivity === "match") {
        return rejected("match-already-selected");
      }
      if (
        current.members.length >
        RULESET_DEFINITIONS[current.rulesConfiguration.rulesetId].playerCount
      ) {
        return rejected("ruleset-change-would-exceed-capacity");
      }
      const selectionEvents: Event[] = [{ type: "MatchSelected" }];
      if (
        current.selectedActivity !== undefined &&
        current.readyPlayerIds.length > 0
      ) {
        selectionEvents.push({ type: "ReadinessCleared" });
      }
      const matchCapacity =
        RULESET_DEFINITIONS[current.rulesConfiguration.rulesetId].playerCount;
      if (current.seats.some((seat) => seat.seatIndex >= matchCapacity)) {
        selectionEvents.push({ type: "SeatAssignmentsCleared" });
      }
      return accepted(selectionEvents);
    }
  }
}

export function evolve(state: State | undefined, event: Event): State {
  if (event.type === "RoomCreated") {
    if (state !== undefined) {
      throw new Error("RoomCreated requires an empty state");
    }

    return makeState({
      roomId: event.roomId,
      lifecycle: "LOBBY",
      ownerId: event.ownerId,
      members: [{ playerId: event.ownerId, joinOrder: 0 }],
      seats: [],
      readyPlayerIds: [],
      rulesConfiguration: event.rulesConfiguration,
      seatingPolicy: event.seatingPolicy,
      matchRulesConfigurationLocked: false,
      seatingPolicyLocked: false,
      selectedActivity: undefined,
      challengeTemplate: undefined,
      nextJoinOrder: 1,
      activeMatch: undefined,
    });
  }

  if (state === undefined) {
    throw new Error(`${event.type} requires an existing state`);
  }

  const current = readState(state);
  switch (event.type) {
    case "MemberJoined":
      return makeState({
        ...current,
        members: [
          ...current.members,
          {
            playerId: event.playerId,
            joinOrder: event.joinOrder,
          },
        ],
        nextJoinOrder: Math.max(current.nextJoinOrder, event.joinOrder + 1),
      });

    case "MemberLeft":
      return makeState({
        ...current,
        members: current.members.filter(
          (member) => member.playerId !== event.playerId,
        ),
        seats: current.seats.filter((seat) => seat.playerId !== event.playerId),
        readyPlayerIds: current.readyPlayerIds.filter(
          (playerId) => playerId !== event.playerId,
        ),
      });

    case "OwnerTransferred":
      return makeState({ ...current, ownerId: event.ownerId });

    case "SeatAssigned": {
      const seats = current.seats.filter(
        (seat) =>
          seat.playerId !== event.playerId &&
          seat.seatIndex !== event.seatIndex,
      );
      seats.push({ seatIndex: event.seatIndex, playerId: event.playerId });
      seats.sort((left, right) => left.seatIndex - right.seatIndex);
      return makeState({ ...current, seats });
    }

    case "SeatRemoved":
      return makeState({
        ...current,
        seats: current.seats.filter((seat) => seat.playerId !== event.playerId),
      });

    case "ReadinessChanged": {
      const readyPlayerIds = current.readyPlayerIds.filter(
        (playerId) => playerId !== event.playerId,
      );
      if (event.ready) {
        readyPlayerIds.push(event.playerId);
      }
      return makeState({ ...current, readyPlayerIds });
    }

    case "ReadinessCleared":
      return makeState({ ...current, readyPlayerIds: [] });

    case "SeatAssignmentsCleared":
      return makeState({ ...current, seats: [] });

    case "MatchRulesConfigurationReplaced":
      return makeState({
        ...current,
        rulesConfiguration: event.rulesConfiguration,
      });

    case "SeatingPolicyReplaced":
      return makeState({ ...current, seatingPolicy: event.seatingPolicy });

    case "MatchSelected":
      return makeState({
        ...current,
        selectedActivity: "match",
        challengeTemplate: undefined,
      });

    case "ChallengeHandSelected":
      return makeState({
        ...current,
        selectedActivity: "challenge",
        challengeTemplate: event.template,
      });

    case "MatchStarted": {
      const seats = event.playerIds.map((playerId, seatIndex) => ({
        seatIndex,
        playerId,
      }));
      return makeState({
        ...current,
        lifecycle: "ACTIVE",
        seats,
        challengeTemplate: undefined,
        rulesConfiguration: event.rulesConfiguration,
        seatingPolicy: event.seatingPolicy,
        matchRulesConfigurationLocked: true,
        seatingPolicyLocked: true,
        activeMatch: {
          kind: "match",
          rulesConfiguration: event.rulesConfiguration,
          dealerSeat: event.dealerSeat,
          dealerTeam: event.dealerTeam,
          teamLevels: [...event.teamLevels] as [TeamLevel, TeamLevel],
          trumpRank: event.trumpRank,
          failureCounters: [...event.failureCounters] as [number, number],
          completedHandCount: 0,
          hands: dealHands(event),
          hand: {
            handSeed: event.handSeed,
            currentActorSeat: event.dealerSeat,
            unbeatenPlay: undefined,
            passedSeats: [],
            finishPositions: Array(event.playerIds.length).fill(undefined),
            result: undefined,
            setup: initialHandSetup(event.dealerSeat),
          },
          summary: undefined,
          challengeSummary: undefined,
        },
      });
    }

    case "HandStarted": {
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      const hands = dealHands(event);
      const setup = setupForNextHand(
        current.activeMatch,
        hands,
        event.rulesetId,
        event.trumpRank,
      );
      return makeState({
        ...current,
        lifecycle: "ACTIVE",
        seats: event.playerIds.map((playerId, seatIndex) => ({
          seatIndex,
          playerId,
        })),
        activeMatch: {
          ...current.activeMatch,
          kind: "match",
          rulesConfiguration: event.rulesConfiguration,
          dealerTeam: event.dealerTeam,
          teamLevels: [...event.teamLevels] as [TeamLevel, TeamLevel],
          trumpRank: event.trumpRank,
          failureCounters: [...event.failureCounters] as [number, number],
          completedHandCount: event.handNumber - 1,
          hands,
          hand: {
            handSeed: event.handSeed,
            currentActorSeat: setup.firstFinisherSeat,
            unbeatenPlay: undefined,
            passedSeats: [],
            finishPositions: Array(event.playerIds.length).fill(undefined),
            result: undefined,
            setup,
          },
          summary: undefined,
          challengeSummary: undefined,
        },
      });
    }

    case "ChallengeHandStarted": {
      const template = event.template;
      const hands = dealHands({
        handSeed: template.handSeed,
        rulesetId: template.rulesetId,
        playerIds: event.playerIds,
      });
      const setup = setupForChallengeTemplate(template, hands);
      const dealerSeat =
        template.setup.kind === "initial-hand"
          ? template.setup.dealerSeat
          : setup.firstFinisherSeat;
      return makeState({
        ...current,
        lifecycle: "ACTIVE",
        selectedActivity: "challenge",
        challengeTemplate: undefined,
        seatingPolicy: event.seatingPolicy,
        seatingPolicyLocked: true,
        seats: event.playerIds.map((playerId, seatIndex) => ({
          seatIndex,
          playerId,
        })),
        activeMatch: {
          kind: "challenge",
          rulesConfiguration: template.rulesConfiguration,
          dealerSeat,
          dealerTeam: template.dealerTeam,
          teamLevels: [...template.teamLevels] as [TeamLevel, TeamLevel],
          trumpRank: template.trumpRank,
          failureCounters: [...template.failureCounters] as [number, number],
          completedHandCount: 0,
          hands,
          hand: {
            handSeed: template.handSeed,
            currentActorSeat: setup.firstFinisherSeat,
            unbeatenPlay: undefined,
            passedSeats: [],
            finishPositions: Array(event.playerIds.length).fill(undefined),
            result: undefined,
            setup,
          },
          summary: undefined,
          challengeSummary: undefined,
        },
      });
    }

    case "CardsPlayed": {
      if (current.activeMatch === undefined) {
        return makeState(current);
      }

      const playedCodes = new Set(event.cards);
      const hands = current.activeMatch.hands.map((hand, seatIndex) =>
        seatIndex === event.seatIndex
          ? {
              playerId: hand.playerId,
              cards: hand.cards.filter((card) => !playedCodes.has(card.code)),
            }
          : { playerId: hand.playerId, cards: [...hand.cards] },
      );
      const decodedCards = event.cards.map((code) => {
        const decoded = decodeCardInstance(code);
        if (!decoded.ok) {
          throw new Error("CardsPlayed contains an invalid card instance");
        }
        return decoded.card;
      });
      const activePlay: ActivePlay = {
        playerId: event.playerId,
        seatIndex: event.seatIndex,
        play: {
          cards: decodedCards,
          representedFaces: [...event.representedFaces],
          comparisonRanks: [...event.comparisonRanks],
          cardCount: event.cards.length as 1 | 2 | 3 | 5,
          form: event.form,
          rank: event.rank,
        },
      };
      return makeState({
        ...current,
        activeMatch: {
          ...current.activeMatch,
          hands,
          hand: {
            ...current.activeMatch.hand,
            unbeatenPlay: activePlay,
            passedSeats: [],
          },
        },
      });
    }

    case "PlayerPassed":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      return makeState({
        ...current,
        activeMatch: {
          ...current.activeMatch,
          hand: {
            ...current.activeMatch.hand,
            passedSeats: current.activeMatch.hand.passedSeats.includes(
              event.seatIndex,
            )
              ? [...current.activeMatch.hand.passedSeats]
              : [...current.activeMatch.hand.passedSeats, event.seatIndex],
          },
        },
      });

    case "PlayerFinished":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      return makeState({
        ...current,
        activeMatch: {
          ...current.activeMatch,
          hand: {
            ...current.activeMatch.hand,
            finishPositions: current.activeMatch.hand.finishPositions.map(
              (position, seatIndex) =>
                seatIndex === event.seatIndex ? event.finishPosition : position,
            ),
          },
        },
      });

    case "TurnAdvanced":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      return makeState({
        ...current,
        activeMatch: {
          ...current.activeMatch,
          hand: {
            ...current.activeMatch.hand,
            currentActorSeat: event.seatIndex,
          },
        },
      });

    case "LeadReset":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      return makeState({
        ...current,
        activeMatch: {
          ...current.activeMatch,
          hand: {
            ...current.activeMatch.hand,
            currentActorSeat: event.seatIndex,
            unbeatenPlay: undefined,
            passedSeats: [],
          },
        },
      });

    case "HandResultDetermined":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      return makeState({
        ...current,
        activeMatch: {
          ...current.activeMatch,
          hand: { ...current.activeMatch.hand, result: event },
        },
      });

    case "TributeCardSelected":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      if (
        current.activeMatch.hand.setup.tributeSelections.some(
          (selection) => selection.giverSeat === event.giverSeat,
        )
      ) {
        return makeState(current);
      }
      const nextSetup: HandSetup = {
        ...current.activeMatch.hand.setup,
        tributeSelections: [
          ...current.activeMatch.hand.setup.tributeSelections,
          {
            giverSeat: event.giverSeat,
            card: event.card,
            rank: event.rank,
          },
        ],
      };
      const selectedTieChoice = recipientTieState(current, nextSetup);
      return makeState({
        ...current,
        activeMatch: {
          ...current.activeMatch,
          hand: {
            ...current.activeMatch.hand,
            setup: {
              ...nextSetup,
              stage:
                selectedTieChoice === undefined
                  ? nextSetup.stage
                  : "recipient-pairing-tie",
              tieChoice: selectedTieChoice,
            },
          },
        },
      });

    case "TributeTransferred":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      const nextTransfers = [
        ...current.activeMatch.hand.setup.tributeTransfers,
        {
          giverId: event.giverId,
          giverSeat: event.giverSeat,
          recipientId: event.recipientId,
          recipientSeat: event.recipientSeat,
          card: event.card,
          rank: event.rank,
        },
      ];
      const transferSetup: HandSetup = {
        ...current.activeMatch.hand.setup,
        tributeTransfers: nextTransfers,
      };
      const pendingRecipientPairs =
        pendingResolvedRecipientPairs(transferSetup);
      const transferredTieChoice =
        transferSetup.tieChoice ??
        (pendingRecipientPairs.length === 0
          ? recipientTieState(current, transferSetup)
          : undefined);
      const nextStage =
        nextTransfers.length >= transferSetup.givers.length
          ? "return-card-selection"
          : transferredTieChoice !== undefined
            ? "recipient-pairing-tie"
            : current.activeMatch.hand.setup.stage === "recipient-pairing-tie"
              ? "tribute-selection"
              : current.activeMatch.hand.setup.stage;
      return makeState({
        ...current,
        activeMatch: {
          ...current.activeMatch,
          hands: current.activeMatch.hands.map((hand, seatIndex) => {
            if (seatIndex === event.giverSeat) {
              return {
                playerId: hand.playerId,
                cards: hand.cards.filter((card) => card.code !== event.card),
              };
            }
            if (seatIndex === event.recipientSeat) {
              const card = current.activeMatch!.hands[
                event.giverSeat
              ]?.cards.find((candidate) => candidate.code === event.card);
              return card === undefined
                ? { playerId: hand.playerId, cards: [...hand.cards] }
                : { playerId: hand.playerId, cards: [...hand.cards, card] };
            }
            return { playerId: hand.playerId, cards: [...hand.cards] };
          }),
          hand: {
            ...current.activeMatch.hand,
            setup: {
              ...transferSetup,
              stage: nextStage,
              tieChoice: transferredTieChoice,
            },
          },
        },
      });

    case "ReturnCandidatesOffered":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      return makeState({
        ...current,
        activeMatch: {
          ...current.activeMatch,
          hand: {
            ...current.activeMatch.hand,
            setup: {
              ...current.activeMatch.hand.setup,
              returnOffers: [
                ...current.activeMatch.hand.setup.returnOffers,
                {
                  giverId: event.giverId,
                  giverSeat: event.giverSeat,
                  recipientId: event.recipientId,
                  recipientSeat: event.recipientSeat,
                  tributeCard: event.tributeCard,
                  candidateCards: [...event.candidateCards],
                },
              ],
            },
          },
        },
      });

    case "ReturnTransferred":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      const nextReturnTransfers = [
        ...current.activeMatch.hand.setup.returnTransfers,
        {
          giverSeat: event.giverSeat,
          recipientSeat: event.recipientSeat,
          tributeCard: event.tributeCard,
          card: event.card,
        },
      ];
      const nextReturnSetup: HandSetup = {
        ...current.activeMatch.hand.setup,
        returnTransfers: nextReturnTransfers,
      };
      const nextLeaderTieChoice =
        nextReturnTransfers.length >=
        current.activeMatch.hand.setup.tributeTransfers.length
          ? leaderTieState(current, nextReturnSetup)
          : undefined;
      const nextReturnStage =
        nextReturnTransfers.length <
        current.activeMatch.hand.setup.tributeTransfers.length
          ? current.activeMatch.hand.setup.stage
          : nextLeaderTieChoice === undefined
            ? "return-card-selection"
            : "leader-selection-tie";
      return makeState({
        ...current,
        activeMatch: {
          ...current.activeMatch,
          hands: current.activeMatch.hands.map((hand, seatIndex) => {
            if (seatIndex === event.recipientSeat) {
              return {
                playerId: hand.playerId,
                cards: hand.cards.filter((card) => card.code !== event.card),
              };
            }
            if (seatIndex === event.giverSeat) {
              const card = current.activeMatch!.hands[
                event.recipientSeat
              ]?.cards.find((candidate) => candidate.code === event.card);
              return card === undefined
                ? { playerId: hand.playerId, cards: [...hand.cards] }
                : { playerId: hand.playerId, cards: [...hand.cards, card] };
            }
            return { playerId: hand.playerId, cards: [...hand.cards] };
          }),
          hand: {
            ...current.activeMatch.hand,
            setup: {
              ...nextReturnSetup,
              stage: nextReturnStage,
              tieChoice: nextLeaderTieChoice,
            },
          },
        },
      });

    case "TieChoiceBallotSubmitted":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      if (
        current.activeMatch.hand.setup.tieChoice === undefined ||
        current.activeMatch.hand.setup.tieChoice.tieKind !== event.tieKind ||
        current.activeMatch.hand.setup.tieChoice.round !== event.round ||
        current.activeMatch.hand.setup.tieChoice.ballots.some(
          (ballot) => ballot.voterId === event.voterId,
        )
      ) {
        return makeState(current);
      }
      return makeState({
        ...current,
        activeMatch: {
          ...current.activeMatch,
          hand: {
            ...current.activeMatch.hand,
            setup: {
              ...current.activeMatch.hand.setup,
              tieChoice: {
                ...current.activeMatch.hand.setup.tieChoice,
                ballots: [
                  ...current.activeMatch.hand.setup.tieChoice.ballots,
                  {
                    voterId: event.voterId,
                    candidateId: event.candidateId,
                  },
                ],
              },
            },
          },
        },
      });

    case "TieChoiceRoundResolved":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      {
        const setup = current.activeMatch.hand.setup;
        const tieChoice = setup.tieChoice;
        const nextTieChoice =
          event.tieKind === "recipient-pairing"
            ? event.remainingVoterIds.length > 1
              ? {
                  tieKind: event.tieKind,
                  round: event.round + 1,
                  voters: [...event.remainingVoterIds],
                  candidates: [...event.remainingCandidateIds],
                  ballots: [],
                }
              : undefined
            : event.selectedLeaderId === undefined
              ? {
                  tieKind: event.tieKind,
                  round: event.round + 1,
                  voters: [...(tieChoice?.voters ?? event.remainingVoterIds)],
                  candidates: [...event.remainingCandidateIds],
                  ballots: [],
                }
              : undefined;
        return makeState({
          ...current,
          activeMatch: {
            ...current.activeMatch,
            hand: {
              ...current.activeMatch.hand,
              setup: {
                ...setup,
                tieChoice: nextTieChoice,
                resolvedTieRounds: [...setup.resolvedTieRounds, event],
                stage:
                  event.tieKind === "recipient-pairing"
                    ? "recipient-pairing-tie"
                    : "leader-selection-tie",
              },
            },
          },
        });
      }

    case "HandLeaderChosen":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      return makeState({
        ...current,
        activeMatch: {
          ...current.activeMatch,
          hand: {
            ...current.activeMatch.hand,
            currentActorSeat: event.seatIndex,
            setup: {
              ...current.activeMatch.hand.setup,
              stage: "play",
              tieChoice: undefined,
            },
          },
        },
      });

    case "HandSettled":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      return makeState({
        ...current,
        activeMatch: {
          ...current.activeMatch,
          dealerTeam: event.dealerTeam,
          teamLevels: [...event.teamLevels] as [TeamLevel, TeamLevel],
          failureCounters: [...event.failureCounters] as [number, number],
          completedHandCount: event.handNumber,
        },
      });

    case "MatchCompleted":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      return makeState({
        ...current,
        lifecycle: "LOBBY",
        readyPlayerIds: [],
        selectedActivity: undefined,
        challengeTemplate: undefined,
        activeMatch: {
          ...current.activeMatch,
          teamLevels: [...event.teamLevels] as [TeamLevel, TeamLevel],
          completedHandCount: event.completedHandCount,
          summary: {
            outcome: "completed",
            winningTeam: event.winningTeam,
            endingReason: event.endingReason,
            teamLevels: [...event.teamLevels] as [TeamLevel, TeamLevel],
            completedHandCount: event.completedHandCount,
          },
        },
      });

    case "MatchAborted":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      return makeState({
        ...current,
        lifecycle: "LOBBY",
        readyPlayerIds: [],
        selectedActivity: undefined,
        challengeTemplate: undefined,
        activeMatch: {
          ...current.activeMatch,
          teamLevels: [...event.teamLevels] as [TeamLevel, TeamLevel],
          completedHandCount: event.completedHandCount,
          summary: {
            outcome: "aborted",
            teamLevels: [...event.teamLevels] as [TeamLevel, TeamLevel],
            completedHandCount: event.completedHandCount,
          },
        },
      });

    case "ChallengeHandCompleted":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      return makeState({
        ...current,
        lifecycle: "LOBBY",
        readyPlayerIds: [],
        selectedActivity: undefined,
        challengeTemplate: undefined,
        activeMatch: {
          ...current.activeMatch,
          challengeSummary: {
            outcome: "completed",
            result: {
              outcome: event.outcome,
              firstFinisherTeam: event.firstFinisherTeam,
              ...(event.winningTeam === undefined
                ? {}
                : { winningTeam: event.winningTeam }),
              nextDealerTeam: event.nextDealerTeam,
              caughtPlayerIds: [...event.caughtPlayerIds],
            },
          },
        },
      });

    case "ChallengeHandAborted":
      if (current.activeMatch === undefined) {
        return makeState(current);
      }
      return makeState({
        ...current,
        lifecycle: "LOBBY",
        readyPlayerIds: [],
        selectedActivity: undefined,
        challengeTemplate: undefined,
        activeMatch: {
          ...current.activeMatch,
          challengeSummary: undefined,
        },
      });

    case "RoomInterrupted":
      return makeState({
        ...current,
        lifecycle: "INTERRUPTED",
        readyPlayerIds: [],
        selectedActivity: undefined,
        challengeTemplate: undefined,
      });

    case "RoomArchived":
      return makeState({
        ...current,
        lifecycle: "ARCHIVED",
        readyPlayerIds: [],
        selectedActivity: undefined,
        challengeTemplate: undefined,
      });
  }
}

export function derivePlayerView(
  state: State,
  playerId: PlayerAccountId,
): PlayerView {
  const current = readState(state);
  const effectiveConfiguration = effectiveRulesConfiguration(current);
  const seatCount =
    RULESET_DEFINITIONS[effectiveConfiguration.rulesetId].playerCount;
  const seats: PlayerViewSeat[] = [];
  for (let seatIndex = 0; seatIndex < seatCount; seatIndex += 1) {
    const assignment = current.seats.find(
      (seat) => seat.seatIndex === seatIndex,
    );
    seats.push({ seatIndex, playerId: assignment?.playerId });
  }

  const view: PlayerView = {
    roomId: current.roomId,
    lifecycle: current.lifecycle,
    ownerId: current.ownerId,
    members: current.members.map((member) => ({
      playerId: member.playerId,
      joinOrder: member.joinOrder,
      ready: hasReady(current, member.playerId),
    })),
    seats,
    rulesConfiguration: cloneRulesConfiguration(current.rulesConfiguration),
    seatingPolicy: current.seatingPolicy,
    matchRulesConfigurationLocked: current.matchRulesConfigurationLocked,
    seatingPolicyLocked: current.seatingPolicyLocked,
    selectedActivity: current.selectedActivity,
    ...(current.selectedActivity === "challenge" ||
    (current.lifecycle === "ACTIVE" &&
      current.activeMatch?.kind === "challenge")
      ? { effectiveRulesetId: effectiveConfiguration.rulesetId }
      : {}),
    ...(current.selectedActivity === "challenge" &&
    current.challengeTemplate !== undefined
      ? {
          effectiveRulesConfiguration: cloneRulesConfiguration(
            current.challengeTemplate.rulesConfiguration,
          ),
          teamLevels: [...current.challengeTemplate.teamLevels] as [
            TeamLevel,
            TeamLevel,
          ],
          trumpRank: current.challengeTemplate.trumpRank,
        }
      : current.lifecycle === "ACTIVE" &&
          current.activeMatch?.kind === "challenge"
        ? {
            effectiveRulesConfiguration: cloneRulesConfiguration(
              current.activeMatch.rulesConfiguration,
            ),
          }
        : {}),
  };

  if (
    current.lifecycle === "LOBBY" &&
    current.selectedActivity === "challenge"
  ) {
    return deepFreeze(view);
  }

  if (current.activeMatch !== undefined) {
    const retainedFacts =
      current.activeMatch.kind === "match"
        ? {
            teamLevels: [...current.activeMatch.teamLevels] as [
              TeamLevel,
              TeamLevel,
            ],
            completedHandCount: current.activeMatch.completedHandCount,
            ...(current.activeMatch.summary === undefined
              ? {}
              : { matchSummary: current.activeMatch.summary }),
          }
        : current.activeMatch.challengeSummary === undefined
          ? {}
          : { challengeSummary: current.activeMatch.challengeSummary };
    if (current.lifecycle !== "ACTIVE") {
      return deepFreeze({ ...view, ...retainedFacts });
    }

    const publicMatchFacts = {
      ...retainedFacts,
      ...(current.activeMatch.kind === "challenge"
        ? {
            teamLevels: [...current.activeMatch.teamLevels] as [
              TeamLevel,
              TeamLevel,
            ],
          }
        : {}),
      dealerSeat: current.activeMatch.dealerSeat,
      dealerTeam: current.activeMatch.dealerTeam,
      failureCounters: [...current.activeMatch.failureCounters] as [
        number,
        number,
      ],
    };

    const ownHand = current.activeMatch.hands.find(
      (hand) => hand.playerId === playerId,
    );
    const activeHand = current.activeMatch.hand;
    const currentActor = playerAtSeat(
      current.activeMatch,
      activeHand.currentActorSeat,
    );
    const unbeatenPlay = activeHand.unbeatenPlay;
    const pendingReturnChoice = pendingReturn(current.activeMatch);
    const pendingPlayerIds =
      activeHand.setup.tieChoice !== undefined
        ? activeHand.setup.tieChoice.voters.filter(
            (voterId) =>
              !activeHand.setup.tieChoice!.ballots.some(
                (ballot) => ballot.voterId === voterId,
              ),
          )
        : activeHand.setup.stage === "tribute-selection"
          ? activeHand.setup.givers
              .filter(
                (giver) =>
                  selectedTribute(activeHand.setup, giver.seatIndex) ===
                  undefined,
              )
              .map((giver) => giver.playerId)
          : activeHand.setup.stage === "return-card-selection" &&
              pendingReturnChoice !== undefined
            ? [
                pendingReturnChoice.offer?.giverId ??
                  pendingReturnChoice.transfer.recipientId,
              ]
            : [];
    const ownGiver = activeHand.setup.givers.find(
      (giver) => giver.playerId === playerId,
    );
    const eligibleTributeCards =
      activeHand.setup.stage === "tribute-selection" &&
      ownGiver !== undefined &&
      selectedTribute(activeHand.setup, ownGiver.seatIndex) === undefined
        ? [...ownGiver.eligibleCards]
        : [];
    return deepFreeze({
      ...view,
      ...publicMatchFacts,
      trumpRank: current.activeMatch.trumpRank,
      handSizes: current.activeMatch.hands.map((hand) => hand.cards.length),
      hand: ownHand === undefined ? [] : ownHand.cards.map((card) => card.code),
      ...(activeHand.setup.stage !== "play" ||
      activeHand.result !== undefined ||
      currentActor === undefined
        ? {}
        : {
            currentActor,
            currentActorSeat: activeHand.currentActorSeat,
          }),
      ...(unbeatenPlay === undefined
        ? {}
        : {
            unbeatenPlay: {
              playerId: unbeatenPlay.playerId,
              seatIndex: unbeatenPlay.seatIndex,
              cards: unbeatenPlay.play.cards.map((card) => card.code),
              form: unbeatenPlay.play.form,
              rank: unbeatenPlay.play.rank,
              representedFaces: [...unbeatenPlay.play.representedFaces],
              comparisonRanks: [...unbeatenPlay.play.comparisonRanks],
            },
          }),
      passedPlayerIds: activeHand.passedSeats
        .map((seatIndex) => playerAtSeat(current.activeMatch!, seatIndex))
        .filter(
          (candidate): candidate is PlayerAccountId => candidate !== undefined,
        ),
      finishPositions: [...activeHand.finishPositions],
      setupStage: activeHand.setup.stage,
      tributeTransfers: activeHand.setup.tributeTransfers.map((transfer) => ({
        giverId: transfer.giverId,
        giverSeat: transfer.giverSeat,
        recipientId: transfer.recipientId,
        recipientSeat: transfer.recipientSeat,
        card: transfer.card,
        rank: transfer.rank,
      })),
      returnCandidates: activeHand.setup.returnOffers.map((offer) => ({
        giverId: offer.giverId,
        giverSeat: offer.giverSeat,
        recipientId: offer.recipientId,
        recipientSeat: offer.recipientSeat,
        tributeCard: offer.tributeCard,
        candidateCards: [...offer.candidateCards],
      })),
      pendingPlayerIds,
      eligibleTributeCards,
      ...(activeHand.setup.tieChoice === undefined
        ? {}
        : {
            tieKind: activeHand.setup.tieChoice.tieKind,
            tieRound: activeHand.setup.tieChoice.round,
            tieVoterIds: [...activeHand.setup.tieChoice.voters],
            tieCandidateIds: [...activeHand.setup.tieChoice.candidates],
            tieSubmittedPlayerIds: activeHand.setup.tieChoice.ballots.map(
              (ballot) => ballot.voterId,
            ),
            ...(activeHand.setup.tieChoice.ballots.some(
              (ballot) => ballot.voterId === playerId,
            )
              ? {
                  tieOwnBallot: activeHand.setup.tieChoice.ballots.find(
                    (ballot) => ballot.voterId === playerId,
                  )!.candidateId,
                }
              : {}),
          }),
      ...(activeHand.setup.resolvedTieRounds.length === 0
        ? {}
        : {
            tieResolvedRounds: activeHand.setup.resolvedTieRounds.map(
              (round) => ({
                ...round,
                ballots: round.ballots.map((ballot) => ({ ...ballot })),
                committedPairs: round.committedPairs.map((pair) => ({
                  ...pair,
                })),
                remainingVoterIds: [...round.remainingVoterIds],
                remainingCandidateIds: [...round.remainingCandidateIds],
              }),
            ),
          }),
      ...(activeHand.result === undefined
        ? {}
        : {
            handResult: {
              outcome: activeHand.result.outcome,
              firstFinisherTeam: activeHand.result.firstFinisherTeam,
              ...(activeHand.result.winningTeam === undefined
                ? {}
                : { winningTeam: activeHand.result.winningTeam }),
              nextDealerTeam: activeHand.result.nextDealerTeam,
              caughtPlayerIds: [...activeHand.result.caughtPlayerIds],
            },
          }),
    });
  }

  return deepFreeze(view);
}

export function deriveStartRequirements(
  state: State,
): StartRequirements | undefined {
  const current = readState(state);
  const playerIds = startPlayerIds(current);
  return playerIds === undefined ? undefined : deepFreeze({ playerIds });
}

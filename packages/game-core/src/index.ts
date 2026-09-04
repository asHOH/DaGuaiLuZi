import {
  decodeCardInstance,
  RULESET_DEFINITIONS,
  type CardInstance,
  type CardInstanceCode,
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
export type SelectedActivity = "match";
export type TeamIndex = 0 | 1;
export type TeamLevel = "2" | "3" | "4" | "5" | "6";
export type TeamLevels = readonly [TeamLevel, TeamLevel];
export type FailureCounters = readonly [number, number];
export type HandSeed = string;

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
  | MatchStarted;

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

/** Internal command submitted by the Room executor after its external presence check. */
export type StartMatch = Readonly<{
  type: "StartMatch";
  handSeed: HandSeed;
  randomnessVersion: RandomnessVersion;
  shuffleVersion: ShuffleVersion;
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
  | StartMatch;

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
  | "match-rules-configuration-locked"
  | "seating-policy-locked"
  | "start-requirements-not-met"
  | "invalid-hand-seed";

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
  dealerSeat?: SeatIndex;
  dealerTeam?: TeamIndex;
  teamLevels?: TeamLevels;
  trumpRank?: TrumpRank;
  failureCounters?: FailureCounters;
  handSizes?: readonly number[];
  hand?: readonly CardInstanceCode[];
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

type ActiveMatch = Readonly<{
  dealerSeat: SeatIndex;
  dealerTeam: TeamIndex;
  teamLevels: TeamLevels;
  trumpRank: TrumpRank;
  failureCounters: FailureCounters;
  hands: readonly PlayerHand[];
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
  nextJoinOrder: number;
  activeMatch: ActiveMatch | undefined;
};

function cloneRulesConfiguration(
  configuration: RulesConfiguration,
): RulesConfiguration {
  return { ...configuration };
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

function makeState(value: InternalState): State {
  const activeMatch =
    value.activeMatch === undefined
      ? undefined
      : {
          ...value.activeMatch,
          teamLevels: [...value.activeMatch.teamLevels] as [
            TeamLevel,
            TeamLevel,
          ],
          failureCounters: [...value.activeMatch.failureCounters] as [
            number,
            number,
          ],
          hands: value.activeMatch.hands.map((hand) => ({
            playerId: hand.playerId,
            cards: [...hand.cards],
          })),
        };

  return deepFreeze({
    ...value,
    members: value.members.map((member) => ({ ...member })),
    seats: value.seats.map((seat) => ({ ...seat })),
    readyPlayerIds: [...value.readyPlayerIds],
    rulesConfiguration: cloneRulesConfiguration(value.rulesConfiguration),
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

  return event;
}

function isLobby(state: InternalState): boolean {
  return state.lifecycle === "LOBBY";
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

function dealHands(event: MatchStarted): PlayerHand[] {
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

function startPlayerIds(state: InternalState): PlayerAccountId[] | undefined {
  if (!isLobby(state) || state.selectedActivity !== "match") {
    return undefined;
  }

  const seatCount =
    RULESET_DEFINITIONS[state.rulesConfiguration.rulesetId].playerCount;
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

function decideStartMatch(state: InternalState, command: StartMatch): Decision {
  if (!isLobby(state)) {
    return rejected("room-not-in-lobby");
  }

  const playerIds = startPlayerIds(state);
  if (playerIds === undefined) {
    return rejected("start-requirements-not-met");
  }
  if (command.handSeed.length === 0) {
    return rejected("invalid-hand-seed");
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
      RULESET_DEFINITIONS[current.rulesConfiguration.rulesetId].playerCount;
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
      if (
        !validSeatIndex(current.rulesConfiguration.rulesetId, command.seatIndex)
      ) {
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
      if (current.members.length > nextCapacity) {
        return rejected("ruleset-change-would-exceed-capacity");
      }

      const events: Event[] = [
        {
          type: "MatchRulesConfigurationReplaced",
          rulesConfiguration: command.rulesConfiguration,
        },
      ];

      if (currentRuleset !== nextRuleset) {
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
      return accepted([{ type: "MatchSelected" }]);
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
      return makeState({ ...current, selectedActivity: "match" });

    case "MatchStarted": {
      const seats = event.playerIds.map((playerId, seatIndex) => ({
        seatIndex,
        playerId,
      }));
      return makeState({
        ...current,
        lifecycle: "ACTIVE",
        seats,
        rulesConfiguration: event.rulesConfiguration,
        seatingPolicy: event.seatingPolicy,
        matchRulesConfigurationLocked: true,
        seatingPolicyLocked: true,
        activeMatch: {
          dealerSeat: event.dealerSeat,
          dealerTeam: event.dealerTeam,
          teamLevels: [...event.teamLevels] as [TeamLevel, TeamLevel],
          trumpRank: event.trumpRank,
          failureCounters: [...event.failureCounters] as [number, number],
          hands: dealHands(event),
        },
      });
    }
  }
}

export function derivePlayerView(
  state: State,
  playerId: PlayerAccountId,
): PlayerView {
  const current = readState(state);
  const seatCount =
    RULESET_DEFINITIONS[current.rulesConfiguration.rulesetId].playerCount;
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
  };

  if (current.activeMatch !== undefined) {
    const ownHand = current.activeMatch.hands.find(
      (hand) => hand.playerId === playerId,
    );
    return deepFreeze({
      ...view,
      dealerSeat: current.activeMatch.dealerSeat,
      dealerTeam: current.activeMatch.dealerTeam,
      teamLevels: [...current.activeMatch.teamLevels] as [TeamLevel, TeamLevel],
      trumpRank: current.activeMatch.trumpRank,
      failureCounters: [...current.activeMatch.failureCounters] as [
        number,
        number,
      ],
      handSizes: current.activeMatch.hands.map((hand) => hand.cards.length),
      hand: ownHand === undefined ? [] : ownHand.cards.map((card) => card.code),
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

import assert from "node:assert/strict";
import type {
  Event,
  PlayerView,
  TieChoiceRoundResolved,
} from "@dglz/game-core";
import { decodeCardInstance, type RulesConfiguration } from "@dglz/game-rules";
import type { PolicyAction } from "./policy.js";

export const RESEARCH_ENCODING_VERSION = "dglz-research-2" as const;

// Includes every subset size used by play/Return offers at the maximum setup hand size (28).
export const MAX_LEGAL_ACTIONS = 101963;
export const ACTION_ENCODING_BOUNDS: readonly number[] = Object.freeze([
  6, 163, 163, 163, 163, 163, 7, 3, 4,
]);

// Inputs come from frozen core views/events. Explicit fields keep app additions
// out of the versioned research contract, including nested objects.
function pick<T, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Readonly<Pick<T, K>> {
  return Object.freeze(
    Object.fromEntries(keys.map((key) => [key, value[key]])),
  ) as Readonly<Pick<T, K>>;
}

const playFields = [
  "playerId",
  "seatIndex",
  "cards",
  "form",
  "rank",
  "representedFaces",
  "comparisonRanks",
] as const;
const transferFields = [
  "giverId",
  "giverSeat",
  "recipientId",
  "recipientSeat",
] as const;
const resultFields = [
  "outcome",
  "firstFinisherTeam",
  "winningTeam",
  "nextDealerTeam",
  "caughtPlayerIds",
] as const;

const commonRuleFields = [
  "rulesetId",
  "wildcardRank",
  "finishingWildcardInterpretation",
  "flushTieBreaking",
  "nextHandLeader",
  "tributeCardSelection",
  "tributeRecipientPairing",
  "matchEnding",
] as const;
const sixPlayerRuleFields = [
  "jokerPairComparison",
  "returnCardSelection",
] as const;
type ResearchRulesConfiguration =
  | Pick<
      Extract<RulesConfiguration, { rulesetId: "dglz-4p-2d-v1" }>,
      (typeof commonRuleFields)[number]
    >
  | Pick<
      Extract<RulesConfiguration, { rulesetId: "dglz-6p-3d-v1" }>,
      (typeof commonRuleFields)[number] | (typeof sixPlayerRuleFields)[number]
    >;

function researchRules(
  configuration: RulesConfiguration,
): ResearchRulesConfiguration {
  return configuration.rulesetId === "dglz-6p-3d-v1"
    ? Object.freeze({
        ...pick(configuration, commonRuleFields),
        ...pick(configuration, sixPlayerRuleFields),
      })
    : pick(configuration, commonRuleFields);
}

function researchTieRound(event: TieChoiceRoundResolved): ResearchTieRound {
  return Object.freeze({
    ...pick(event, [
      "type",
      "tieKind",
      "round",
      "remainingVoterIds",
      "remainingCandidateIds",
      "fallback",
      "selectedLeaderId",
    ]),
    ballots: Object.freeze(
      event.ballots.map((ballot) => pick(ballot, ["voterId", "candidateId"])),
    ),
    committedPairs: Object.freeze(
      event.committedPairs.map((pair) => pick(pair, transferFields)),
    ),
  });
}

const viewFields = [
  "lifecycle",
  "seatingPolicy",
  "dealerSeat",
  "dealerTeam",
  "teamLevels",
  "trumpRank",
  "failureCounters",
  "completedHandCount",
  "handSizes",
  "hand",
  "currentActor",
  "currentActorSeat",
  "passedPlayerIds",
  "finishPositions",
  "setupStage",
  "pendingPlayerIds",
  "eligibleTributeCards",
  "tieKind",
  "tieRound",
  "tieVoterIds",
  "tieCandidateIds",
  "tieSubmittedPlayerIds",
  "tieOwnBallot",
] as const;

type ResearchPlay = Pick<
  NonNullable<PlayerView["unbeatenPlay"]>,
  (typeof playFields)[number]
>;
type ResearchResult = Pick<
  NonNullable<PlayerView["handResult"]>,
  (typeof resultFields)[number]
>;
type ResearchTieRound = Pick<
  TieChoiceRoundResolved,
  | "type"
  | "tieKind"
  | "round"
  | "remainingVoterIds"
  | "remainingCandidateIds"
  | "fallback"
  | "selectedLeaderId"
> &
  Readonly<{
    ballots: readonly Pick<
      TieChoiceRoundResolved["ballots"][number],
      "voterId" | "candidateId"
    >[];
    committedPairs: readonly Pick<
      TieChoiceRoundResolved["committedPairs"][number],
      (typeof transferFields)[number]
    >[];
  }>;
export type ResearchView = Pick<PlayerView, (typeof viewFields)[number]> &
  Readonly<{
    rulesConfiguration: ResearchRulesConfiguration;
    effectiveRulesConfiguration: ResearchRulesConfiguration | undefined;
    seats: readonly Pick<
      PlayerView["seats"][number],
      "seatIndex" | "playerId"
    >[];
    unbeatenPlay: ResearchPlay | undefined;
    latestPlays: readonly ResearchPlay[] | undefined;
    handResult: ResearchResult | undefined;
    tributeTransfers:
      | readonly Pick<
          NonNullable<PlayerView["tributeTransfers"]>[number],
          (typeof transferFields)[number] | "card" | "rank"
        >[]
      | undefined;
    returnCandidates:
      | readonly Pick<
          NonNullable<PlayerView["returnCandidates"]>[number],
          (typeof transferFields)[number] | "tributeCard" | "candidateCards"
        >[]
      | undefined;
    tieResolvedRounds: readonly ResearchTieRound[] | undefined;
  }>;

/** Projects an already-private core view; never reimplements visibility rules. */
export function researchView(view: PlayerView): ResearchView {
  return Object.freeze({
    ...pick(view, viewFields),
    rulesConfiguration: researchRules(view.rulesConfiguration),
    effectiveRulesConfiguration:
      view.effectiveRulesConfiguration === undefined
        ? undefined
        : researchRules(view.effectiveRulesConfiguration),
    seats: Object.freeze(
      view.seats.map((seat) => pick(seat, ["seatIndex", "playerId"])),
    ),
    unbeatenPlay:
      view.unbeatenPlay === undefined
        ? undefined
        : pick(view.unbeatenPlay, playFields),
    latestPlays:
      view.latestPlays === undefined
        ? undefined
        : Object.freeze(view.latestPlays.map((play) => pick(play, playFields))),
    handResult:
      view.handResult === undefined
        ? undefined
        : pick(view.handResult, resultFields),
    tributeTransfers:
      view.tributeTransfers === undefined
        ? undefined
        : Object.freeze(
            view.tributeTransfers.map((transfer) =>
              pick(transfer, [...transferFields, "card", "rank"]),
            ),
          ),
    returnCandidates:
      view.returnCandidates === undefined
        ? undefined
        : Object.freeze(
            view.returnCandidates.map((offer) =>
              pick(offer, [...transferFields, "tributeCard", "candidateCards"]),
            ),
          ),
    tieResolvedRounds:
      view.tieResolvedRounds === undefined
        ? undefined
        : Object.freeze(view.tieResolvedRounds.map(researchTieRound)),
  });
}

/** Only facts visible during the Hand; private selections appear only upon disclosure. */
export function publicHandEvent(event: Event): PublicHandEvent | undefined {
  switch (event.type) {
    case "CardsPlayed":
      return pick(event, ["type", ...playFields]);
    case "PlayerPassed":
    case "HandLeaderChosen":
      return pick(event, ["type", "playerId", "seatIndex"]);
    case "PlayerFinished":
      return pick(event, ["type", "playerId", "seatIndex", "finishPosition"]);
    case "TurnAdvanced":
    case "LeadReset":
      return pick(event, ["type", "seatIndex"]);
    case "TributeTransferred":
      return pick(event, ["type", ...transferFields, "card", "rank"]);
    case "ReturnCandidatesOffered":
      return pick(event, [
        "type",
        ...transferFields,
        "tributeCard",
        "candidateCards",
      ]);
    case "TieChoiceRoundResolved":
      return researchTieRound(event);
    case "HandResultDetermined":
    case "ChallengeHandCompleted":
      return pick(event, ["type", ...resultFields]);
    case "HandSettled":
      return pick(event, [
        "type",
        "handNumber",
        "dealerTeam",
        "teamLevels",
        "failureCounters",
      ]);
    case "MatchCompleted":
      return pick(event, [
        "type",
        "winningTeam",
        "endingReason",
        "teamLevels",
        "completedHandCount",
      ]);
    case "ReturnTransferred":
      // The engine's public view does not disclose the selected Return Card.
      return pick(event, ["type", ...transferFields, "tributeCard"]);
    default:
      return;
  }
}

type EventFields<
  T extends Event["type"],
  K extends keyof Extract<Event, { type: T }>,
> = Pick<Extract<Event, { type: T }>, K>;
export type PublicHandEvent =
  | EventFields<"CardsPlayed", "type" | (typeof playFields)[number]>
  | EventFields<
      "PlayerPassed" | "HandLeaderChosen",
      "type" | "playerId" | "seatIndex"
    >
  | EventFields<
      "PlayerFinished",
      "type" | "playerId" | "seatIndex" | "finishPosition"
    >
  | EventFields<"TurnAdvanced" | "LeadReset", "type" | "seatIndex">
  | EventFields<
      "TributeTransferred",
      "type" | (typeof transferFields)[number] | "card" | "rank"
    >
  | EventFields<
      "ReturnCandidatesOffered",
      | "type"
      | (typeof transferFields)[number]
      | "tributeCard"
      | "candidateCards"
    >
  | EventFields<
      "ReturnTransferred",
      "type" | (typeof transferFields)[number] | "tributeCard"
    >
  | ResearchTieRound
  | EventFields<
      "HandResultDetermined" | "ChallengeHandCompleted",
      "type" | (typeof resultFields)[number]
    >
  | EventFields<
      "HandSettled",
      "type" | "handNumber" | "dealerTeam" | "teamLevels" | "failureCounters"
    >
  | EventFields<
      "MatchCompleted",
      | "type"
      | "winningTeam"
      | "endingReason"
      | "teamLevels"
      | "completedHandCount"
    >;

export type ResearchObservation = Readonly<{
  encodingVersion: typeof RESEARCH_ENCODING_VERSION;
  actionCount: number;
  playerId: string;
  seatIndex: number;
  teamIndex: number;
  currentPlayerId: string | undefined;
  view: ResearchView;
  publicHistory: readonly PublicHandEvent[];
  legalActions: readonly PolicyAction[];
  actionFeatures: readonly (readonly number[])[];
}>;

/** 1..162: ranks 2..A, suits SHDC, then SMALL/BIG; each face has copies 1..3. Zero pads. */
export function cardFeatureId(code: string): number {
  const result = decodeCardInstance(code);
  assert(result.ok, "牌编号无效。");
  const { face, copyNumber } = result.card;
  const faceIndex =
    face.kind === "joker"
      ? face.rank === "SMALL"
        ? 52
        : 53
      : [
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
        ].indexOf(face.rank) *
          4 +
        ["S", "H", "D", "C"].indexOf(face.suit);
  return faceIndex * 3 + copyNumber;
}

/** [kind, five card IDs, target seat+1 (0=abstain), tie kind, round]. */
export function actionFeatures(
  action: PolicyAction,
  view: Pick<PlayerView, "seats">,
): readonly number[] {
  const kinds = [
    "Play",
    "Pass",
    "SelectTributeCard",
    "OfferReturnCandidates",
    "SelectReturnCard",
    "SubmitTieChoiceBallot",
  ];
  const cards =
    action.type === "Play"
      ? action.cards
      : action.type === "OfferReturnCandidates"
        ? action.candidateCards
        : action.type === "SelectTributeCard" ||
            action.type === "SelectReturnCard"
          ? [action.card]
          : [];
  const ids = cards.map(cardFeatureId).sort((a, b) => a - b);
  const target =
    action.type === "SubmitTieChoiceBallot" && action.candidateId !== null
      ? view.seats.find((seat) => seat.playerId === action.candidateId)
          ?.seatIndex
      : undefined;
  assert(
    action.type !== "SubmitTieChoiceBallot" ||
      action.candidateId === null ||
      target !== undefined,
    "候选玩家没有座位。",
  );
  return Object.freeze([
    kinds.indexOf(action.type),
    ...Array.from({ length: 5 }, (_, i) => ids[i] ?? 0),
    target === undefined ? 0 : target + 1,
    action.type === "SubmitTieChoiceBallot"
      ? action.tieKind === "recipient-pairing"
        ? 1
        : 2
      : 0,
    action.type === "SubmitTieChoiceBallot" ? action.round : 0,
  ]);
}

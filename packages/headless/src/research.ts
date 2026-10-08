import assert from "node:assert/strict";
import type { Event, PlayerView } from "@dglz/game-core";
import { decodeCardInstance } from "@dglz/game-rules";
import type { PolicyAction } from "./policy.js";

export const RESEARCH_ENCODING_VERSION = "dglz-research-1" as const;

// Includes every subset size used by play/Return offers at the maximum setup hand size (28).
export const MAX_LEGAL_ACTIONS = 101963;
export const ACTION_ENCODING_BOUNDS: readonly number[] = Object.freeze([
  6, 163, 163, 163, 163, 163, 7, 3, 4,
]);

export type PublicHandEvent =
  | Extract<
      Event,
      {
        type:
          | "CardsPlayed"
          | "PlayerPassed"
          | "PlayerFinished"
          | "TurnAdvanced"
          | "LeadReset"
          | "TributeTransferred"
          | "ReturnCandidatesOffered"
          | "HandLeaderChosen"
          | "TieChoiceRoundResolved"
          | "HandResultDetermined"
          | "HandSettled"
          | "MatchCompleted"
          | "ChallengeHandCompleted";
      }
    >
  | Omit<Extract<Event, { type: "ReturnTransferred" }>, "card">;

/** Only facts visible during the Hand; private selections appear only upon disclosure. */
export function publicHandEvent(event: Event): PublicHandEvent | undefined {
  switch (event.type) {
    case "CardsPlayed":
    case "PlayerPassed":
    case "PlayerFinished":
    case "TurnAdvanced":
    case "LeadReset":
    case "TributeTransferred":
    case "ReturnCandidatesOffered":
    case "HandLeaderChosen":
    case "TieChoiceRoundResolved":
    case "HandResultDetermined":
    case "HandSettled":
    case "MatchCompleted":
    case "ChallengeHandCompleted":
      return event;
    case "ReturnTransferred":
      // The engine's public view does not disclose the selected Return Card.
      return Object.freeze({
        type: event.type,
        giverId: event.giverId,
        giverSeat: event.giverSeat,
        recipientId: event.recipientId,
        recipientSeat: event.recipientSeat,
        tributeCard: event.tributeCard,
      });
    default:
      return;
  }
}

export type ResearchObservation = Readonly<{
  encodingVersion: typeof RESEARCH_ENCODING_VERSION;
  actionCount: number;
  playerId: string;
  seatIndex: number;
  teamIndex: number;
  currentPlayerId: string | undefined;
  view: PlayerView;
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
  view: PlayerView,
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

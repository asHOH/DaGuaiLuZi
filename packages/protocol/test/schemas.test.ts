import { describe, expect, it } from "vitest";

import {
  CreateRoomCommandSchema,
  JoinRoomCommandEnvelopeSchema,
  ErrorEnvelopeSchema,
  LoginCommandSchema,
  LoginResponseEnvelopeSchema,
  PROTOCOL_VERSION,
  RulesConfigurationSchema,
  RoomCommandEnvelopeSchema,
  RoomResponseEnvelopeSchema,
  RoomCommandAckSchema,
  RoomViewSyncEnvelopeSchema,
  RoomViewDataSchema,
  PassPayloadSchema,
  PlayPayloadSchema,
  ReplaceMatchRulesConfigurationPayloadSchema,
  SelectTributeCardPayloadSchema,
  OfferReturnCandidatesPayloadSchema,
  SelectReturnCardPayloadSchema,
  SubmitTieChoiceBallotPayloadSchema,
  PlayerViewLastHandResultSchema,
  rulesConfigurationPreset,
  errorEnvelope,
  parseProtocolVersion,
} from "../src/index.js";

const fourPlayerConfiguration = {
  rulesetId: "dglz-4p-2d-v1",
  wildcardRank: "strongest-rank",
  finishingWildcardInterpretation: "weakest-form-and-rank",
  flushTieBreaking: "descending-ranks",
  nextHandLeader: "first-finisher",
  tributeCardSelection: "fair-random",
  tributeRecipientPairing: "adjacent-first-automatic",
  matchEnding: "no-failure-limit-at-5",
} as const;

describe("protocol schemas", () => {
  it("accepts the supported commands and rejects unknown fields", () => {
    expect(
      LoginCommandSchema.safeParse({ username: "alice", password: "pass" })
        .success,
    ).toBe(true);
    expect(
      CreateRoomCommandSchema.safeParse({
        rulesetId: "dglz-4p-2d-v1",
        seatingPolicy: "fixed",
      }).success,
    ).toBe(true);
    expect(
      CreateRoomCommandSchema.safeParse({
        rulesetId: "dglz-4p-2d-v1",
        seatingPolicy: "fixed",
        ownerId: "trusted-client-input",
      }).success,
    ).toBe(false);
  });

  it("validates a complete default configuration", () => {
    expect(
      RulesConfigurationSchema.safeParse(fourPlayerConfiguration).success,
    ).toBe(true);
    expect(
      RulesConfigurationSchema.safeParse({
        ...fourPlayerConfiguration,
        futureVariant: "unexpected",
      }).success,
    ).toBe(false);
    expect(
      RulesConfigurationSchema.safeParse({
        rulesetId: "dglz-6p-3d-v1",
        wildcardRank: "strongest-rank",
        finishingWildcardInterpretation: "weakest-form-and-rank",
        flushTieBreaking: "descending-ranks",
        nextHandLeader: "first-finisher",
        tributeCardSelection: "fair-random",
        tributeRecipientPairing: "adjacent-first-automatic",
        matchEnding: "no-failure-limit-at-5",
        jokerPairComparison: "two-small-and-mixed-are-equal",
        returnCardSelection: "recipient-choice",
      }).success,
    ).toBe(true);
  });

  it("keeps compatibility errors machine-readable", () => {
    expect(parseProtocolVersion(String(PROTOCOL_VERSION))).toBe(
      PROTOCOL_VERSION,
    );
    expect(parseProtocolVersion("not-a-version")).toBeUndefined();
    expect(ErrorEnvelopeSchema.parse(errorEnvelope("reload-required"))).toEqual(
      {
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        error: { code: "reload-required" },
      },
    );
  });

  it("validates the revisioned JoinRoom command and acknowledgements", () => {
    const command = {
      protocolVersion: PROTOCOL_VERSION,
      commandId: "da9f540e-fd4b-4d74-be39-ccc7f080cab4",
      roomId: "da9f540e-fd4b-4d74-be39-ccc7f080cab4",
      expectedRevision: 1,
      payload: { type: "JoinRoom" },
    } as const;
    expect(JoinRoomCommandEnvelopeSchema.parse(command)).toEqual(command);
    for (const payload of [
      { type: "SelectMatch" },
      { type: "AssignSeat", seatIndex: 0 },
      { type: "SetReadiness", ready: true },
    ] as const) {
      expect(
        RoomCommandEnvelopeSchema.safeParse({ ...command, payload }).success,
      ).toBe(true);
    }
    expect(
      RoomCommandEnvelopeSchema.safeParse({
        ...command,
        payload: { type: "Play", cards: ["AS#1"] },
      }).success,
    ).toBe(true);
    expect(
      RoomCommandEnvelopeSchema.safeParse({
        ...command,
        payload: { type: "Pass" },
      }).success,
    ).toBe(true);
    expect(
      PlayPayloadSchema.safeParse({
        type: "Play",
        cards: ["AS#1", "AS#1"],
      }).success,
    ).toBe(false);
    expect(
      PlayPayloadSchema.safeParse({
        type: "Play",
        cards: ["invalid#1"],
      }).success,
    ).toBe(false);
    expect(PassPayloadSchema.safeParse({ type: "Pass" }).success).toBe(true);
    expect(
      ReplaceMatchRulesConfigurationPayloadSchema.safeParse({
        type: "ReplaceMatchRulesConfiguration",
        rulesConfiguration: fourPlayerConfiguration,
      }).success,
    ).toBe(true);
    expect(
      SelectTributeCardPayloadSchema.safeParse({
        type: "SelectTributeCard",
        card: "AS#1",
      }).success,
    ).toBe(true);
    expect(
      OfferReturnCandidatesPayloadSchema.safeParse({
        type: "OfferReturnCandidates",
        candidateCards: ["AS#1", "KH#1"],
      }).success,
    ).toBe(true);
    expect(
      OfferReturnCandidatesPayloadSchema.safeParse({
        type: "OfferReturnCandidates",
        candidateCards: ["AS#1", "AS#1"],
      }).success,
    ).toBe(false);
    expect(
      SelectReturnCardPayloadSchema.safeParse({
        type: "SelectReturnCard",
        card: "AS#1",
      }).success,
    ).toBe(true);
    expect(
      SubmitTieChoiceBallotPayloadSchema.safeParse({
        type: "SubmitTieChoiceBallot",
        tieKind: "leader-selection",
        round: 3,
        candidateId: null,
      }).success,
    ).toBe(true);
    expect(
      SubmitTieChoiceBallotPayloadSchema.safeParse({
        type: "SubmitTieChoiceBallot",
        tieKind: "leader-selection",
        round: 4,
        candidateId: null,
      }).success,
    ).toBe(false);
    expect(
      RoomCommandEnvelopeSchema.safeParse({
        ...command,
        protocolVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      JoinRoomCommandEnvelopeSchema.safeParse({
        ...command,
        payload: { type: "SelectMatch" },
      }).success,
    ).toBe(false);
    expect(
      JoinRoomCommandEnvelopeSchema.safeParse({
        ...command,
        payload: { type: "JoinRoom", playerId: "untrusted" },
      }).success,
    ).toBe(false);
    expect(
      RoomCommandAckSchema.safeParse({
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        commandId: command.commandId,
        error: { code: "stale-revision", currentRevision: 2 },
      }).success,
    ).toBe(true);
    expect(
      RoomViewSyncEnvelopeSchema.safeParse({
        protocolVersion: PROTOCOL_VERSION,
        type: "room:view",
        data: {
          revision: 1,
          view: {
            roomId: command.roomId,
            lifecycle: "LOBBY",
            ownerId: "alice",
            members: [{ playerId: "alice", joinOrder: 0, ready: false }],
            seats: [{ seatIndex: 0 }],
            rulesConfiguration: {
              rulesetId: "dglz-4p-2d-v1",
              wildcardRank: "strongest-rank",
              finishingWildcardInterpretation: "weakest-form-and-rank",
              flushTieBreaking: "descending-ranks",
              nextHandLeader: "first-finisher",
              tributeCardSelection: "fair-random",
              tributeRecipientPairing: "adjacent-first-automatic",
              matchEnding: "no-failure-limit-at-5",
            },
            seatingPolicy: "fixed",
            matchRulesConfigurationLocked: false,
            seatingPolicyLocked: false,
          },
        },
      }).success,
    ).toBe(true);
  });

  it("validates the revisioned lobby view", () => {
    const data = {
      revision: 1,
      view: {
        roomId: "da9f540e-fd4b-4d74-be39-ccc7f080cab4",
        lifecycle: "LOBBY",
        ownerId: "alice",
        members: [{ playerId: "alice", joinOrder: 0, ready: false }],
        seats: [{ seatIndex: 0 }],
        rulesConfiguration: {
          rulesetId: "dglz-4p-2d-v1",
          wildcardRank: "strongest-rank",
          finishingWildcardInterpretation: "weakest-form-and-rank",
          flushTieBreaking: "descending-ranks",
          nextHandLeader: "first-finisher",
          tributeCardSelection: "fair-random",
          tributeRecipientPairing: "adjacent-first-automatic",
          matchEnding: "no-failure-limit-at-5",
        },
        seatingPolicy: "fixed",
        matchRulesConfigurationLocked: false,
        seatingPolicyLocked: false,
      },
    };
    expect(RoomViewDataSchema.safeParse(data).success).toBe(true);
    expect(
      PlayerViewLastHandResultSchema.safeParse({
        handNumber: 1,
        result: {
          outcome: "draw",
          firstFinisherTeam: 0,
          nextDealerTeam: 0,
          caughtPlayerIds: [],
        },
        finishPositions: [1, 2, null, null],
        teamLevels: ["2", "2"],
        seats: [{ seatIndex: 0, playerId: "alice" }],
      }).success,
    ).toBe(true);
    expect(
      RoomViewDataSchema.safeParse({
        ...data,
        view: {
          ...data.view,
          lifecycle: "ACTIVE",
          selectedActivity: "match",
          dealerSeat: 0,
          dealerTeam: 0,
          teamLevels: ["2", "2"],
          trumpRank: "2",
          failureCounters: [0, 0],
          completedHandCount: 0,
          handSizes: [27, 27, 27, 27],
          hand: ["AS#1"],
          currentActor: "alice",
          currentActorSeat: 0,
          passedPlayerIds: [],
          finishPositions: [null, null, null, null],
          setupStage: "play",
          tributeTransfers: [],
          returnCandidates: [],
          pendingPlayerIds: [],
          eligibleTributeCards: [],
        },
      }).success,
    ).toBe(true);
    expect(
      RoomResponseEnvelopeSchema.safeParse({
        protocolVersion: PROTOCOL_VERSION,
        ok: true,
        data,
      }).success,
    ).toBe(true);
    expect(
      RoomResponseEnvelopeSchema.safeParse({
        protocolVersion: PROTOCOL_VERSION,
        ok: true,
        data,
        privateState: "must-not-cross-the-wire",
      }).success,
    ).toBe(false);
    expect(
      LoginResponseEnvelopeSchema.safeParse({
        protocolVersion: PROTOCOL_VERSION,
        ok: true,
        data: { accountId: "alice", username: "alice" },
      }).success,
    ).toBe(true);
  });

  it("provides complete app-local rules presets", () => {
    expect(rulesConfigurationPreset("dglz-4p-2d-v1", "省心")).toMatchObject({
      nextHandLeader: "first-finisher",
      tributeCardSelection: "fair-random",
      tributeRecipientPairing: "adjacent-first-automatic",
    });
    expect(rulesConfigurationPreset("dglz-6p-3d-v1", "自主")).toMatchObject({
      nextHandLeader: "highest-tribute",
      tributeCardSelection: "giver-choice",
      tributeRecipientPairing: "finish-position-by-tribute-rank",
      returnCardSelection: "giver-choice-from-candidates",
    });
  });
});

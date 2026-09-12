import { randomUUID } from "node:crypto";
import {
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type ChallengeTemplate,
  type Event,
} from "@dglz/game-core";
import { ChallengeTemplateSchema } from "../src/challenge-template.js";
import { openDatabase } from "../src/db/index.js";
import {
  appendRoomCreated,
  appendRoomEvents,
  readRoomEvents,
} from "../src/rooms.js";
import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION, rulesConfigurationPreset } from "@dglz/protocol";
import { decodePersistedRoomCommandAck } from "../src/rooms.js";

describe("persisted room acknowledgements", () => {
  it("accepts current output versions", () => {
    const commandId = "da9f540e-fd4b-4d74-be39-ccc7f080cab4";
    const decoded = decodePersistedRoomCommandAck({
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      commandId,
      data: {
        revision: 1,
        view: {
          roomId: commandId,
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
    });

    expect(decoded.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(decoded.commandId).toBe(commandId);
  });

  it.each([1, 2, 3, 4, 6])(
    "rejects unsupported persisted output version %i",
    (protocolVersion) => {
      expect(() =>
        decodePersistedRoomCommandAck({
          protocolVersion,
          ok: false,
          commandId: "da9f540e-fd4b-4d74-be39-ccc7f080cab4",
          error: { code: "internal-error" },
        }),
      ).toThrow("unsupported-persisted-event");
    },
  );
});

it("roundtrips frozen subsequent Challenge Templates and validates event identities", () => {
  const template: ChallengeTemplate = {
    rulesetId: "dglz-4p-2d-v1",
    rulesConfiguration: rulesConfigurationPreset("dglz-4p-2d-v1", "省心"),
    handSeed: "private",
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
    dealerTeam: 0,
    teamLevels: ["2", "2"],
    failureCounters: [0, 0],
    trumpRank: "2",
    setup: {
      kind: "subsequent-hand",
      finishPositions: [1, undefined, 2, undefined],
      result: {
        outcome: "win",
        firstFinisherTeam: 0,
        winningTeam: 0,
        nextDealerTeam: 0,
        caughtSeatIndices: [1, 3],
      },
    },
  };
  Object.freeze(template.setup);
  Object.freeze(template);
  expect(ChallengeTemplateSchema.parse(template)).toEqual(template);
  expect(
    ChallengeTemplateSchema.parse(JSON.parse(JSON.stringify(template))),
  ).toEqual(template);
  expect(
    ChallengeTemplateSchema.safeParse({ ...template, dealerTeam: 1 }).success,
  ).toBe(false);
  const database = openDatabase(":memory:");
  try {
    const roomId = randomUUID();
    appendRoomCreated(database, {
      type: "RoomCreated",
      roomId,
      ownerId: "a",
      rulesConfiguration: template.rulesConfiguration,
      seatingPolicy: "fixed",
    });
    const events: Event[] = [
      { type: "ChallengeHandSelected", template },
      {
        type: "ChallengeHandStarted",
        template,
        playerIds: ["a", "b", "c", "d"],
        seatingPolicy: "fixed",
      },
      {
        type: "ChallengeHandCompleted",
        outcome: "win",
        firstFinisherTeam: 0,
        winningTeam: 0,
        nextDealerTeam: 0,
        caughtPlayerIds: ["b", "d"],
      },
      { type: "ChallengeHandAborted" },
    ];
    appendRoomEvents(database, {
      roomId,
      expectedRevision: 1,
      causationCommandId: null,
      events,
    });
    expect(
      [...readRoomEvents(database, roomId)].slice(1).map((row) => row.event),
    ).toEqual(events);
    for (const playerIds of [
      ["a", "a", "c", "d"],
      ["a", "b"],
    ]) {
      expect(() =>
        appendRoomEvents(database, {
          roomId,
          expectedRevision: 5,
          causationCommandId: null,
          events: [
            {
              type: "ChallengeHandStarted",
              template,
              playerIds,
              seatingPolicy: "fixed",
            },
          ],
        }),
      ).toThrow("invalid-players");
    }
  } finally {
    database.close();
  }
});

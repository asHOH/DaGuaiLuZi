import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION } from "@dglz/protocol";
import { decodePersistedRoomCommandAck } from "../src/rooms.js";

describe("persisted room acknowledgements", () => {
  it("normalizes legacy output versions before replay", () => {
    const commandId = "da9f540e-fd4b-4d74-be39-ccc7f080cab4";
    const decoded = decodePersistedRoomCommandAck({
      protocolVersion: 1,
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

  it("rejects unsupported persisted output versions", () => {
    expect(() =>
      decodePersistedRoomCommandAck({
        protocolVersion: 3,
        ok: false,
        commandId: "da9f540e-fd4b-4d74-be39-ccc7f080cab4",
        error: { code: "internal-error" },
      }),
    ).toThrow("unsupported-persisted-event");
  });
});

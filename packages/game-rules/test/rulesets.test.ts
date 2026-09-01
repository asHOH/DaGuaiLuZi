import { describe, expect, it } from "vitest";

import { RULESET_DEFINITIONS } from "../src/index.js";

describe("Ruleset definitions", () => {
  it("defines the six-player, three-deck Ruleset", () => {
    expect(RULESET_DEFINITIONS["dglz-6p-3d-v1"]).toEqual({
      rulesetId: "dglz-6p-3d-v1",
      playerCount: 6,
      teamSize: 3,
      deckCount: 3,
      supportedRuleVariants: [
        "jokerPairComparison",
        "wildcardRank",
        "finishingWildcardInterpretation",
        "flushTieBreaking",
        "nextHandLeader",
        "tributeCardSelection",
        "returnCardSelection",
        "tributeRecipientPairing",
        "matchEnding",
      ],
    });
  });

  it("defines the four-player, two-deck Ruleset and its omissions", () => {
    expect(RULESET_DEFINITIONS["dglz-4p-2d-v1"]).toEqual({
      rulesetId: "dglz-4p-2d-v1",
      playerCount: 4,
      teamSize: 2,
      deckCount: 2,
      supportedRuleVariants: [
        "wildcardRank",
        "finishingWildcardInterpretation",
        "flushTieBreaking",
        "nextHandLeader",
        "tributeCardSelection",
        "tributeRecipientPairing",
        "matchEnding",
      ],
    });
  });

  it("is immutable at every exposed level", () => {
    expect(Object.isFrozen(RULESET_DEFINITIONS)).toBe(true);

    for (const definition of Object.values(RULESET_DEFINITIONS)) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.supportedRuleVariants)).toBe(true);
    }
  });
});

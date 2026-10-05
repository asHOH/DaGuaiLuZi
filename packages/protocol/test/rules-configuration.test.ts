import { describe, expect, expectTypeOf, it } from "vitest";
import type { RulesConfiguration as DomainRulesConfiguration } from "@dglz/game-rules";

import {
  RulesConfigurationSchema,
  rulesConfigurationPreset,
  type RulesConfiguration,
} from "../src/index.js";

// Independent expectations from docs/ruleset.md, not the shared definitions.
const sharedValues = {
  wildcardRank: ["weakest-rank", "strongest-rank"],
  finishingWildcardInterpretation: ["normal", "weakest-form-and-rank"],
  flushTieBreaking: ["highest-card-only", "descending-ranks"],
  nextHandLeader: ["first-finisher", "highest-tribute"],
  tributeCardSelection: ["fair-random", "giver-choice"],
  tributeRecipientPairing: [
    "finish-position-by-tribute-rank",
    "adjacent-first-automatic",
  ],
  matchEnding: ["no-failure-limit-at-5", "three-failure-limit-at-5"],
};

describe.each([
  { rulesetId: "dglz-4p-2d-v1", values: sharedValues },
  {
    rulesetId: "dglz-6p-3d-v1",
    values: {
      ...sharedValues,
      jokerPairComparison: [
        "two-small-and-mixed-are-equal",
        "two-small-jokers-win",
      ],
      returnCardSelection: ["recipient-choice", "giver-choice-from-candidates"],
    },
  },
] as const)("$rulesetId Rule Variant contract", ({ rulesetId, values }) => {
  const configuration = rulesConfigurationPreset(rulesetId, "省心");

  it("retains the exact fields and enum choices used by the settings UI", () => {
    const schema = RulesConfigurationSchema.options.find(
      (option) => option.shape.rulesetId.value === rulesetId,
    )!;
    expect(Object.keys(schema.shape).sort()).toEqual(
      ["rulesetId", ...Object.keys(values)].sort(),
    );
    for (const [variant, allowed] of Object.entries(values)) {
      expect(Reflect.get(schema.shape, variant).options).toEqual(allowed);
      for (const value of allowed) {
        const candidate = { ...configuration, [variant]: value };
        expect(RulesConfigurationSchema.parse(candidate)).toEqual(candidate);
      }
    }
  });

  it("rejects missing, malformed, extra, and unsupported settings", () => {
    const configurations: unknown[] = [
      null,
      [],
      "invalid",
      { ...configuration, futureVariant: "unexpected" },
    ];
    for (const key of ["rulesetId", ...Object.keys(values)]) {
      const missing: Record<string, unknown> = { ...configuration };
      delete missing[key];
      configurations.push(missing);
      for (const value of ["invalid", undefined, null, 0, true, [], {}]) {
        configurations.push({ ...configuration, [key]: value });
      }
    }
    if (rulesetId === "dglz-4p-2d-v1") {
      configurations.push(
        {
          ...configuration,
          jokerPairComparison: "two-small-and-mixed-are-equal",
        },
        { ...configuration, returnCardSelection: "recipient-choice" },
      );
    }
    for (const candidate of configurations) {
      expect(RulesConfigurationSchema.safeParse(candidate).success).toBe(false);
    }
  });
});

it("keeps serialized and domain configurations structurally compatible", () => {
  expectTypeOf<RulesConfiguration>().toExtend<DomainRulesConfiguration>();
  expectTypeOf<DomainRulesConfiguration>().toExtend<RulesConfiguration>();
});

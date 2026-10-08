import {
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type ChallengeTemplate,
} from "@dglz/game-core";
import type { RulesConfiguration } from "@dglz/game-rules";

// Previous-Hand facts and seeds reuse game-core's subsequent-Hand/tie scenarios.
export function subsequentTemplate(
  rulesConfiguration: RulesConfiguration,
  handSeed = "phase-7-subsequent-seed",
): ChallengeTemplate {
  const count = rulesConfiguration.rulesetId === "dglz-4p-2d-v1" ? 4 : 6;
  return {
    rulesetId: rulesConfiguration.rulesetId,
    rulesConfiguration,
    handSeed,
    randomnessVersion: RANDOMNESS_VERSION,
    shuffleVersion: SHUFFLE_VERSION,
    dealerTeam: 0,
    teamLevels: ["2", "2"],
    failureCounters: [0, 0],
    trumpRank: "2",
    setup: {
      kind: "subsequent-hand",
      finishPositions: Array.from({ length: count }, (_, seat) =>
        seat % 2 === 0 ? seat / 2 + 1 : undefined,
      ),
      result: {
        outcome: "win",
        firstFinisherTeam: 0,
        winningTeam: 0,
        nextDealerTeam: 0,
        caughtSeatIndices: Array.from(
          { length: count / 2 },
          (_, index) => index * 2 + 1,
        ),
      },
    },
  };
}

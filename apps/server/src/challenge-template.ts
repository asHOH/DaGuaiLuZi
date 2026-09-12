import { isChallengeTemplate, type ChallengeTemplate } from "@dglz/game-core";
import { z } from "zod";

// JSON arrays encode unfinished positions as null; the core uses undefined.
export const ChallengeTemplateSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || !("setup" in value))
    return value;
  const setup = value.setup;
  if (
    typeof setup !== "object" ||
    setup === null ||
    !("kind" in setup) ||
    setup.kind !== "subsequent-hand" ||
    !("finishPositions" in setup) ||
    !Array.isArray(setup.finishPositions)
  )
    return value;
  return {
    ...value,
    setup: {
      ...setup,
      finishPositions: setup.finishPositions.map((position: unknown) =>
        position === null ? undefined : position,
      ),
    },
  };
}, z.custom<ChallengeTemplate>(isChallengeTemplate));

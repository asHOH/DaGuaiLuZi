import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  decodeCardInstance,
  evaluatePlay,
  type CardInstance,
  type ClassifiedPlay,
  type FourPlayerRulesConfiguration,
  type RulesConfiguration,
  type SixPlayerRulesConfiguration,
  type StandardRank,
  type Suit,
  type TrumpRank,
} from "../src/index.js";

const SIX_PLAYER_CONFIGURATION: SixPlayerRulesConfiguration = {
  rulesetId: "dglz-6p-3d-v1",
  jokerPairComparison: "two-small-and-mixed-are-equal",
  wildcardRank: "strongest-rank",
  finishingWildcardInterpretation: "weakest-form-and-rank",
  flushTieBreaking: "descending-ranks",
  nextHandLeader: "first-finisher",
  tributeCardSelection: "fair-random",
  returnCardSelection: "recipient-choice",
  tributeRecipientPairing: "adjacent-first-automatic",
  matchEnding: "no-failure-limit-at-5",
};

const FOUR_PLAYER_CONFIGURATION: FourPlayerRulesConfiguration = {
  rulesetId: "dglz-4p-2d-v1",
  wildcardRank: "strongest-rank",
  finishingWildcardInterpretation: "weakest-form-and-rank",
  flushTieBreaking: "descending-ranks",
  nextHandLeader: "first-finisher",
  tributeCardSelection: "fair-random",
  tributeRecipientPairing: "adjacent-first-automatic",
  matchEnding: "no-failure-limit-at-5",
};

const STANDARD_RANKS_LOW_TO_HIGH: readonly StandardRank[] = [
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
];

describe("evaluatePlay", () => {
  it.each([
    [["7S#1"], "single", "7"],
    [["9S#1", "9H#1"], "pair", "9"],
    [["QH#1", "QD#1", "QH#2"], "triple", "Q"],
  ] as const)("classifies a natural %s", (codes, form, rank) => {
    const result = evaluateLead(codes, SIX_PLAYER_CONFIGURATION, "5");

    expect(result).toMatchObject({
      ok: true,
      play: {
        cardCount: codes.length,
        form,
        rank,
      },
    });
  });

  it.each([
    ["pair", ["9S#1", "10S#1"]],
    ["triple", ["QH#1", "QD#1", "KH#1"]],
  ])("rejects cards that do not form a natural %s", (_form, codes) => {
    expect(evaluateLead(codes, SIX_PLAYER_CONFIGURATION, "5")).toEqual({
      ok: false,
      reason: "cards-do-not-form-legal-play",
    });
  });

  it("rejects reuse of the same physical Card Instance", () => {
    expect(
      evaluateLead(["9S#1", "9S#1"], SIX_PLAYER_CONFIGURATION, "5"),
    ).toEqual({ ok: false, reason: "duplicate-card-instance" });
  });

  it("allows the third physical copy in 6p3d", () => {
    expect(evaluateLead(["AS#3"], SIX_PLAYER_CONFIGURATION, "5").ok).toBe(true);
  });

  it("rejects the third physical copy in 4p2d", () => {
    expect(evaluateLead(["AS#3"], FOUR_PLAYER_CONFIGURATION, "5")).toEqual({
      ok: false,
      reason: "card-not-in-ruleset",
    });
  });

  it("requires a response to contain the same number of cards", () => {
    const previousPlay = legalLead(
      ["9S#1", "9H#1"],
      SIX_PLAYER_CONFIGURATION,
      "5",
    );

    expect(
      evaluateResponse(["10S#1"], previousPlay, SIX_PLAYER_CONFIGURATION, "5"),
    ).toEqual({ ok: false, reason: "response-card-count-mismatch" });
  });

  it("requires a response to be strictly stronger", () => {
    const previousPlay = legalLead(
      ["9S#1", "9H#1"],
      SIX_PLAYER_CONFIGURATION,
      "5",
    );

    expect(
      evaluateResponse(
        ["9D#1", "9C#1"],
        previousPlay,
        SIX_PLAYER_CONFIGURATION,
        "5",
      ),
    ).toEqual({ ok: false, reason: "response-not-stronger" });
    expect(
      evaluateResponse(
        ["8D#1", "8C#1"],
        previousPlay,
        SIX_PLAYER_CONFIGURATION,
        "5",
      ),
    ).toEqual({ ok: false, reason: "response-not-stronger" });
    expect(
      evaluateResponse(
        ["10D#1", "10C#1"],
        previousPlay,
        SIX_PLAYER_CONFIGURATION,
        "5",
      ).ok,
    ).toBe(true);
  });

  it("ranks the Trump Rank above Ace", () => {
    const previousPlay = legalLead(["AS#1"], SIX_PLAYER_CONFIGURATION, "5");

    expect(
      evaluateResponse(["5D#1"], previousPlay, SIX_PLAYER_CONFIGURATION, "5")
        .ok,
    ).toBe(true);
  });

  it("does not use suits to break a rank tie", () => {
    const previousPlay = legalLead(["KS#1"], SIX_PLAYER_CONFIGURATION, "5");

    expect(
      evaluateResponse(["KH#1"], previousPlay, SIX_PLAYER_CONFIGURATION, "5"),
    ).toEqual({ ok: false, reason: "response-not-stronger" });
  });

  it("implements the documented natural-rank ordering for every Trump Rank", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STANDARD_RANKS_LOW_TO_HIGH),
        fc.constantFrom(...STANDARD_RANKS_LOW_TO_HIGH),
        fc.constantFrom<TrumpRank>("2", "3", "4", "5"),
        (incumbentRank, challengerRank, trumpRank) => {
          const previousPlay = legalLead(
            [`${incumbentRank}S#1`],
            SIX_PLAYER_CONFIGURATION,
            trumpRank,
          );
          const result = evaluateResponse(
            [`${challengerRank}H#1`],
            previousPlay,
            SIX_PLAYER_CONFIGURATION,
            trumpRank,
          );

          expect(result.ok).toBe(
            referenceStrength(challengerRank, trumpRank) >
              referenceStrength(incumbentRank, trumpRank),
          );
        },
      ),
    );
  });

  it("classifies a pair independently of suit", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STANDARD_RANKS_LOW_TO_HIGH),
        fc.constantFrom<Suit>("S", "H", "D", "C"),
        fc.constantFrom<Suit>("S", "H", "D", "C"),
        (rank, firstSuit, secondSuit) => {
          fc.pre(firstSuit !== secondSuit);

          expect(
            evaluateLead(
              [`${rank}${firstSuit}#1`, `${rank}${secondSuit}#1`],
              FOUR_PLAYER_CONFIGURATION,
              "5",
            ),
          ).toMatchObject({ ok: true, play: { form: "pair", rank } });
        },
      ),
    );
  });
});

function decode(code: string): CardInstance {
  const result = decodeCardInstance(code);
  if (!result.ok) {
    throw new Error(`Invalid test Card Instance code: ${code}`);
  }
  return result.card;
}

function evaluateLead(
  codes: readonly string[],
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
) {
  return evaluatePlay({
    cards: codes.map(decode),
    configuration,
    trumpRank,
    isFinishingPlay: false,
  });
}

function legalLead(
  codes: readonly string[],
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
): ClassifiedPlay {
  const result = evaluateLead(codes, configuration, trumpRank);
  if (!result.ok) {
    throw new Error(`Expected a legal test play, received: ${result.reason}`);
  }
  return result.play;
}

function evaluateResponse(
  codes: readonly string[],
  previousPlay: ClassifiedPlay,
  configuration: RulesConfiguration,
  trumpRank: TrumpRank,
) {
  return evaluatePlay({
    cards: codes.map(decode),
    configuration,
    trumpRank,
    isFinishingPlay: false,
    previousPlay,
  });
}

function referenceStrength(rank: StandardRank, trumpRank: TrumpRank): number {
  return rank === trumpRank
    ? STANDARD_RANKS_LOW_TO_HIGH.length
    : STANDARD_RANKS_LOW_TO_HIGH.indexOf(rank);
}

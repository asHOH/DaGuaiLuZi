import { describe, expect, it } from "vitest";

import { decodeCardInstance } from "../src/index.js";

describe("decodeCardInstance", () => {
  it.each([
    ["AS#1", "suited", "A", "S", 1],
    ["10D#2", "suited", "10", "D", 2],
    ["SMALL#3", "joker", "SMALL", undefined, 3],
    ["BIG#1", "joker", "BIG", undefined, 1],
  ] as const)(
    "decodes canonical Card Instance code %s",
    (code, kind, rank, suit, copyNumber) => {
      const result = decodeCardInstance(code);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      expect(result.card).toMatchObject({
        code,
        copyNumber,
        face: {
          kind,
          code: code.slice(0, code.indexOf("#")),
          rank,
          ...(suit === undefined ? {} : { suit }),
        },
      });
    },
  );

  it.each([
    "AS",
    "AS#0",
    "AS#4",
    "SA#1",
    "TS#1",
    "1S#1",
    "as#1",
    "SMALLS#1",
    "BIG#01",
  ])("rejects non-canonical Card Instance code %s", (code) => {
    expect(decodeCardInstance(code)).toEqual({
      ok: false,
      reason: "invalid-card-instance-code",
    });
  });
});


import { describe, expect, it } from "vitest";
import { replayHash, replayLink, replaySource } from "../src/replay-links";

describe("Replay links", () => {
  it("keeps shared codes in fragments and parses private references", () => {
    const code = "012345abcdef";
    const link = new URL(replayLink(code), "https://game.example");
    expect(link.pathname).toBe("/history");
    expect(link.search).toBe("");
    expect(replaySource(link.hash)).toEqual({ code });
    const hand = {
      roomId: "a28d6f28-721a-4d01-9fbd-1f9016a53fa6",
      handStartSequence: 42,
    };
    expect(replaySource(replayHash(hand))).toEqual(hand);
  });

  it("rejects malformed codes and hand references before requesting data", () => {
    for (const hash of [
      "",
      "#replay=bad",
      "#hand=bad/4",
      "#hand=a28d6f28-721a-4d01-9fbd-1f9016a53fa6/0",
      "#hand=a28d6f28-721a-4d01-9fbd-1f9016a53fa6/4/5",
    ])
      expect(replaySource(hash)).toBeUndefined();
  });
});

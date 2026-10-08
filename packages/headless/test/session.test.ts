import { expect, it } from "vitest";
import {
  derivePlayerView,
  evolve,
  type Event,
  type State,
} from "@dglz/game-core";
import { rulesConfigurationPreset } from "@dglz/protocol";
import {
  createHandSession,
  passivePolicy,
  replayHand,
  runFirstHand,
} from "../src/index.js";

for (const rulesetId of ["dglz-4p-2d-v1", "dglz-6p-3d-v1"] as const) {
  it(`steps ${rulesetId}, retains observations, and completes at the exact limit`, () => {
    const options = {
      mode: "first-hand" as const,
      rulesConfiguration: rulesConfigurationPreset(rulesetId, "自主"),
      handSeed: "session-reference",
      seatingPolicy: "randomized" as const,
      record: true,
    };
    const expected = runFirstHand(options);
    const session = createHandSession({
      ...options,
      actionLimit: expected.actionCount,
    });
    const observed = [];
    for (
      let actor = session.currentPlayerId;
      actor !== undefined;
      actor = session.currentPlayerId
    ) {
      expect(session.getResult()).toBeUndefined();
      const view = session.observe(actor);
      expect(Object.isFrozen(view.hand)).toBe(true);
      expect(JSON.stringify(view)).not.toContain(options.handSeed);
      observed.push({ actor, view });
      session.step(passivePolicy(view, actor));
      expect(session.actionCount).toBe(observed.length);
    }
    expect(session.getResult()).toEqual(expected);
    // Verify retained views against the engine's event fold, not another session.
    let state: State | undefined;
    const expectedObserved: typeof observed = [];
    for (const event of expected.events) {
      if (event.type === "CardsPlayed" || event.type === "PlayerPassed") {
        expectedObserved.push({
          actor: event.playerId,
          view: derivePlayerView(state!, event.playerId),
        });
      }
      state = evolve(state, event);
    }
    expect(observed).toEqual(expectedObserved);
    expect(expectedObserved).toHaveLength(session.actionCount);
    expect(() => session.step({ type: "Pass" })).toThrow("手牌已结束");
    expect(replayHand(session.getResult()!.record)).toEqual(expected);
    // Returned evaluator data cannot corrupt future result reads or observations.
    (session.getResult()!.events as Event[]).pop();
    expect(session.getResult()).toEqual(expected);
    expect(session.observe("p1")).toEqual(derivePlayerView(state!, "p1"));
  });
}

it("rejects bad steps without advancing, isolates sessions, and snapshots reset inputs", () => {
  const options = {
    mode: "first-hand" as const,
    rulesConfiguration: rulesConfigurationPreset("dglz-4p-2d-v1", "省心"),
    handSeed: "session-reset",
    record: true,
  };
  const session = createHandSession(options);
  const actor = session.currentPlayerId!;
  const initial = session.observe(actor);
  const action = passivePolicy(initial, actor)!;
  for (const [invalid, reason] of [
    [undefined, "策略未提供动作"],
    [{ type: "Pass" }, "pass-on-open-lead"],
    [{ type: "Play", cards: [] }, "too_small"],
    [{ type: "AbortMatch" }, "策略只能提交出牌或开局选择动作"],
    [{ ...action, playerId: "p2" }, "unrecognized_keys"],
  ] as const) {
    expect(() => session.step(invalid)).toThrow(reason);
    expect(session.actionCount).toBe(0);
    expect(session.currentPlayerId).toBe(actor);
    expect(session.observe(actor)).toEqual(initial);
  }
  expect(() => session.observe("unknown")).toThrow("玩家不在当前手牌中");
  expect(Object.isFrozen(session.playerIds)).toBe(true);
  session.step(action);
  const reset = createHandSession(options);
  expect(reset.actionCount).toBe(0);
  expect(reset.observe(actor)).toEqual(initial);
  expect(session.actionCount).toBe(1);
  options.handSeed = "changed-after-reset";
  while (session.currentPlayerId !== undefined) {
    const playerId = session.currentPlayerId;
    session.step(passivePolicy(session.observe(playerId), playerId));
  }
  expect(session.getResult()!.record!.setup.handSeed).toBe("session-reset");
  expect(replayHand(session.getResult()!.record)).toEqual(session.getResult());
  expect(reset.observe(actor)).toEqual(initial);
});

it("blocks steps at the action limit without completing or changing the Hand", () => {
  const session = createHandSession({
    mode: "first-hand",
    rulesConfiguration: rulesConfigurationPreset("dglz-4p-2d-v1", "省心"),
    handSeed: "session-limit",
    actionLimit: 1,
  });
  const actor = session.currentPlayerId!;
  session.step(passivePolicy(session.observe(actor), actor));
  const next = session.currentPlayerId!;
  const view = session.observe(next);
  expect(() => session.step(passivePolicy(view, next))).toThrow("动作上限");
  expect(session.actionCount).toBe(1);
  expect(session.observe(next)).toEqual(view);
  expect(session.getResult()).toBeUndefined();
});

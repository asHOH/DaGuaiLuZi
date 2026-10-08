import { expect, it } from "vitest";
import { createResearchBridge } from "../src/bridge.js";
import { rulesConfigurationPreset } from "@dglz/protocol";
import { subsequentTemplate } from "./support.js";

it("validates messages and stale choices without mutating the session", () => {
  const dispatch = createResearchBridge();
  let id = 0;
  const call = (op: string, args: Record<string, unknown>) =>
    dispatch({ version: 1, id: id++, op, args }) as {
      ok: boolean;
      data: { episode: number; actionCount: number; currentPlayerId: string };
      error: { code: string };
    };
  expect(call("observe", { playerId: "p1" }).error.code).toBe("not-reset");
  expect(dispatch(null)).toMatchObject({
    ok: false,
    error: { code: "invalid-request" },
  });
  expect(dispatch({ version: 99, id: 4, op: "reset", args: {} })).toMatchObject(
    { ok: false, error: { code: "version-mismatch" } },
  );
  const setup = {
    players: 4,
    preset: "省心",
    handSeed: "bridge",
    seatingPolicy: "randomized",
    actionLimit: 1,
    record: false,
  };
  const first = call("reset", setup).data;
  const actor = first.currentPlayerId;
  const observation = call("observe", { playerId: actor }).data;
  for (const invalid of [
    { ...setup, players: 5 },
    { ...setup, actionLimit: 0 },
    { ...setup, privateField: true },
    {
      ...setup,
      rulesConfiguration: rulesConfigurationPreset("dglz-6p-3d-v1", "省心"),
      preset: undefined,
    },
    {
      players: 4,
      template: subsequentTemplate(
        rulesConfigurationPreset("dglz-6p-3d-v1", "自主"),
      ),
      seatingPolicy: "fixed",
      actionLimit: 1,
      record: false,
    },
  ]) {
    expect(call("reset", invalid).error.code).toBe("invalid-request");
    expect(call("observe", { playerId: actor }).data).toEqual(observation);
  }
  const action = {
    episode: first.episode,
    actionCount: 0,
    playerId: actor,
    actionId: 0,
  };
  for (const [invalid, code] of [
    [{ ...action, episode: first.episode - 1 }, "stale-action"],
    [{ ...action, actionCount: 1 }, "stale-action"],
    [{ ...action, playerId: "other" }, "stale-action"],
    [{ ...action, actionId: -1 }, "invalid-request"],
    [{ ...action, actionId: true }, "invalid-request"],
    [{ ...action, actionId: 101963 }, "illegal-action"],
  ] as const) {
    expect(call("step", invalid).error.code).toBe(code);
    expect(call("observe", { playerId: actor }).data).toEqual(observation);
  }
  expect(call("step", action).data).toMatchObject({
    status: "truncated",
    outcome: null,
    actionCount: 1,
    currentPlayerId: null,
  });
  expect(call("step", action).error.code).toBe("episode-ended");
  expect(call("record", {}).error.code).toBe("record-unavailable");
  expect(call("observe", { playerId: actor }).data).toMatchObject({
    legalActions: [],
    actionFeatures: [],
  });
  const second = call("reset", setup).data;
  expect(second.episode).toBe(first.episode + 1);
  expect(call("step", action).error.code).toBe("stale-action");
  expect(call("observe", { playerId: actor }).data).toEqual(observation);
}, 20000);

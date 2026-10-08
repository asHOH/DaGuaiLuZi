import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  derivePlayerView,
  evolve,
  RANDOMNESS_VERSION,
  SHUFFLE_VERSION,
  type State,
} from "@dglz/game-core";
import { rulesConfigurationPreset } from "@dglz/protocol";
import { passivePolicy, replayHand, runFirstHand } from "../src/index.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const rulesets = ["dglz-4p-2d-v1", "dglz-6p-3d-v1"] as const;

for (const rulesetId of rulesets) {
  it(`replays scripted pairs and automatic closure in a fresh process: ${rulesetId}`, () => {
    let allowed = true;
    const run = runFirstHand({
      rulesConfiguration: rulesConfigurationPreset(rulesetId, "省心"),
      handSeed: rulesetId === rulesets[0] ? "closure-1" : "closure-0",
      record: true,
      createPolicy: () => {
        let paired = false;
        return (view, playerId) => {
          expect(allowed).toBe(true);
          if (view.unbeatenPlay === undefined) {
            const big = view.hand!.find((card) => card.startsWith("BIG"));
            if (big !== undefined) return { type: "Play", cards: [big] };
            if (!paired) {
              for (const card of view.hand!) {
                const pair = view.hand!.filter(
                  (other) => other.split("#")[0] === card.split("#")[0],
                );
                if (pair.length >= 2) {
                  paired = true;
                  return { type: "Play", cards: pair.slice(0, 2) };
                }
              }
            }
          }
          return passivePolicy(view, playerId);
        };
      },
    });
    allowed = false;
    expect(
      run.events.some(
        (event) => event.type === "CardsPlayed" && event.cards.length === 2,
      ),
    ).toBe(true);
    expect(
      run.record!.steps.some((step) => {
        const events = step.events as { type: string; cards?: string[] }[];
        return (
          events[0]?.type === "CardsPlayed" &&
          events[0].cards?.[0]?.startsWith("BIG") &&
          events[1]?.type === "LeadReset" &&
          events.length === 2
        );
      }),
    ).toBe(true);
    // Independently derive each policy observation from the recorded event prefix.
    let state: State = evolve(undefined, run.events[0]!);
    let offset = 1;
    const observed: string[] = [];
    const expected: string[] = [];
    for (const step of run.record!.steps) {
      if (step.observationHash !== undefined) {
        const actor = (step.command as { playerId: string }).playerId;
        const view = derivePlayerView(state, actor);
        observed.push(step.observationHash);
        expected.push(
          createHash("sha256").update(JSON.stringify(view)).digest("hex"),
        );
      }
      for (let index = 0; index < step.events.length; index++)
        state = evolve(state, run.events[offset++]!);
    }
    expect(observed).toHaveLength(run.actionCount);
    expect(observed).toEqual(expected);
    expect(replayHand(JSON.parse(JSON.stringify(run.record)))).toEqual(run);
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {readFileSync} from 'node:fs'; import {replayHand} from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)}; console.log(JSON.stringify(replayHand(JSON.parse(readFileSync(0, 'utf8')))));`,
      ],
      {
        input: JSON.stringify(run.record),
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    expect(JSON.parse(output)).toEqual(JSON.parse(JSON.stringify(run)));
  });
}

it("rejects incompatible, malformed, missing, reordered, illegal, and tampered records", () => {
  const run = runFirstHand({
    rulesConfiguration: rulesConfigurationPreset(rulesets[0], "自主"),
    handSeed: "record-validation",
    record: true,
  });
  const fresh = () => JSON.parse(JSON.stringify(run.record));
  for (const value of [
    null,
    [],
    {},
    { ...fresh(), formatVersion: 2 },
    { ...fresh(), sourceVersion: "future" },
    { ...fresh(), randomnessVersion: "future" },
    { ...fresh(), shuffleVersion: "future" },
  ])
    expect(() => replayHand(value)).toThrow(/记录/);
  const corruptions: ((record: ReturnType<typeof fresh>) => void)[] = [
    (record) => {
      record.setup.handSeed = "changed";
    },
    (record) => {
      record.setup.rulesConfiguration.wildcardRank = "invalid";
    },
    (record) => {
      record.setup.mode = "invalid";
    },
    (record) => {
      record.created.ownerId = "impostor";
    },
    (record) => {
      record.steps.splice(1, 1);
    },
    (record) => {
      record.steps.reverse();
    },
    (record) => {
      record.steps.pop();
    },
    (record) => {
      record.steps.push(record.steps.at(-1));
    },
    (record) => {
      record.steps[0].events = [];
    },
    (record) => {
      record.steps.find(
        (step: { observationHash?: string }) => step.observationHash,
      ).observationHash = "changed";
    },
    (record) => {
      record.steps.find(
        (step: { observationHash?: string }) => step.observationHash,
      ).command.playerId = "impostor";
    },
    (record) => {
      record.steps.find(
        (step: { observationHash?: string }) => step.observationHash,
      ).command = {
        type: "Pass",
        playerId: run.events.find((event) => event.type === "CardsPlayed")!
          .playerId,
      };
    },
    (record) => {
      record.expected.actionCount++;
    },
    (record) => {
      record.extra = true;
    },
  ];
  for (const corrupt of corruptions) {
    const record = fresh();
    corrupt(record);
    expect(() => replayHand(record)).toThrow(/复现|动作被拒绝|invalid_value/);
  }
});

// Sequential Node process startups need headroom during concurrent workspace tests.
it("CLI writes private records, evaluates and replays them, and preserves existing files", () => {
  const directory = mkdtempSync(join(tmpdir(), "dglz-headless-"));
  const recordPath = join(directory, "record.json");
  const invoke = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  try {
    const recorded = invoke(
      "run",
      "6",
      "cli-seed",
      recordPath,
      "自主",
      "randomized",
    );
    expect(recorded.stderr).toBe("");
    expect(recorded.status).toBe(0);
    const evaluation = JSON.parse(recorded.stdout);
    expect(evaluation.动作数).toBeGreaterThan(0);
    const contents = readFileSync(recordPath, "utf8");
    const replayed = invoke("replay", recordPath);
    expect(replayed.stderr).toBe("");
    expect(replayed.status).toBe(0);
    expect(JSON.parse(replayed.stdout)).toMatchObject({
      结果: evaluation.结果,
      完成名次: evaluation.完成名次,
      动作数: evaluation.动作数,
      复现: "通过",
    });
    expect(invoke("run", "4", "other", recordPath).status).toBe(1);
    expect(readFileSync(recordPath, "utf8")).toBe(contents);
    const templatePath = join(directory, "template.json");
    const challengePath = join(directory, "challenge.json");
    writeFileSync(
      templatePath,
      JSON.stringify({
        rulesetId: rulesets[0],
        rulesConfiguration: rulesConfigurationPreset(rulesets[0], "自主"),
        handSeed: "phase-6-triple-27",
        randomnessVersion: RANDOMNESS_VERSION,
        shuffleVersion: SHUFFLE_VERSION,
        dealerTeam: 0,
        teamLevels: ["2", "2"],
        failureCounters: [0, 0],
        trumpRank: "2",
        setup: {
          kind: "subsequent-hand",
          finishPositions: [1, null, 2, null],
          result: {
            outcome: "win",
            firstFinisherTeam: 0,
            winningTeam: 0,
            nextDealerTeam: 0,
            caughtSeatIndices: [1, 3],
          },
        },
      }),
    );
    const challenge = invoke(
      "challenge",
      templatePath,
      challengePath,
      "randomized",
    );
    expect(challenge.stderr).toBe("");
    expect(challenge.status).toBe(0);
    const verified = invoke("replay", challengePath);
    expect(verified.stderr).toBe("");
    expect(verified.status).toBe(0);
    writeFileSync(templatePath, "{}");
    expect(
      invoke("challenge", templatePath, join(directory, "invalid.json")).status,
    ).toBe(1);
    writeFileSync(templatePath, "not JSON");
    expect(invoke("replay", templatePath).status).toBe(1);
    expect(invoke("run", "5", "seed", recordPath).stderr).toContain("用法");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);

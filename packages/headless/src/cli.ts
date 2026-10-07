import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { rulesConfigurationPreset, SeatingPolicySchema } from "@dglz/protocol";
import {
  decodeChallengeTemplate,
  replayHand,
  runChallengeHand,
  runFirstHand,
  type HandRunResult,
} from "./index.js";

const usage =
  "用法：run <4|6> <种子> <新记录.json> [省心|自主] [fixed|randomized]；challenge <模板.json> <新记录.json> [fixed|randomized]；replay <记录.json>";
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

try {
  const [command, ...args] = process.argv.slice(2);
  let run: HandRunResult;
  let output: string | undefined;
  if (command === "run") {
    const [players, handSeed, path, preset = "省心", seats = "fixed"] = args;
    assert(
      args.length >= 3 &&
        args.length <= 5 &&
        (players === "4" || players === "6") &&
        (preset === "省心" || preset === "自主"),
      usage,
    );
    run = runFirstHand({
      rulesConfiguration: rulesConfigurationPreset(
        players === "4" ? "dglz-4p-2d-v1" : "dglz-6p-3d-v1",
        preset,
      ),
      handSeed: handSeed!,
      seatingPolicy: SeatingPolicySchema.parse(seats),
      record: true,
    });
    output = path;
  } else if (command === "challenge") {
    const [path, destination, seats = "fixed"] = args;
    assert(args.length >= 2 && args.length <= 3, usage);
    run = runChallengeHand({
      template: decodeChallengeTemplate(read(path!)),
      seatingPolicy: SeatingPolicySchema.parse(seats),
      record: true,
    });
    output = destination;
  } else {
    assert(command === "replay" && args.length === 1, usage);
    run = replayHand(read(args[0]!));
  }
  if (output !== undefined)
    writeFileSync(output, JSON.stringify(run.record, null, 2) + "\n", {
      flag: "wx",
    });
  console.log(
    JSON.stringify({
      结果: run.result.outcome === "win" ? "胜负" : "平局",
      获胜队伍: run.result.winningTeam ?? null,
      完成名次: run.finishPositions,
      动作数: run.actionCount,
      事件数: run.events.length,
      ...(output === undefined ? { 复现: "通过" } : { 记录文件: output }),
    }),
  );
} catch (error) {
  console.error(
    `执行失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

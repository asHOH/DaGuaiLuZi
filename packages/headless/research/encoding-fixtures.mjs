// Real-engine samples for the Python encoding probe; not an adapter or benchmark.
import { performance } from "node:perf_hooks";
import { rulesConfigurationPreset } from "../../protocol/dist/index.js";
import {
  createHandSession,
  passivePolicy,
  MAX_LEGAL_ACTIONS,
  ACTION_ENCODING_BOUNDS,
} from "../dist/index.js";
import { subsequentTemplate } from "../test/support.ts";

const samples = [];
const timings = [];
for (const rulesetId of ["dglz-4p-2d-v1", "dglz-6p-3d-v1"]) {
  const session = createHandSession({
    mode: "first-hand",
    rulesConfiguration: rulesConfigurationPreset(rulesetId, "自主"),
    handSeed: "research-measure",
    seatingPolicy: "randomized",
  });
  const start = performance.now();
  const observation = session.observeResearch(session.currentPlayerId);
  samples.push(observation);
  timings.push({
    rulesetId,
    candidates: observation.legalActions.length,
    milliseconds: performance.now() - start,
  });
  const other = session.playerIds.find((id) => id !== session.currentPlayerId);
  samples.push(session.observeResearch(other));
  // A single low lead gives a response with both Pass and Play candidates.
  session.step(observation.legalActions[0]);
  samples.push(session.observeResearch(session.currentPlayerId));
}
const session = createHandSession({
  mode: "challenge",
  template: subsequentTemplate(
    rulesConfigurationPreset("dglz-6p-3d-v1", "自主"),
    "phase-6-triple-27",
  ),
});
const stages = new Set();
while (session.currentPlayerId !== undefined) {
  const actor = session.currentPlayerId;
  const view = session.observe(actor);
  const action = passivePolicy(view, actor);
  const label = `${view.setupStage}:${action.type}`;
  if (view.setupStage !== "play" && !stages.has(label)) {
    stages.add(label);
    samples.push(session.observeResearch(actor));
  }
  session.step(action);
}
samples.push(session.observeResearch("p1"));
console.log(
  JSON.stringify({
    maxActions: MAX_LEGAL_ACTIONS,
    actionBounds: ACTION_ENCODING_BOUNDS,
    timings,
    samples,
  }),
);

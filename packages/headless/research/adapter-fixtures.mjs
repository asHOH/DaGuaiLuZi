// Private native reference transcripts for the cross-language adapter checks.
import { rulesConfigurationPreset } from "../../protocol/dist/index.js";
import { createHandSession, passivePolicy } from "../dist/index.js";
import { subsequentTemplate } from "../test/support.ts";

const fixtures = [];
for (const players of [4, 6]) {
  const ruleset = players === 4 ? "dglz-4p-2d-v1" : "dglz-6p-3d-v1";
  const template = subsequentTemplate(
    rulesConfigurationPreset(ruleset, "自主"),
    "phase-6-triple-27",
  );
  const session = createHandSession({
    mode: "challenge",
    template,
    seatingPolicy: "randomized",
    record: true,
  });
  const checkpoints = {};
  const paired = new Set();
  while (session.currentPlayerId !== undefined) {
    const actor = session.currentPlayerId;
    const view = session.observe(actor);
    if (view.setupStage !== "play" || session.actionCount === 0) {
      checkpoints[session.actionCount] = session.playerIds.map((id) =>
        session.observeResearch(id),
      );
    }
    let action = passivePolicy(view, actor);
    if (view.setupStage === "play" && view.unbeatenPlay === undefined) {
      const big = view.hand.find((card) => card.startsWith("BIG"));
      if (big !== undefined) action = { type: "Play", cards: [big] };
      else if (!paired.has(actor)) {
        for (const card of view.hand) {
          const pair = view.hand.filter(
            (other) => other.split("#")[0] === card.split("#")[0],
          );
          if (pair.length >= 2) {
            action = { type: "Play", cards: pair.slice(0, 2) };
            paired.add(actor);
            break;
          }
        }
      }
    }
    if (action.cards) action.cards.sort();
    if (action.candidateCards) action.candidateCards.sort();
    session.step(action);
  }
  checkpoints[session.actionCount] = session.playerIds.map((id) =>
    session.observeResearch(id),
  );
  fixtures.push({
    players,
    template,
    checkpoints,
    outcome: session.getOutcome(),
    record: session.getResult().record,
  });
}
console.log(JSON.stringify(fixtures));

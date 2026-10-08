# Python Research Environment Plan

Status: Phases 1–2 complete (2026-10-08); phases 3–4 planned for [Research Step 3](open-source-roadmap.md).

## Goal and difficulty

Let Python researchers run experiments without understanding TypeScript. Provide a usable environment and integration example; researchers choose rewards, models, and training. No competitive bot or substantial training run required.

Moderate-to-high difficulty: legal-action coverage and encoding are the main uncertainty; cross-language lifecycle and multi-agent reward delivery add integration work. Use four sequential phases with completion gates, not separate architectural projects.

## Scope

- Target [PettingZoo AEC](https://pettingzoo.farama.org/api/aec/); validate space/encoding compatibility before adoption. Reuse the TypeScript engine through a persistent local process; no HTTP service or rules port.
- Assume PettingZoo familiarity in the quickstart; explain only project-specific setup, observations, actions, and outcomes.
- Support both Rulesets and their setup choices. Start with one Hand per episode, including subsequent-Hand contexts from existing Templates; full-Match episodes are deferred.
- Keep game outcomes separate from reward calculation. Supply a replaceable terminal team win/draw/loss example; document episode boundaries and truncation so researchers can extend them explicitly.
- Require Linux verification. Include the built engine in the Python package and launch it automatically; Node.js is an accepted prerequisite, with no TypeScript build for users. Support Windows only if implementation and verification are inexpensive; it is not a completion gate.

## Plan

| Phase | Work | Completion gate |
| --- | --- | --- |
| 1. Step-driven reference | Extract reset/observe/step/completion from the headless runner; retain the runner as a caller. Reuse existing validation and recording. | Both Rulesets preserve setup order, private submissions, results, and deterministic replay; existing callers still work. |
| 2. Observations and legal actions | Expose permitted observations, public history, team roles, and legal setup/play choices. Prototype versioned encodings against AEC spaces and one intended learner. | Generated actions pass engine validation; small exhaustive cases check completeness. Resolve candidate sizes and learner compatibility before freezing the encoding; never silently cap legal choices. |
| 3. Python adapter | Implement AEC over the persistent engine process, with seeded resets, validated messages, explicit errors, and process cleanup. Keep reward policy outside core rules. | Upstream API checks and cross-language privacy/replay checks pass. Termination differs from truncation; players who finish early still receive terminal team rewards. |
| 4. Package and example | Provide an installable package, quickstart, legal-random rollout, replaceable reward example, and one tiny learner integration check. Record versions/configuration/seeds and rollout/bridge timings. | A clean Linux environment outside the checkout installs and runs both Rulesets and setup scenarios using Python and Node.js. The learner consumes trajectories and performs an update; strength is not a gate. |

Phase 1: [session API](development.md#headless-reference) implemented; reset creates a fresh session, and existing runners/replay use the same state machine. `pnpm check` passed (390 tests), as did 13 Chromium cases. Pre-change first-Hand/tied-setup Challenge records match for both Rulesets and replay unchanged. Astra review found no actionable issues; coordinator checked the diff and compatibility independently.

Phase 2: [Research Encoding](research-encoding.md) exposes permitted history, team identity, complete legal choices, and versioned candidate features. `pnpm check` passed (398 tests), as did 13 Chromium cases and 12 Python space/scorer snapshots. Astra review found no runtime defects; independently validated response-coverage improvements were implemented by a different worker. Use candidate-conditioned scoring and replaceable tensor encoders. Opening enumeration takes roughly 3–5 seconds; retain this correctness reference for Step 4 profiling.

## Constraints and verification

- Keep seeds, Templates, authoritative state, and private records outside actor observations; legal choices must not reveal hidden information. Preserve setup disclosure rules and per-player policy memory.
- Reuse Step 2 scenarios and replay checks. Cover multi-card Plays, Automatic Response Closure, ties, early finishers, invalid actions, repeated resets, truncation, and engine-process failure; random rollouts alone are insufficient.
- Follow [phase verification](development.md#phase-verification); add focused Python/adapter checks and Linux installation verification. Keep research dependencies and execution outside the production app.
- Resolve exact Python/dependency versions during the adapter pilot and pin them. Record selected integration decisions; publish to a registry only after independent installation/use validation.

Defer C++ and other language APIs until a concrete consumer requires them; defer acceleration/backend selection to Step 4. A language binding alone does not accelerate simulation. A random-rollout example is the cheaper first milestone, but does not establish learner compatibility.

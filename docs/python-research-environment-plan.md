# Python Research Environment Plan

Status: All four phases complete (2026-10-09); [Research Step 3](open-source-roadmap.md) is ready for an external trial.

## Goal and difficulty

Let Python researchers run experiments and compare bots without understanding TypeScript. Provide a usable environment, replaceable reward, and integration example; researchers choose models and training. No competitive bot or substantial training run required.

Moderate-to-high difficulty: legal-action coverage and encoding are the main uncertainty; cross-language lifecycle and multi-agent reward delivery add integration work. Use four sequential phases with completion gates, not separate architectural projects.

## Scope

- Target [PettingZoo AEC](https://pettingzoo.farama.org/api/aec/); validate space/encoding compatibility before adoption. Reuse the TypeScript engine through a persistent local process; no HTTP service or rules port.
- Assume PettingZoo familiarity in the quickstart; explain only project-specific setup, observations, actions, and outcomes.
- Favor compatibility with existing training workflows; validate the concrete learner integration before claiming trainer support.
- Support both Rulesets and their setup choices. Each episode is one Hand, never a Match; existing Templates supply subsequent-Hand contexts without carrying progression between episodes.
- Keep engine outcomes separate from replaceable research rewards. Score both caught opponents and the first-finisher team's next-Hand Dealer advantage, including draws; see below.
- Require Linux verification. Include the built engine in the Python package and launch it automatically; Node.js is an accepted prerequisite, with no TypeScript build for users. Support Windows only if implementation and verification are inexpensive; it is not a completion gate.

## Team evaluation and reward

Target duplicate team evaluation (`同牌换边对战`): two policies each control one team, then swap teams on the same Template. Preserve seat-indexed cards, rules, Dealer Team, Trump Rank, and setup context. Each run remains an independent Hand. Freeze policies and reset per-seat memory between runs; teammates may share model weights, never private observations or memory.

The first-finisher team's terminal score reflects caught opponents and its next-Hand Dealer status under the [Hand Result rules](ruleset.md#2-hand-result):

| Ruleset | Caught opponents | Score |
| --- | --- | --- |
| Six-player | 3 / 2 / 1 / 0 | 8 / 5 / 3 / 1 |
| Four-player | 2 / 1 / 0 | 5 / 3 / 1 |

Zero caught means an engine draw, but the first-finisher team still earns 1 for becoming the next Dealer Team. The opposing team receives the equal negative score, including -1 on draws; team scores sum to zero. Do not invent a Finish Position for unfinished players or change the engine outcome. Deliver the team reward to every teammate, including early finishers; count each team score once in evaluation.

Compare paired scores from each bot's perspective across multiple Templates; report Rulesets separately, alongside outcomes and bot failures. Phase 4 supplies a small runner, not tournament infrastructure.

## Failure handling

Distinguish normal completion, action-limit truncation, and engine failure. Only completed Hands receive terminal scores; truncation has no Hand result. Prevent engine failures through validation and regression checks; report failures explicitly, never as draws or fabricated scores. The adapter rejects invalid actions without changing state; battle-runner fallback is separate.

Bot timeout/error fallback belongs to the battle runner, not core rules. Defaults: stop on bot failure; no decision deadline for trusted local policies. Optional `decision_timeout` uses one spawned process per seat; include input transport but exclude observation generation, with startup separately bounded to at least ten seconds. Terminate timed-out seats; optional fallback handles their remaining decisions. Factories must be importable/picklable in timeout mode; factory failure stops the leg.

Optional fallback: Pass when available; otherwise lead the standard display's rightmost single (descending rank strength, suits SHCD, ascending copy); setup uses the first canonical legal candidate. Record every intervention. Incomplete pairs never contribute evaluation scores; completed pairs with interventions retain their failure records.

## Plan

| Phase | Work | Completion gate |
| --- | --- | --- |
| 1. Step-driven reference | Extract reset/observe/step/completion from the headless runner; retain the runner as a caller. Reuse existing validation and recording. | Both Rulesets preserve setup order, private submissions, results, and deterministic replay; existing callers still work. |
| 2. Observations and legal actions | Expose permitted observations, public history, team roles, and legal setup/play choices. Prototype versioned encodings against AEC spaces and one intended learner. | Generated actions pass engine validation; small exhaustive cases check completeness. Resolve candidate sizes and learner compatibility before freezing the encoding; never silently cap legal choices. |
| 3. Python adapter | Implement AEC over the persistent engine process, with seeded resets, validated messages, explicit errors, and process cleanup. Keep reward policy outside core rules. | Upstream API checks and cross-language privacy/replay checks pass. Termination differs from truncation; players who finish early still receive terminal team rewards. |
| 4. Package and example | Provide an installable package, quickstart, legal-random rollout, replaceable team reward, duplicate evaluation runner, and one tiny learner integration check. Record versions/configuration/seeds and rollout/bridge timings. | A clean Linux installation outside the checkout runs both Rulesets and setup scenarios using Python and Node.js. Paired runs preserve setup and swap policies without memory leakage. The learner consumes trajectories and performs an update; strength is not a gate. |

Phase 1: [session API](development.md#headless-reference) implemented; reset creates a fresh session, and existing runners/replay use the same state machine. `pnpm check` passed (390 tests), as did 13 Chromium cases. Pre-change first-Hand/tied-setup Challenge records match for both Rulesets and replay unchanged. Astra review found no actionable issues; coordinator checked the diff and compatibility independently.

Phase 2: [Research Encoding](research-encoding.md) exposes permitted history, team identity, complete legal choices, and versioned candidate features. `pnpm check` passed (398 tests), as did 13 Chromium cases and 12 Python space/scorer snapshots. Astra review found no runtime defects; independently validated response-coverage improvements were implemented by a different worker. Use candidate-conditioned scoring and replaceable tensor encoders. Opening enumeration takes roughly 3–5 seconds; retain this correctness reference for Step 4 profiling.

Phase 3: [AEC adapter](development.md#python-research-adapter) uses one persistent Node process, seeded resets, versioned requests, and isolated observations. Native status/public outcomes separate completion, truncation, and private records. Python supplies replaceable zero-sum team rewards, including early finishers and Dealer advantage on draws. Astra findings on blocked writes and encoding versioning were independently validated and fixed by another worker. Passed 401 repository tests, 13 Chromium cases, six adapter checks on Linux and Windows, and 12 encoding/scorer snapshots. CI includes the adapter checks. Direct PyTorch candidate scoring works; the standard TorchRL 0.14.0 wrapper fails on variable-length observations and is not supported.

Phase 4: [Installable wheel and Chinese quickstart](../packages/headless/python/README.md), legal-random rollout, completed-trajectory PyTorch update, and duplicate team runner implemented. Clean installations outside the checkout completed both Rulesets' setup scenarios on Linux and Windows. Both platforms passed three example checks and six evaluation checks, including four swapped/replayed Hands and timeout cleanup; 401 repository tests and 13 Chromium cases passed. Astra's stale-engine selection finding was independently confirmed and fixed by a different worker; the focused regression passed. No competitive training or registry publication. Trial feedback should select the representative Step 4 workload.

## Constraints and verification

- Keep seeds, Templates, authoritative state, and private records outside actor observations; legal choices must not reveal hidden information. Preserve setup disclosure rules and per-player policy memory.
- Reuse Step 2 scenarios and replay checks. Cover multi-card Plays, Automatic Response Closure, ties, early finishers, invalid actions, repeated resets, truncation, and engine-process failure; random rollouts alone are insufficient.
- Follow [phase verification](development.md#phase-verification); add focused Python/adapter checks and Linux installation verification. Keep research dependencies and execution outside the production app.
- Resolve exact Python/dependency versions during the adapter pilot and pin them. Record selected integration decisions; publish to a registry only after independent installation/use validation.

Phase 4 uses direct PyTorch candidate features for a tiny completed-trajectory regression update; no strength claim. Do not infer trainer compatibility from valid AEC spaces.

Defer C++ and other language APIs until a concrete consumer requires them; defer acceleration/backend selection to Step 4. A language binding alone does not accelerate simulation. A random-rollout example is the cheaper first milestone, but does not establish learner compatibility.

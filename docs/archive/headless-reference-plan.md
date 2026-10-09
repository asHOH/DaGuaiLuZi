# Headless Reference Plan

Status: Archived implementation record for [Research Step 2](../open-source-roadmap.md); all three phases complete (2026-10-08).

## Goal and difficulty

Prepare the real engine for other researchers, primarily for RL training. Step 2 provides reliable, reproducible Hands; Step 3 adds the researcher-facing interface and training example.

Moderate difficulty. The engine already runs independently, and existing helpers play Hands and handle setup. The main work is separating setup, player decisions, and evaluation while preserving hidden information and reproducibility.

[CLI and record contract](../development.md#headless-reference).

## Plan

| Phase | Work | Completion gate |
| --- | --- | --- |
| 1. Headless runner | Add a private `packages/headless` package using `game-core`. Extract the existing passive opponent policy for reuse by the runner, playground, and browser tests. | Both Rulesets finish first Hands without browser, accounts, HTTP, or SQLite; existing opponents still work. |
| 2. Setup and privacy | Support subsequent-Hand Challenge Templates, Tribute/Return choices, recipient/leader ties, and fallback rounds. Use the effective Hand configuration. | Both Rulesets finish setup scenarios; policies receive only their own permitted observations. Capture results before completion clears active views. |
| 3. Reproduction and evaluation | Record versioned setup/actions; add replay, outcome/action counts, and a small documented CLI. | A fresh process re-executes actions through the engine and reproduces events, observations, and results without calling policies. Invalid records fail clearly. |

## Constraints and verification

- Reuse `decide`, `evolve`, `derivePlayerView`, existing validation, and deterministic test scenarios. No engine rewrite or new third-party library.
- Keep state, seeds, Templates, and raw events outside policies; isolate policy memory per seat. The runner binds actors, schedules setup deterministically, and fails on invalid actions or an action limit.
- Record source/format/rules/randomness versions, resolved configuration, seeds or Template, seating, ordered setup/actions, and expected events/result. Validate file inputs; keep records separate from browser Replay.
- Cover both Rulesets/presets, seating policies, setup branches, hidden ballots, completion cleanup, replay, and invalid actions. Include scripted multi-card Plays and Automatic Response Closure; passive opponents alone cannot cover them.
- Follow [phase verification](../development.md#phase-verification): focused checks, review, `pnpm check`, then existing browser checks. Keep research execution outside the production app.

Defer exhaustive legal-action generation, training encodings/rewards, research-framework adapters, and training to Step 3; performance work to Step 4. A first-Hand demo script is cheaper but does not meet Step 2's privacy/setup/replay gate.

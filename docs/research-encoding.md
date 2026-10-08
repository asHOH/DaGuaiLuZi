# Research Observation and Action Encoding

Status: `dglz-research-2`; native reference plus Python space/scorer prototype. The live AEC adapter is Step 3 phase 3.

## Native contract

`session.observeResearch(playerId)` returns `encodingVersion`, accepted `actionCount`, player/seat/team identity, scheduled `currentPlayerId`, a projected private `view`, `publicHistory`, `legalActions`, and matching `actionFeatures`. Team is logical seat modulo two; identities survive completion cleanup. Only the scheduled player receives choices. Completed and inactive observations have empty choice lists.

Version 2 explicitly selects gameplay fields, including nested objects, from existing private views and public events. It excludes Room identity/ownership/members, configuration locks, activity selection, redundant effective Ruleset ID, and app completion summaries; outcomes remain in public history. Ordinary `observe()` and private replay records are unchanged. Review any field additions as research contract changes; bump the encoding version when its shape or meaning changes.

Repeated reads for one player return the same immutable snapshot until an accepted step clears all players' cached snapshots. Rejected steps retain them; new sessions have independent caches. The session retains at most one snapshot per player for its current state.

`legalActions(view, playerId)` uses only that player's permitted view and the existing rule evaluator. It enumerates unordered physical card subsets of sizes 1/2/3/5, legal responses and Pass, eligible Tributes, distinct-rank Return offers, Return selections, and tie candidates/abstention. Card-list order is canonical; distinct physical copies remain distinct choices. Setup scheduling belongs to the session, not this pure helper.

Public history retains Plays, Passes, finishing/turn/lead changes, disclosed Tribute transfers, Return offers, resolved tie rounds, and outcomes. It excludes seeds, Templates, private Tribute selections, and unresolved ballot contents. Return-transfer facts omit the selected card, matching live-view disclosure. Research observations never gain evaluator-only history after completion. Roots, lists, actions, and event payloads are immutable snapshots.

## Candidate encoding

An action ID is its zero-based index in the current observation's candidate list. It has no meaning across steps, resets, or encoding versions. Submit its native payload through `session.step(observation.legalActions[id])`; the engine still validates it. Do not retain candidate IDs across observations.

Each feature row contains nine integers:

| Columns | Encoding |
| --- | --- |
| 0 | Play=0, Pass=1, SelectTributeCard=2, OfferReturnCandidates=3, SelectReturnCard=4, SubmitTieChoiceBallot=5. |
| 1–5 | Ascending physical card IDs, then zero padding. IDs 1–162 enumerate ranks 2..A, suits SHDC, then SMALL/BIG; each face has copies 1..3. |
| 6 | Ballot target seat+1; zero for abstention or non-ballot actions. |
| 7–8 | Tie kind: none=0, recipient=1, leader=2; round: none=0, otherwise 1..3. |

Gymnasium row space: `MultiDiscrete([6,163,163,163,163,163,7,3,4])`. Candidate space: `Sequence(row, stack=True)`; candidate-ID action space: `Discrete(101963)`. The bound is `1 + C(28,1) + C(28,2) + C(28,3) + C(28,5)`: 27 dealt cards plus at most one pending Tribute, covering every supported choice and Pass. It is a proven bound, not pruning. A mask enables exactly the first N IDs; the learner need only score N rows.

## Python prototype and limits

The probe uses [AEC-compatible Gymnasium spaces](https://pettingzoo.farama.org/api/aec/), lossless UTF-8 JSON context in `Sequence(Discrete(256))`, candidate rows, and a fixed mask. Context retains the complete view, identity, and public history; researchers provide task-specific tensor encoders. The example [DMC-style](https://github.com/kwai/DouZero) PyTorch scorer selects hand/seat/hand-size features and scores each candidate independently. This demonstrates variable-size forward-pass compatibility, not training quality or compatibility with unmodified fixed-output trainers.

After building headless dependencies, run `uv run --python 3.12 packages/headless/research/encoding_probe.py`. Its inline dependencies are pinned; Python 3.12 and Node.js are required. It generates real four/six-player, setup, inactive, and terminal samples; checks spaces, lossless context, card-ID mapping, masks, and scorer outputs. Full AEC API/termination checks belong to phase 3; trajectory learning and clean Linux installation to phase 4.

The correctness-first generator tests up to 80,730 five-card subsets on an open 27-card Hand. Sampled openings (`research-measure`, autonomous preset, randomized seats) produced 715/862 choices in roughly 3–5 seconds on the first observation; repeated reads reuse the snapshot. These are not throughput guarantees. Keep it as the reference for Step 4. No candidate pruning or fixed-size neural output is required; masks cost about 100 KB per observation and can be derived from N rather than stored in replay.

# Research Observation and Action Encoding

Status: `dglz-research-3`; native reference and [packaged AEC environment with a learner example](../packages/headless/python/README.md).

## Native contract

`session.observeResearch(playerId)` returns `encodingVersion`, accepted `actionCount`, player/seat/team identity, scheduled `currentPlayerId`, a projected private `view`, `publicHistory`, `legalActions`, and matching `actionFeatures`. Team is logical seat modulo two; identities survive completion cleanup. Only the scheduled player receives choices. Completed, truncated, and inactive observations have empty choice lists.

Version 2 explicitly selects gameplay fields, including nested objects, from existing private views and public events. It excludes Room identity/ownership/members, configuration locks, activity selection, redundant effective Ruleset ID, and app completion summaries; outcomes remain in public history. Ordinary `observe()` and private replay records are unchanged. Review any field additions as research contract changes; bump the encoding version when its shape or meaning changes.

Version 3 clears the scheduled actor and choices on truncation. The native session's `currentPlayerId` getter still identifies the unfinished actor; use `status` to distinguish completion and truncation.

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

After building headless dependencies, run `uv run --python 3.12 packages/headless/research/encoding_probe.py`. Its inline dependencies are pinned; Python 3.12 and Node.js are required. It generates real four/six-player, setup, inactive, and terminal samples; checks spaces, lossless context, card-ID mapping, masks, and scorer outputs. Live AEC/termination, completed-trajectory updates, and isolated package installation use the [development checks](development.md#research-package-and-examples).

Phase 3 pilot: TorchRL 0.14.0 with PyTorch 2.14.1 fails to reset through its standard PettingZoo wrapper on these variable-length observations, even after casting context bytes to integers. Do not claim unmodified TorchRL support. The package's direct PyTorch example performs one regression update from completed-Hand candidate features and terminal rewards; it is an integration check, not a competitive policy. Neither pad to an arbitrary cap nor remove legal choices for trainer compatibility.

The generator still tests up to 80,730 five-card subsets on an open 27-card Hand. The shared classifier rejects impossible repeated-rank patterns before enumerating rank assignments; complete legal choices and their order are unchanged. Repeated reads reuse the snapshot. Masks cost about 100 KB per observation and can be derived from N rather than stored in replay.

### Local performance pilot (2026-10-09)

Windows, Ryzen 9 8940HX (16 cores/32 threads), 31.2 GiB usable RAM, Node.js 24.11.0, Python 3.12.12. Baseline: `ced8724`. No model training. One before/after run per case; these are local samples, not throughput guarantees.

| Workload | Before | After |
| --- | ---: | ---: |
| Four-player opening observation, 715 choices | 3.896 s | 0.181 s |
| Six-player opening observation, 862 choices | 3.845 s | 0.144 s |
| Four-player Python Hand, 120 actions | 25.57 s | 12.40 s |
| Six-player Python Hand, 235 actions | 46.79 s | 13.04 s |

Opening cases use `encoding-fixtures.mjs` with the Node CPU profiler (`research-measure`, 自主, randomized seats). The baseline profile spent about 6.5 seconds in repeated-pattern generation/target checks. Full Hands use `dglz_examples.py --players 4 --seed 7` and `--players 6 --seed 7`, default 省心/fixed seats/recording, without `--learn`; totals include engine startup and observation transport. Other engine calls took 0.56/1.00 seconds before and 1.94/2.21 seconds after, illustrating runtime noise; do not infer isolated bridge overhead from these totals.

The shared-classifier optimization preserves legal choices, ordering, and classifications, so no encoding or engine semantic-version change is needed. Representative training throughput, peak memory, and backend selection remain Step 4 work.

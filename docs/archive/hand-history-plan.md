# Completed-Hand History and Replay

Historical record; current requirements and guidance take precedence. See [AGENTS.md](../../AGENTS.md).

Status: All three phases verified.

Shared contract: a completed Hand is addressed by stable `(roomId, handStartSequence)`. Its summary contains participants in recorded seat order, Ruleset and resolved Rules Configuration, Seating Policy, Hand number and activity, result, Finish Positions, Team Levels, completion time, and an optional existing Challenge Code. Code creation remains lazy through the existing participant endpoint.

Replay adds the original seat-ordered deal and read-only server snapshots. The first frame precedes Tribute; later steps group a choice/play with its resulting events, including automatic setup and settlement. Ballot contents appear at resolution. Sequence defines playback order; playback position stays in the browser. The viewer opens from completed-Hand history or a Challenge Code.

Phase 3: `/history` lists the signed-in account's completed Hands and opens participant Replay directly. Shared links use `#replay=<Challenge Code>`; private references use `#hand=<Room>/<sequence>`. Fragments survive login/reload without entering server request URLs. Sharing generates Codes lazily. Replay offers manual steps, a native progress slider, automatic playback, and a new-Room entry into existing Challenge selection. Keep the felt/ivory/brass palette, Chinese system typography, readable DOM cards, and restrained motion; no new dependencies.

| Phase | Scope | Gate |
| --- | --- | --- |
| 1 | Backend history listing and read access across Rooms. Use recorded participation for authorization; authenticated Challenge Code holders use the existing lookup path. Include completed Hands from completed or aborted Matches and completed Challenge Hands; exclude unfinished or aborted Hands. | History survives membership changes and restart; unrelated accounts cannot open it; references and summaries use the shared contract. |
| 2 | Add server-formatted Replay data using existing event evolution: the original deal before Tribute and ordered action steps grouping causal consequences. Build a minimal Chinese viewer with independent previous/next playback. Never expose a Hand Seed or Challenge Template. | Both Rulesets, initial and subsequent Hands, Tribute/Return, tie resolution, and Challenge Hands reach the recorded result without changing source events; unsupported history is rejected. |
| 3 | Complete the Chinese history list and responsive Replay journey, playback controls, Code/link sharing, and entry into the existing Challenge flow. Preserve shared links through login and reload. | History → Replay → Challenge passes on mobile and desktop; two viewers have independent positions; keyboard access and privacy checks pass. |

Each phase uses focused checks, Astra review, filtered fixes by a different Astra worker, and coordinator verification. Reuse persisted events, current authentication, and synchronous server formatting; no Replay Rooms or separate rules engine.

Phase 1 verification (2026-09-16): `pnpm check` passed (255 tests); all 3 browser journeys passed. Astra review found two coverage gaps; a separate Astra worker added legal Match-completion and ownership-transfer coverage, reviewed by the coordinator. Member departure/ownership-transfer persistence now supports historical-access checks; public Room controls remain deferred.

Phase 2 verification (2026-09-19): `pnpm check` passed (256 tests); all 3 browser journeys passed. Both Rulesets cover original deals, card ownership through Tribute/Return, tied choices, Match/Challenge settlement, restart, access, and source immutability. Browser checks cover independent positions, previous/next and first/final navigation, keyboard use, stale responses, and login expiry; 390/1280px screenshots inspected. Astra review fixes corrected viewer semantics, Trump Rank, and a misleading next-leader claim, reduced duplicate UI, and strengthened playback tests; a different Astra worker applied fixes and the coordinator reviewed them.

Phase 3 verification (2026-09-21): build, formatting, lint, typechecks, and 258 tests passed; affected web checks were rerun after a browser-only mount correction. All 3 browser journeys passed, with both Ruleset journeys rerun after reusing existing test sessions. Coverage includes history → Replay → shared-link login/reload → new Challenge play, private-link rejection, independent positions, keyboard seeking, autoplay/pause, clipboard fallback, reauthentication, and same-Room navigation. 390/1280px screenshots inspected. Astra reviewed correctness, complexity, and coverage; a separate Astra worker fixed accepted findings, followed by coordinator review. No dependencies added.

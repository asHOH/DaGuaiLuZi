# Completed-Hand History and Replay

Historical record; current requirements and guidance take precedence. See [AGENTS.md](../../AGENTS.md).

Status: All three phases complete.

Shared contract: a completed Hand is addressed by stable `(roomId, handStartSequence)`. Its summary contains participants in recorded seat order, Ruleset and resolved Rules Configuration, Seating Policy, Hand number and activity, result, Finish Positions, Team Levels, completion time, and an optional existing Challenge Code. Code creation remains lazy through the existing participant endpoint.

Replay adds the original seat-ordered deal and read-only server snapshots. The first frame precedes Tribute; later steps group a choice/play with its resulting events, including automatic setup and settlement. Ballot contents appear at resolution. Sequence defines playback order; playback position stays in the browser. The viewer opens from completed-Hand history or a Challenge Code.

Phase 3: `/history` lists the signed-in account's completed Hands and opens participant Replay directly. Shared links use `#replay=<Challenge Code>`; private references use `#hand=<Room>/<sequence>`. Fragments survive login/reload without entering server request URLs. Sharing generates Codes lazily. Replay offers manual steps, a native progress slider, automatic playback, and a new-Room entry into existing Challenge selection. Keep the felt/ivory/brass palette, Chinese system typography, readable DOM cards, and restrained motion; no new dependencies.

| Phase | Scope | Gate |
| --- | --- | --- |
| 1 | Backend history listing and read access across Rooms. Use recorded participation for authorization; authenticated Challenge Code holders use the existing lookup path. Include completed Hands from completed or aborted Matches and completed Challenge Hands; exclude unfinished or aborted Hands. | History survives membership changes and restart; unrelated accounts cannot open it; references and summaries use the shared contract. |
| 2 | Add server-formatted Replay data using existing event evolution: the original deal before Tribute and ordered action steps grouping causal consequences. Build a minimal Chinese viewer with independent previous/next playback. Never expose a Hand Seed or Challenge Template. | Both Rulesets, initial and subsequent Hands, Tribute/Return, tie resolution, and Challenge Hands reach the recorded result without changing source events; unsupported history is rejected. |
| 3 | Complete the Chinese history list and responsive Replay journey, playback controls, Code/link sharing, and entry into the existing Challenge flow. Preserve shared links through login and reload. | History → Replay → Challenge passes on mobile and desktop; two viewers have independent positions; keyboard access and privacy checks pass. |

Reuse persisted events, current authentication, and synchronous server formatting; no Replay Rooms or separate rules engine.

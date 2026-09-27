# MVP Roadmap

Status: [Challenge Hand integration](challenge-integration-plan.md), all [history/Replay phases](hand-history-plan.md), both [Room-control phases](room-controls-plan.md), and both [account administration phases](account-administration-plan.md) verified. Automated [MVP acceptance](mvp-acceptance.md) passed; real-device multiplayer is pending a shared test site/session. VPS staging is the next step toward that gate.

Delivery order only. [Product requirements](product-spec.md), [architecture](architecture.md), and [Challenge Hand policy](challenge-hand-sharing.md) remain authoritative. Inspect existing implementation before planning each phase; reuse completed work.

| Order | Scope | Completion gate |
| --- | --- | --- |
| 1 | Challenge Hand integration: completed-Hand Challenge Codes/Templates, Room selection, play, settlement, abortion, and code reuse. | Same source setup supports independent Challenge Hands; source history stays unchanged; aborted Hands expose no completed history. |
| 2 | [Completed-Hand history and Replay](hand-history-plan.md): backend history/access, Replay data/minimal viewer, and the complete UI journey using the same Challenge Codes. | Participants find completed Hands; authenticated code holders open Replay or start challenges; viewers have independent playback positions; incomplete Hands stay private. |
| 3 | [Remaining Room controls](room-controls-plan.md): lobby leave/ownership transfer, final-owner exit or healthy-lobby closure, Seating Policy, interrupted-Room archival/replacement. | The final owner can leave or close a healthy lobby; lifecycle controls preserve authority, history, and configuration locks. |
| 4 | [Account administration](account-administration-plan.md): password change, administrator reset, audit, and session revocation. | Players change passwords; provisioning/reset works through CLI; audited mutations revoke affected sessions and protect private state. |
| 5 | [MVP acceptance](mvp-acceptance.md): both Rulesets, Match → history → Replay → Challenge, recovery, privacy, and responsive/accessibility checks. | Automated gates and a real multiplayer session on mobile/desktop pass. |
| 6 | VPS release: Docker artifact, persistent SQLite volume, explicit migrations, operating instructions, and existing `cloudflared` tunnel. | Invited friends can play over HTTPS; application/container restarts retain committed data. |

Follow [phase verification](development.md#phase-verification) for implementation phases. Mark completion only after verification; create detailed phase plans when work begins.

Deferred: spectators, Room discovery, turn timing, connection-driven pause, and off-VPS backups. CLI account administration is sufficient for MVP.

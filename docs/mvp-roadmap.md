# MVP Roadmap

Status: Gameplay integration verified; Challenge Hand integration next.

Delivery order only. [Product requirements](product-spec.md), [architecture](architecture.md), and [Challenge Hand policy](challenge-hand-sharing.md) remain authoritative. Inspect existing implementation before planning each phase; reuse completed work.

| Order | Scope | Completion gate |
| --- | --- | --- |
| 1 | Challenge Hand integration: completed-Hand Challenge Codes/Templates, Room selection, play, settlement, abortion, and code reuse. | Same source setup supports independent Challenge Hands; source history stays unchanged; aborted Hands expose no completed history. |
| 2 | Completed-Hand history, read-only Replay, and sharing using the same Challenge Codes. | Participants find completed Hands; authenticated code holders open Replay or start challenges; viewers have independent playback positions; incomplete Hands stay private. |
| 3 | Remaining Room controls: lobby leave/ownership transfer, final-owner exit or healthy-lobby closure, Seating Policy, interrupted-Room archival/replacement. | The final owner can leave or close a healthy lobby; lifecycle controls preserve authority, history, and configuration locks. |
| 4 | Remaining account administration: password change, administrator reset, audit, and session revocation. | Provisioning/reset works through CLI; revoked sessions cannot act. |
| 5 | MVP acceptance: both Rulesets, Match → history → Replay → Challenge, recovery, privacy, and responsive/accessibility checks. | Automated gates and a real multiplayer session on mobile/desktop pass. |
| 6 | VPS release: Docker artifact, persistent SQLite volume, explicit migrations, operating instructions, and existing `cloudflared` tunnel. | Invited friends can play over HTTPS; application/container restarts retain committed data. |

Follow [phase verification](development.md#phase-verification) for implementation phases. Mark completion only after verification; create detailed phase plans when work begins.

Deferred: spectators, Room discovery, turn timing, connection-driven pause, and off-VPS backups. CLI account administration is sufficient for MVP.

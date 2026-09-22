# Remaining Room Controls

Status: Phase 1 verified, 2026-09-22; Phase 2 deferred.

| Phase | Scope | Gate |
| --- | --- | --- |
| 1 | Lobby departure with existing automatic ownership transfer; last-member departure archives the Room. Owner edits Seating Policy until its first Match/Challenge starts. | Atomic departure/retries, other-tab cleanup, restart, authority/locks, retained history/Replay, and mobile/desktop controls pass. |
| 2 | Interrupted-Room archival/replacement, including safe controls after failed recovery. | Replacement copies only Rules Configuration; source history and authority are preserved. |

Phase 1 reuses existing events and the Room executor. Departure returns a minimal receipt instead of a member view; connected tabs lose Room access. No manual owner picker or closure with other members present. Leaving a page does not leave membership. Keep existing visual direction and Chinese copy.

Each phase follows [verification](development.md#phase-verification): focused checks, Astra review, filtered fixes by a different Astra worker, coordinator verification, then project/browser gates.

Phase 1 verification: `pnpm check` passed (264 tests); all three browser journeys passed. After final UI labeling/spacing fixes, affected web build, tests, lint, formatting, and browser journeys passed; 390/1280px screenshots inspected. Coverage includes atomic departure rollback, ownership transfer, archived history/Replay/Code access, restart/deduplication, multiple tabs, uncertain exit retries, and Match/Challenge Seating Policy locks. Astra review found no actionable correctness, privacy, or over-engineering issues. No dependencies added.

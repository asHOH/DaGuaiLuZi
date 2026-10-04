# Remaining Room Controls

Historical record; current requirements and guidance take precedence. See [AGENTS.md](../../AGENTS.md).

Status: Phases 1–2 verified, 2026-09-22.

| Phase | Scope | Gate |
| --- | --- | --- |
| 1 | Lobby departure with existing automatic ownership transfer; last-member departure archives the Room. Owner edits Seating Policy until its first Match/Challenge starts. | Atomic departure/retries, other-tab cleanup, restart, authority/locks, retained history/Replay, and mobile/desktop controls pass. |
| 2 | Interrupted-Room archival/replacement, including safe controls after failed recovery. | Replacement copies only Rules Configuration; source history and authority are preserved. |

Phase 1 reuses existing events and the Room executor. Departure returns a minimal receipt instead of a member view; connected tabs lose Room access. No manual owner picker or closure with other members present. Leaving a page does not leave membership. Keep existing visual direction and Chinese copy.

Phase 2: owner-only archival or replacement of an Interrupted Room. Replacement copies the Room's Match Rules Configuration only, starts with the requesting owner, fixed seating, no seat/readiness/activity, and unlocked settings. Creation and its retry receipt commit together; source events/membership stay unchanged. Archived Rooms are read-only. Recovery uses a versioned, seed-free control record committed with events; mismatched/missing controls fail closed. Compatible legacy Rooms gain controls on access; already unreadable legacy Rooms need administrator assistance. Incompatible history remains explicitly unavailable.

Each phase follows [verification](../development.md#phase-verification): focused checks, Astra review, filtered fixes by a different Astra worker, coordinator verification, then project/browser gates.

Phase 1 verification: `pnpm check` passed (264 tests); all three browser journeys passed. After final UI labeling/spacing fixes, affected web build, tests, lint, formatting, and browser journeys passed; 390/1280px screenshots inspected. Coverage includes atomic departure rollback, ownership transfer, archived history/Replay/Code access, restart/deduplication, multiple tabs, uncertain exit retries, and Match/Challenge Seating Policy locks. Astra review found no actionable correctness, privacy, or over-engineering issues. No dependencies added.

Phase 2 verification: `pnpm check` passed (269 tests); all three browser journeys passed; both Rulesets' 390/1280px interrupted views inspected. Coverage includes failed recovery, invalid/stale/missing controls, owner/member access, hidden-state exclusion, atomic replacement rollback, restart/retries, retained source events/Replay, compatible interruption, keyboard replacement, and read-only archival. Astra review found no actionable correctness, privacy, or over-engineering issues. No dependencies added.

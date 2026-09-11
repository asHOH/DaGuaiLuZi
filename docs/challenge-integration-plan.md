# Challenge Hand Integration

Scope: [Challenge Hand Sharing](challenge-hand-sharing.md). Reuse the existing core; history/Replay UI follows separately.

| Phase | Scope | Gate |
| --- | --- | --- |
| 1 | Completed-source Templates, stable Codes, participant creation, authenticated public lookup. | Both Rulesets reproduce initial/subsequent setup; retries/restarts keep one Code; incomplete/aborted Hands remain unavailable. |
| 2 | Protocol/executor integration for Challenge selection, connected start, play, completion, abort, and recovery. | Independent Code reuse preserves the source; one-Hand completion and abort privacy hold. |
| 3 | Chinese Code sharing/entry, Challenge setup/results, browser acceptance. | Both Ruleset journeys pass. |

Phase 1 materializes a Template/Code on the first participant request, serialized by the source Room executor. `(Room ID, Hand start-event sequence)` identifies the source across Matches; SQLite enforces uniqueness. A Code contains 128 random bits. Lookup receives it in a POST body and returns only public configuration/levels; no Template, Seed, or source identities cross HTTP. Unsupported persisted versions are rejected.

Per phase: focused checks, Astra review, filtered fixes by a different Astra worker, coordinator verification, then report.

Phase 1 verified: `pnpm check` (240 tests) and all three browser regressions passed. Astra review found no actionable code issues; a different Astra worker added the accepted logging-privacy check, reviewed by the coordinator. Phase 2 is next.

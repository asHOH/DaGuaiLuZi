# Account Administration

Status: Phase 1 verified, 2026-09-26. Phase 2 not started.

Reuse existing provisioning, Argon2id, cookie sessions, HTTP/socket authorization, and client reauthentication. Follow [account policy](architecture.md#account-access).

| Phase | Scope | Gate |
| --- | --- | --- |
| 1 | Shared credential/session operations; transactional audit records; administrator CLI password reset and account-wide session revocation. Audit existing provisioning and logout; document commands and audit inspection. | Reset accepts only the new password; revoked sessions cannot authorize HTTP/socket actions or receive new private views. Audit failure rolls back the associated mutation. |
| 2 | Authenticated password-change endpoint and a small Chinese account form using current password, new password, and confirmation. Reuse Phase 1 operations and existing logout/reauthentication handling. | Wrong current password changes nothing; success signs out all sessions, clears private client state, and permits login with the new password. Mobile/desktop and multiple-tab flows pass. |

Phase 2 depends on Phase 1; audit and revocation ship with each operation, not as later hardening.

Proposed defaults:

- Password change/reset revokes every session, including the caller's; ordinary logout still revokes only its session. Account identity, Room membership, and history remain intact.
- Store append-only account audit records separately from Room events: action, actor/source, target account, and server time. Never store passwords, password hashes, or session tokens in audit records or logs.
- Commit credential/session mutations and their audit record together. Guard against stale in-flight login/password checks and recheck authorization when queued work executes. Reuse session checks before private-view delivery; no periodic socket polling.
- Reuse validation, origin protection, and throttling for password changes. CLI secrets stay out of command arguments and output; all UI/CLI messages are Chinese.

Verification: focused SQLite, CLI, HTTP, and socket checks for rollback, concurrent reset/login/change, queued revocation, multiple sessions, restart persistence, and secret exclusion; then [phase verification](development.md#phase-verification). Apply the required Luna reviewer step whenever a Luna worker changes code.

Keep administration CLI-only. Defer an admin dashboard, email recovery, roles, and a device/session inventory.

Phase 1 verification: `pnpm check` passed (284 tests); all three browser journeys passed. Coverage includes audit rollback, migration/reopen, CLI secret exclusion, multiple sessions, in-flight login, queued operations, and private acknowledgements. Astra review found one valid room-creation race while waiting for SQLite's write lock; a different Astra worker fixed it, and the coordinator reviewed the result. Its regression fails without the guard and passes with it. No other actionable review findings or new dependencies.

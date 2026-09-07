# Web integration slice

Status: implemented and verified (2026-09-07). Scope: responsive Chinese browser UI through the initial Hand and successful reconnect. `pnpm check` and both Ruleset browser journeys pass; correctness, complexity, and test-coverage reviews completed.

Follow [architecture](architecture.md), [ADR 0001](decisions/0001-initial-application-stack.md), [product requirements](product-spec.md), and [domain vocabulary](../CONTEXT.md). The existing server scope is recorded in [development](development.md#server).

## Implementation

1. Record a concise palette, Chinese-capable typography, material, and reduced-motion direction per [UI guidance](architecture.md#mvp-ui-guidance). Build `apps/web` with React/Vite, CSS variables/Modules, semantic cards, and local state/context.
2. Wire same-origin HTTP and Socket.IO: Vite development proxy, Fastify delivery of built assets, existing cookie sessions, and protocol compatibility. Add authenticated `GET /api/session`, returning the existing login account shape (`accountId`, `username`) or `unauthorized`, with `Cache-Control: no-store`; restore identity before opening a Room. Reuse `packages/protocol` validation; keep `game-core` server-only.
3. Add login/logout, Room creation for either Ruleset with fixed/randomized seating, join by code/link, owner Match selection, seats, and readiness. Use the server's `省心` default and administrator-provisioned accounts; render the server-provided Rules Configuration.
4. Render the authoritative lobby and initial Hand: seats/teams, Trump Rank, Team Levels, current actor, and only the account's private cards. Support mobile and desktop without gameplay controls.
5. Implement full-view synchronization and the failure behavior below; document local startup and browser-test commands.

## Synchronization contract

- Lock Room actions during initial connection, disconnect, and resynchronization; show `正在同步牌局…`. A socket connection alone does not unlock actions: a validated current-connection full view does.
- Join bootstrap is the exception: a non-member connects without a Room ID and submits only `JoinRoom`, initially with revision `1`. On an explicit stale-revision rejection, retry with its `currentRevision` and a new command ID; no private view is available before membership. An uncertain join retries the identical command. Its validated success view unlocks Room actions; existing members reconnect with the Room ID normally.
- Replace the view atomically. Within the current Room/connection, never let an older acknowledgement or view roll back its revision; discard callbacks from superseded connections or Rooms.
- Except for join bootstrap, submit commands using the displayed revision and a unique command ID. Prevent duplicate submissions while pending. A retry of an uncertain command retains its ID and exact payload/revision; do not buffer new actions while offline.
- Except for join bootstrap, on stale revision or uncertain delivery, synchronize before accepting further actions. Session expiry returns to login; incompatible protocol requires reload. Map failures to Chinese messages.
- Preserve the Room URL across reloads and restore the account-specific view through the existing session. The server remains authoritative; no optimistic game state or client-driven auto-start.
- On logout, expiry, or account change, clear the private view and pending commands, close the old socket, and discard its callbacks before restoring another account.

## Acceptance

- Playwright: one happy path per Ruleset through login → create/join → Match selection → seat/ready → connected auto-start → private initial Hand. Use one or two browser contexts and protocol clients for remaining seats.
- Verify reload and disconnect/reconnect restore the same Room/Hand and lock actions until synchronized; check private-card isolation and usable mobile/desktop layouts.
- Join from a fresh browser using only an invite link, including a Room beyond revision `1`, concurrent joins, and a lost join acknowledgement. Verify lobby reload restores the correct owner, seat, and readiness controls through `/api/session`, and account changes cannot retain the previous account's private view.
- Focused client checks cover older acknowledgements, superseded-connection callbacks, uncertain-command retry identity, stale revisions, expired sessions, and reload-required responses.
- `pnpm check` and the documented browser checks pass, including a smoke check of built assets served by Fastify with working HTTP/session/socket access.

## Deferred

Add `自主` preset selection after this slice passes, before Tribute/Return Card UI. Reuse core configuration replacement and persist complete configurations; no database migration is expected, and existing Rooms retain their settings.

Play/pass and subsequent Hand phases, abort, Challenge Hands, history/Replay, public registration, deployment, elaborate artwork, and additional routing/state frameworks. The next three phases are defined in [Gameplay integration](gameplay-integration-plan.md).

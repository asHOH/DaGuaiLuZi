# Web integration slice

Status: implemented and verified (2026-09-07). Scope: responsive Chinese browser UI through the initial Hand and successful reconnect. `pnpm check` and both Ruleset browser journeys pass; correctness, complexity, and test-coverage reviews completed.

Historical record of this slice.

## Implementation

1. Record a concise palette, Chinese-capable typography, material, and reduced-motion direction per [UI guidance](architecture.md#mvp-ui-guidance). Build `apps/web` with React/Vite, CSS variables/Modules, semantic cards, and local state/context.
2. Wire same-origin HTTP and Socket.IO: Vite development proxy, Fastify delivery of built assets, existing cookie sessions, and protocol compatibility. Add authenticated `GET /api/session`, returning the existing login account shape (`accountId`, `username`) or `unauthorized`, with `Cache-Control: no-store`; restore identity before opening a Room. Reuse `packages/protocol` validation; keep `game-core` server-only.
3. Add login/logout, Room creation for either Ruleset with fixed/randomized seating, join by code/link, owner Match selection, seats, and readiness. Use the server's `省心` default and administrator-provisioned accounts; render the server-provided Rules Configuration.
4. Render the authoritative lobby and initial Hand: seats/teams, Trump Rank, Team Levels, current actor, and only the account's private cards. Support mobile and desktop without gameplay controls.
5. Implement the [synchronization contract](architecture.md#client-resynchronization); document local startup and browser-test commands.

## Acceptance

- Playwright: one happy path per Ruleset through login → create/join → Match selection → seat/ready → connected auto-start → private initial Hand. Use one or two browser contexts and protocol clients for remaining seats.
- Verify reload and disconnect/reconnect restore the same Room/Hand and lock actions until synchronized; check private-card isolation and usable mobile/desktop layouts.
- Join from a fresh browser using only an invite link, including a Room beyond revision `1`, concurrent joins, and a lost join acknowledgement. Verify lobby reload restores the correct owner, seat, and readiness controls through `/api/session`, and account changes cannot retain the previous account's private view.
- Focused client checks cover older acknowledgements, superseded-connection callbacks, uncertain-command retry identity, stale revisions, expired sessions, and reload-required responses.
- `pnpm check` and the documented browser checks pass, including a smoke check of built assets served by Fastify with working HTTP/session/socket access.

## Subsequent work

Presets, play/pass, subsequent Hands, and Match abort were delivered by [gameplay integration](gameplay-integration-plan.md).

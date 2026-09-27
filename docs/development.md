# Development

Use the Node.js version in `.node-version` and the pnpm version in `package.json`. Enable Corepack if `pnpm --version` does not match, then run `pnpm install`.

| Command | Purpose |
| --- | --- |
| `pnpm format` | Format supported files with Prettier. |
| `pnpm format:check` | Check formatting without changes. |
| `pnpm lint` | Run Oxlint correctness and type-aware rules. |
| `pnpm lint:fix` | Apply safe Oxlint fixes. |
| `pnpm typecheck` | Run package TypeScript checks. |
| `pnpm test` | Run package tests. |
| `pnpm build` | Build all packages and apps. |
| `pnpm check` | Run formatting, build, lint, typechecks, and unit/server tests. |
| `pnpm --filter @dglz/web test:browser` | Run browser checks against the current build. |
| `pnpm --filter @dglz/web test:acceptance` | Run the same journeys across the [acceptance browser matrix](mvp-acceptance.md). |

Prettier owns code/config formatting; Markdown is excluded to keep tables compact. Oxlint owns lint rules; TypeScript remains the typecheck authority. Lefthook checks staged formatting and lint before commit, then runs `pnpm check` before push. Run `pnpm exec lefthook install` if hooks are missing. GitHub Actions runs `pnpm check`, installs Chromium with its system dependencies, then runs browser checks against that build after a frozen-lockfile install.

Pin exact tool versions and upgrade them deliberately.

Remaining delivery order and completion gates: [MVP roadmap](mvp-roadmap.md).

## Phase verification

- Give workers disjoint file ownership; one coordinator owns final builds and gates. Use focused checks during edits. After integration and review fixes, run `pnpm check`, then browser checks against that build; repeat only checks affected by later changes.
- After implementation, an Astra worker reviews correctness, complexity, and test validity/coverage. The coordinator filters findings, assigns accepted fixes to a different Astra worker, and reviews the result before reporting.
- Keep one browser journey per Ruleset. Demonstrate required UI interactions, then drive repeated moves (including Passes) through protocol clients. Use revisioned socket views; reserve HTTP reads for bootstrap and recovery checks.
- Browser helpers must establish their authentication/Room preconditions and await authoritative state changes. Assert required interactions occurred regardless of randomized seats or dealer. Diagnose stalled steps before increasing timeouts.
- On tooling failures such as Windows `spawn EPERM`, check execution permissions before retrying; do not change project tooling to mask an environment restriction.

## Server

Build before using either command:

```sh
pnpm build
pnpm --filter @dglz/server provision-account
pnpm --filter @dglz/server start
```

`provision-account` requires `DGLZ_PASSWORD`; `DGLZ_USERNAME`, `DGLZ_EMAIL`, and `DGLZ_DB_PATH` are optional. Clear the password variable afterwards.

Account administration (build first; all commands use `DGLZ_DB_PATH` and accept `DGLZ_USERNAME`, otherwise prompt):

| Command | Behavior |
| --- | --- |
| `pnpm --filter @dglz/server reset-password` | Set `DGLZ_PASSWORD` as the new password and revoke every session for that account. |
| `pnpm --filter @dglz/server revoke-sessions` | Revoke every session without changing the password; subsequent logins remain available. |
| `pnpm --filter @dglz/server account-audit` | Print the account's latest 100 audit records, newest first, as Chinese-labeled JSON lines. |

Supply passwords through a non-echoing shell prompt into `DGLZ_PASSWORD`, never command arguments or saved shell commands; clear the variable in the invoking shell afterwards. Administrative authority is VPS access, not an app role. Audit actors are the OS username for CLI actions and the Player Account ID for password changes/logout. Migration `0004_account_administration` preserves existing accounts/sessions and starts audit recording without inventing historical records. Provisioning, password changes/reset, account-wide revocation, and logout commit atomically with append-only audit records; secrets are excluded.

Revocation takes effect on subsequent authorization checks, including queued work and private-view delivery; idle sockets are not polled. Room membership, seats, and history remain intact. Resets/revocations also reject logins whose password verification began before the operation committed. Ordinary logout revokes only its session.

Players change passwords at `/account`. `POST /api/account/password` accepts `{ accountId, currentPassword, newPassword }`, bound to the authenticated account, with the existing origin policy and five attempts/minute/account across sessions. Success atomically records `change-password`, changes credentials, and revokes every session; the response clears the cookie. The browser confirms matching new-password fields. Success or an uncertain response clears that account's private state across same-browser tabs, even after navigation; uncertainty prompts login with the new password or, if unchanged, the old one. Current-password failures leave sessions intact. See [account administration](account-administration-plan.md).

`start` requires `DGLZ_ALLOWED_ORIGIN`. `DGLZ_DB_PATH`, `DGLZ_HOST`, and `DGLZ_PORT` are optional. Cookies are secure by default; set `DGLZ_SECURE_COOKIES=false` only for local HTTP development.

Run the server tests with `pnpm --filter @dglz/server test`; they use temporary SQLite databases and real Socket.IO clients.

Implemented seam: login, Room creation/joining/leaving, unlocked Seating Policy, interrupted-Room archival/replacement, Match/Challenge selection, seats/readiness, unlocked rules/presets, connected start, private play, Tribute/Return/tie choices, settlement, owner abort, and command/reconnect recovery. Only Matches advance to another Hand; Challenges return to the lobby after one result. Room executors retain projections after initial event replay. Protocol v8 requires older browsers to reload; unsupported stored acknowledgements are rejected under the [MVP compatibility policy](architecture.md#mvp-compatibility).

Lobby `LeaveRoom` removes membership, seat, and readiness; owner departure transfers ownership by join order, and last-member departure archives the Room. Its durable success receipt is `{ roomId, revision, left: true }`; other successes retain member views. `room:left` clears other connected tabs and removes their Room subscriptions. Uncertain departures retry the same command without requiring membership on reconnect. `ReplaceSeatingPolicy` is owner-only and permanently locked after the first Match/Challenge starts. Completed history, Replay, and Codes survive closure. See [Room-control phases](room-controls-plan.md).

`ArchiveRoom` and `ReplaceInterruptedRoom` are owner-only Interrupted-Room commands. Replacement creates an owner-only, unseated, unlocked lobby with fixed seating and the source Room's Match Rules Configuration; its durable acknowledgement names the new Room. Source history stays intact. Migration `0003_room_controls` adds versioned, seed-free control records, committed atomically with events, for safe terminal views after failed recovery. Compatible legacy Rooms gain records on access; already unreadable Rooms without valid records require administrator assistance. Archived Rooms stay read-only.

### Challenge integration

`POST /api/rooms/:roomId/challenges` accepts `{ handStartSequence }` from a completed Match/Challenge Hand participant and returns its stable Code/public preview. Displayed completed results include that reference only for participants. `POST /api/challenges/lookup` accepts `{ code }` from any authenticated account. Socket `SelectChallengeHand { code }` resolves the Template server-side; HTTP lookup and socket selection share 20 lookups/minute/account. `AbortChallengeHand` returns to the lobby without a result. Codes stay out of request URLs/logs; Templates/Seeds remain server-private. The Chinese UI generates/copies Codes from results, previews/selects Codes in the lobby, and shows Challenge completion. History and Replay use the same Codes and the existing Challenge selector. See [integration phases](challenge-integration-plan.md).

### Completed-Hand history

`GET /api/history` returns `{ hands }` for the authenticated account's recorded participation across Rooms. `GET /api/rooms/:roomId/hands/:handStartSequence` returns one participant-authorized summary. `POST /api/history/lookup { code }` opens the same summary for an authenticated Code holder and shares the existing Challenge lookup budget. Reads do not resume gameplay or create Codes; summaries include a Code only if already created through the participant endpoint. Completed Hands survive Match abortion and membership changes; unfinished/aborted Hands remain private.

`GET /api/rooms/:roomId/hands/:handStartSequence/replay` uses participant access; `POST /api/replays/lookup { code }` uses the same shared Code budget. Replay returns the summary, original deal, and server-derived card snapshots with Chinese action descriptions, stopping at settlement. No raw events, Seeds, or Templates are returned. The `/history` page lists completed Hands and offers local step controls, a progress slider, and automatic playback. Private references use `#hand=<Room>/<sequence>`; shared links use `#replay=<Code>` so Codes stay out of request URLs. Links survive login/reload. Sharing generates Codes lazily; the new-Room action carries `#challenge=<Code>` into the existing selection flow. See [phases](hand-history-plan.md).

## Web

`pnpm build` builds the Chinese browser UI; the server serves it and Room links from the same origin. For local HTTP, set `DGLZ_ALLOWED_ORIGIN=http://127.0.0.1:3000` and `DGLZ_SECURE_COOKIES=false`, then run the server command above. Open `http://127.0.0.1:3000`.

For UI development, use `DGLZ_ALLOWED_ORIGIN=http://127.0.0.1:5173` on the server and run `pnpm --filter @dglz/web dev` in another terminal. Vite proxies `/api` and `/socket.io` to port 3000. Use the same hostname as the configured origin.

Browser checks: run `pnpm --filter @dglz/web exec playwright install chromium` once, then `pnpm build` and `pnpm --filter @dglz/web test:browser`. Tests provision disposable accounts and SQLite databases and serve built assets through Fastify. Unit/server checks remain in `pnpm check`; browser checks run separately. Visual direction: [web-visual-direction](web-visual-direction.md).

Gameplay UI: keyboard/touch selection, advisory Chinese play feedback from `game-rules`, authoritative Play/Pass, unlocked rules/presets, contextual setup choices, revealed tie rounds, nonblocking previous-Hand results, and owner-only `终止比赛` throughout play/setup. Both Ruleset browser journeys continue through next-Hand play, abort/reload, and a new Match. Server tests cover both presets/ending policies, setup stages, abort races, retained configuration locks, private-state cleanup, atomic recovery, and retries across Matches.

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

`start` requires `DGLZ_ALLOWED_ORIGIN`. `DGLZ_DB_PATH`, `DGLZ_HOST`, and `DGLZ_PORT` are optional. Cookies are secure by default; set `DGLZ_SECURE_COOKIES=false` only for local HTTP development.

Run the server tests with `pnpm --filter @dglz/server test`; they use temporary SQLite databases and real Socket.IO clients.

Implemented seam: login, Room creation/joining, Match/Challenge selection, seats/readiness, unlocked rules/presets, connected start, private play, Tribute/Return/tie choices, settlement, owner abort, and command/reconnect recovery. Only Matches advance to another Hand; Challenges return to the lobby after one result. Room executors retain projections after initial event replay. Protocol v6 requires older browsers to reload; unsupported stored acknowledgements are rejected under the [MVP compatibility policy](architecture.md#mvp-compatibility).

### Challenge integration

`POST /api/rooms/:roomId/challenges` accepts `{ handStartSequence }` from a completed Match/Challenge Hand participant and returns its stable Code/public preview. Displayed completed results include that reference only for participants. `POST /api/challenges/lookup` accepts `{ code }` from any authenticated account. Socket `SelectChallengeHand { code }` resolves the Template server-side; HTTP lookup and socket selection share 20 lookups/minute/account. `AbortChallengeHand` returns to the lobby without a result. Codes stay out of request URLs/logs; Templates/Seeds remain server-private. The Chinese UI generates/copies Codes from results, previews/selects Codes in the lobby, and shows Challenge completion. History/Replay UI follows separately. See [integration phases](challenge-integration-plan.md).

## Web

`pnpm build` builds the Chinese browser UI; the server serves it and Room links from the same origin. For local HTTP, set `DGLZ_ALLOWED_ORIGIN=http://127.0.0.1:3000` and `DGLZ_SECURE_COOKIES=false`, then run the server command above. Open `http://127.0.0.1:3000`.

For UI development, use `DGLZ_ALLOWED_ORIGIN=http://127.0.0.1:5173` on the server and run `pnpm --filter @dglz/web dev` in another terminal. Vite proxies `/api` and `/socket.io` to port 3000. Use the same hostname as the configured origin.

Browser checks: run `pnpm --filter @dglz/web exec playwright install chromium` once, then `pnpm build` and `pnpm --filter @dglz/web test:browser`. Tests provision disposable accounts and SQLite databases and serve built assets through Fastify. Unit/server checks remain in `pnpm check`; browser checks run separately. Visual direction: [web-visual-direction](web-visual-direction.md).

Gameplay UI: keyboard/touch selection, advisory Chinese play feedback from `game-rules`, authoritative Play/Pass, unlocked rules/presets, contextual setup choices, revealed tie rounds, nonblocking previous-Hand results, and owner-only `终止比赛` throughout play/setup. Both Ruleset browser journeys continue through next-Hand play, abort/reload, and a new Match. Server tests cover both presets/ending policies, setup stages, abort races, retained configuration locks, private-state cleanup, atomic recovery, and retries across Matches.

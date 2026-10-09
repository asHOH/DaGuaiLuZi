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
| `pnpm --filter @dglz/web test:acceptance` | Run the same journeys across the [acceptance browser matrix](#release-verification). |

Prettier owns code/config formatting; Markdown is excluded to keep tables compact. Oxlint owns lint rules; TypeScript remains the typecheck authority. Lefthook checks staged formatting and lint before commit, then runs `pnpm check` before push. Run `pnpm exec lefthook install` if hooks are missing. GitHub Actions runs `pnpm check`, installs Chromium with its system dependencies, then runs browser checks against that build after a frozen-lockfile install.

Pin exact tool versions and upgrade them deliberately.

Remaining delivery order and completion gates: [MVP roadmap](mvp-roadmap.md).

## Phase verification

- Give workers disjoint file ownership; one coordinator owns final builds and gates. Use focused checks during edits. After integration and review fixes, run `pnpm check`, then browser checks against that build; repeat only checks affected by later changes.
- After implementation, an Astra worker reviews correctness, complexity, and test validity/coverage. The coordinator filters findings, assigns accepted fixes to a different Astra worker, and reviews the result before reporting.
- Keep one browser journey per Ruleset. Demonstrate required UI interactions, then drive repeated moves (including Passes) through protocol clients. Use revisioned socket views; reserve HTTP reads for bootstrap and recovery checks.
- Browser helpers must establish their authentication/Room preconditions and await authoritative state changes. Assert required interactions occurred regardless of randomized seats or dealer. Diagnose stalled steps before increasing timeouts.
- On tooling failures such as Windows `spawn EPERM`, check execution permissions before retrying; do not change project tooling to mask an environment restriction.

Test wall time is not research throughput: server/browser checks include authentication, network/UI work, and serial journeys; Python checks repeat Hands, replay, and isolated installation. For future test-only optimization, reuse seeded opaque sessions (as in `challenges.test.ts`) in non-authentication fixtures before considering more workers; retain real authentication coverage and production password settings. Use the [research performance pilot](research-encoding.md#local-performance-pilot-2026-10-09) for simulation measurements.

## Release verification

Current gates and platform gaps: [MVP roadmap](mvp-roadmap.md). Past results: [acceptance record](archive/mvp-acceptance-record.md). Release acceptance requires fresh automated checks and a recorded real-device multiplayer session; emulation alone does not establish physical-device acceptance.

Run `pnpm check`, then `pnpm --filter @dglz/web test:acceptance`. Install Chrome/Edge and run `pnpm --filter @dglz/web exec playwright install webkit` first. Select one profile with `--project=<profile>`:

| Profile | Browser / device |
| --- | --- |
| `desktop-chrome` | Installed Chrome |
| `desktop-edge` | Installed Edge |
| `android-chrome-emulated` | Installed Chrome, Pixel 7 emulation |
| `iphone-webkit-emulated` | Playwright WebKit, iPhone 13 emulation |

Reports: `apps/web/output/playwright/report`; per-test files: `apps/web/test-results`. Reuse existing journeys, with one gameplay journey per Ruleset. Verify:

- Rules/authority: both Rulesets and presets, legal play, settlement, audit, access control, persistence, and retries.
- Full flow: Match → completed Hand/history → independent Replay → Challenge; Room controls and account changes.
- Recovery/privacy: active-Hand server restart, offline/reconnect, unchanged private cards, stale account/revoked session cleanup, and interrupted-Room recovery.
- Browser/UI: keyboard/touch, responsive screenshots, and reduced-motion checks across the matrix.

Real-device session: arrange a reachable site and 4–6 players; record site/build, OS/browser versions, players, result, and issues. Staging may be needed before VPS release.

1. Log in, share a Room link, select seats/readiness, and play both Rulesets; check Chinese text, touch/keyboard selection, scrolling, rotation, text enlargement, and visible actions without obstruction.
2. Settle Hands and finish a Match; exercise Tribute/Return where applicable; open history/Replay independently, copy/paste its Code, and start a Challenge.
3. Background/restore a phone, briefly disconnect/reconnect it, and restart the server; verify resynchronization and retained private cards/history without duplicate actions.
4. Change a password and perform an administrator reset; old sessions cannot act or receive new private views. Verify another account's private state never appears.

## Headless reference

`@dglz/headless` exports `runFirstHand({ rulesConfiguration, handSeed, ... })` and `runChallengeHand({ template, roomRulesConfiguration?, ... })`. The latter accepts validated initial/subsequent-Hand Templates, including Tribute, Return, and tie choices; Room rules default to Template rules. Both return the result, Finish Positions, action count, and private engine events, retaining results through completion cleanup.

Shared options: `seatingPolicy?` (fixed), `actionLimit?` (1,500 setup/play decisions), `createPolicy?` (passive), and `record?` (false). `createPolicy(playerId)` creates separate decision functions receiving only that player's engine view and identity; Challenge policies use `effectiveRulesConfiguration`. Pending setup players act in logical seat order.

`createHandSession({ mode: "first-hand", ... })` or `{ mode: "challenge", ... }` accepts the corresponding runner options without `createPolicy`. Reset by creating a fresh session. `playerIds`, `currentPlayerId`, `actionCount`, `observe(playerId)`, and `step(action)` allow external decisions; steps bind the current actor and validate the payload. Invalid steps do not advance. `status` distinguishes `active`, `completed`, and `truncated`; completion takes precedence at the exact action limit. `getOutcome()` returns public completion facts; `getResult()` also includes private evaluator history. `currentPlayerId` becomes undefined only on completion; truncated research observations have no legal choices. Observations remain frozen engine views. Keep the session outside policies and pass only each player's observation; the session can observe every seat.

`observeResearch(playerId)` adds versioned identity, public history, and complete scheduled-player choices with numeric candidate features; `legalActions(view, playerId)` is the pure generator. See the [encoding contract and Python compatibility probe](research-encoding.md). Enumeration is deliberately slow; ordinary `observe` and passive runners do not invoke it.

`record: true` adds a JSON-safe `record`; `replayHand(parsedRecord)` re-executes recorded setup/actions through the engine without policies and checks events, SHA-256 fingerprints of acting-player views, and results. Records include resolved rules, seats, private seeds/Templates, and format/source/randomness/shuffle versions. Keep records/events outside policies; these are private research artifacts, separate from browser Replay. `sourceVersion` is a manually maintained compatibility version: bump it when engine/rules/view semantics change. Unsupported versions and inconsistent records fail; no migration or authenticity guarantee is provided. JSON Templates use `null` for absent Finish Positions; `decodeChallengeTemplate` restores and validates the domain form.

After building, run from the repository root:

```sh
node packages/headless/dist/cli.js run 4 example-seed hand.json
node packages/headless/dist/cli.js run 6 example-seed six.json 自主 randomized
node packages/headless/dist/cli.js challenge template.json challenge.json
node packages/headless/dist/cli.js replay hand.json
```

The CLI uses the passive policy and prints outcome, winning team (index 0/1), Finish Positions, action count, and event count. `run` accepts optional preset (`省心` default) and seating (`fixed` default); `challenge` accepts optional seating. Output files must be new; failures exit nonzero. `pnpm --filter @dglz/headless cli ...` is equivalent, with paths relative to `packages/headless`.

`pnpm --filter @dglz/headless... build` builds its dependencies; `pnpm --filter @dglz/headless test` runs focused checks. Workspace checks include it. Browser tests and the playground reuse its passive policy through their existing helper; production app code does not import it.

## Python research adapter

Checkout workflow (Python 3.12.12; Node.js from `.node-version`):

```sh
pnpm --filter @dglz/headless... build
uv run --python 3.12.12 --with-requirements packages/headless/python/requirements.txt python packages/headless/python/test_adapter.py
```

Add `packages/headless/python` to the Python import path; import `DaguailuziEnv` from `dglz_env`. Construct with `players=4|6`, optional `preset`, `rules_configuration` or `template`, `seating_policy`, `action_limit`, and `record`. A Template owns its deal; `reset(seed=...)` seeds fresh deals otherwise and action-space sampling in either mode. Reset options are reserved and ignored. Repeated resets reuse one Node process; `close()` or the context manager releases it.

Use the AEC loop with `observe()` arrays and its action mask; `observe_raw(agent)` returns an isolated structured observation. Action IDs belong only to the current candidate list. Finished players stay until the Hand ends, then each receives its terminal team reward and requires `step(None)`. Truncation delivers zero reward with no Hand result. Replace `reward_fn(outcome, team_index)` to change scoring; the default follows the [research plan](python-research-environment-plan.md#team-evaluation-and-reward).

`export_record()` and `replay_record(record)` are evaluator-only. Never pass records, Templates, seeds, or the environment itself to a policy. `BridgeError.code` distinguishes request, protocol, and engine failures; engine failures require reset. `engine_timeout` bounds engine responses, not bot decision time. The bridge validates versioned JSON-line requests and rejects stale episode/turn IDs. No bot fallback runs inside the adapter.

CI runs upstream AEC/seed checks, native transcript/privacy/replay comparisons, duplicate evaluation, trajectory updates, and isolated wheel installation for both Rulesets. Python dependencies are pinned in `packages/headless/python/requirements.txt`; the optional CPU learner uses PyTorch 2.14.1. The standard TorchRL wrapper is unsupported.

### Research package and examples

Researcher instructions: [Chinese quickstart](../packages/headless/python/README.md). Build the wheel after the native packages:

```sh
uv run --python 3.12.12 python packages/headless/python/prepare_package.py
uv build --wheel packages/headless/python --out-dir dist/python
```

The wheel includes compiled workspace engine packages, Zod and its license, and four/six-player subsequent-Hand Templates. Consumers need Python 3.12 and Node.js 24; no checkout or TypeScript build. Build preparation refreshes the copied engine; source execution uses the current workspace build. Registry publication remains separate.

Focused checks:

```sh
uv run --python 3.12.12 --with-requirements packages/headless/python/requirements.txt --with torch==2.14.1 python packages/headless/python/test_examples.py
uv run --python 3.12.12 --with-requirements packages/headless/python/requirements.txt python packages/headless/python/test_evaluate.py
```

For package acceptance, install the wheel into a fresh virtual environment and run its Python with `-I packages/headless/python/test_package.py`. The check imports only installed modules, changes to a temporary directory, and runs both Rulesets including supplied setup Templates. Do not use an editable install as this gate.

`dglz_examples` collects legal-random trajectories; `--learn` performs one CPU regression update against actual terminal team rewards. Truncations never train. `dglz_evaluate.evaluate` accepts two per-seat policy factories, fixes Template seating, resets policy memory between legs, and reports paired team scores separately by Ruleset. Factories receive policy seeds; policies receive only their seat's raw snapshot. Reports retain private configuration and reproduction metadata outside policies. Default failures stop the leg; optional fallback and spawned-process timeouts follow the [research failure policy](python-research-environment-plan.md#failure-handling). Timings include engine work and serialization, not isolated transport overhead.

## Server

Build before using either command:

```sh
pnpm build
pnpm --filter @dglz/server provision-account
pnpm --filter @dglz/server start
```

`provision-account` requires `DGLZ_PASSWORD`; `DGLZ_USERNAME`, `DGLZ_EMAIL`, and `DGLZ_DB_PATH` are optional. Clear the password variable afterwards.

Players may register through the login screen. `POST /api/register { username, password, confirmPassword }` returns the login account shape and sets a session cookie; account, audit, and session commit together. Passwords may be empty across all account flows (the field must still be present); registration collects no email. CLI `DGLZ_PASSWORD` may be explicitly empty but must be defined. Registration is limited to 30 attempts/hour/app; login to 60 attempts/minute/app and five/minute/normalized username. In-memory budgets reset on restart and can temporarily block friends during abuse. Registration/login bodies are capped at 16 KiB. No forwarded IP headers are trusted for these budgets.

Account administration (build first; all commands use `DGLZ_DB_PATH` and accept `DGLZ_USERNAME`, otherwise prompt):

| Command | Behavior |
| --- | --- |
| `pnpm --filter @dglz/server reset-password` | Set `DGLZ_PASSWORD` as the new password and revoke every session for that account. |
| `pnpm --filter @dglz/server revoke-sessions` | Revoke every session without changing the password; subsequent logins remain available. |
| `pnpm --filter @dglz/server account-audit` | Print the account's latest 100 audit records, newest first, as Chinese-labeled JSON lines. |

Supply passwords through a non-echoing shell prompt into `DGLZ_PASSWORD`, never command arguments or saved shell commands; clear the variable in the invoking shell afterwards. Administrative authority is VPS access, not an app role. Audit actors are the OS username for CLI actions and the Player Account ID for registration/password changes/logout. Migration `0004_account_administration` preserves existing accounts/sessions and starts audit recording without inventing historical records. Registration, provisioning, password changes/reset, account-wide revocation, and logout commit atomically with append-only audit records; secrets are excluded.

Revocation takes effect on subsequent authorization checks, including queued work and private-view delivery; idle sockets are not polled. Room membership, seats, and history remain intact. Resets/revocations also reject logins whose password verification began before the operation committed. Ordinary logout revokes only its session.

Players change passwords at `/account`. `POST /api/account/password` accepts `{ accountId, currentPassword, newPassword }`, bound to the authenticated account, with the existing origin policy and five attempts/minute/account across sessions. Success atomically records `change-password`, changes credentials, and revokes every session; the response clears the cookie. The browser confirms matching new-password fields. Success or an uncertain response clears that account's private state across same-browser tabs, even after navigation; uncertainty prompts login with the new password or, if unchanged, the old one. Current-password failures leave sessions intact. See [account administration](archive/account-administration-plan.md).

`start` requires `DGLZ_ALLOWED_ORIGIN`. `DGLZ_DB_PATH`, `DGLZ_HOST`, and `DGLZ_PORT` are optional. Cookies are secure by default; set `DGLZ_SECURE_COOKIES=false` only for local HTTP development.

Run the server tests with `pnpm --filter @dglz/server test`; they use temporary SQLite databases and real Socket.IO clients.

Implemented seam: login, Room creation/joining/leaving, unlocked Seating Policy, interrupted-Room archival/replacement, Match/Challenge selection, seats/readiness, unlocked rules/presets, connected start, private play, Tribute/Return/tie choices, settlement, owner abort, and command/reconnect recovery. Only Matches advance to another Hand; Challenges return to the lobby after one result. Room executors retain projections after initial event replay. Browsers must match [`PROTOCOL_VERSION`](../packages/protocol/src/index.ts) or reload; unsupported stored acknowledgements are rejected under the [MVP compatibility policy](architecture.md#mvp-compatibility).

Lobby `LeaveRoom` removes membership, seat, and readiness; owner departure transfers ownership by join order, and last-member departure archives the Room. Its durable success receipt is `{ roomId, revision, left: true }`; other successes retain member views. `room:left` clears other connected tabs and removes their Room subscriptions. Uncertain departures retry the same command without requiring membership on reconnect. `ReplaceSeatingPolicy` is owner-only and permanently locked after the first Match/Challenge starts. Completed history, Replay, and Codes survive closure. See [Room-control phases](archive/room-controls-plan.md).

`ArchiveRoom` and `ReplaceInterruptedRoom` are owner-only Interrupted-Room commands. Replacement creates an owner-only, unseated, unlocked lobby with fixed seating and the source Room's Match Rules Configuration; its durable acknowledgement names the new Room. Source history stays intact. Migration `0003_room_controls` adds versioned, seed-free control records, committed atomically with events, for safe terminal views after failed recovery. Compatible legacy Rooms gain records on access; already unreadable Rooms without valid records require administrator assistance. Archived Rooms stay read-only.

### Challenge integration

`POST /api/rooms/:roomId/challenges` accepts `{ handStartSequence }` from a completed Match/Challenge Hand participant and returns its stable Code/public preview. Displayed completed results include that reference only for participants. `POST /api/challenges/lookup` accepts `{ code }` from any authenticated account. Socket `SelectChallengeHand { code }` resolves the Template server-side; HTTP lookup and socket selection share 20 lookups/minute/account. `AbortChallengeHand` returns to the lobby without a result. Codes stay out of request URLs/logs; Templates/Seeds remain server-private. The Chinese UI generates/copies Codes from results, previews/selects Codes in the lobby, and shows Challenge completion. History and Replay use the same Codes and the existing Challenge selector. See [integration phases](archive/challenge-integration-plan.md).

### Completed-Hand history

`GET /api/history` returns `{ hands }` for the authenticated account's recorded participation across Rooms. `GET /api/rooms/:roomId/hands/:handStartSequence` returns one participant-authorized summary. `POST /api/history/lookup { code }` opens the same summary for an authenticated Code holder and shares the existing Challenge lookup budget. Reads do not resume gameplay or create Codes; summaries include a Code only if already created through the participant endpoint. Completed Hands survive Match abortion and membership changes; unfinished/aborted Hands remain private.

`GET /api/rooms/:roomId/hands/:handStartSequence/replay` uses participant access; `POST /api/replays/lookup { code }` uses the same shared Code budget. Replay returns the summary, original deal, and server-derived card snapshots with Chinese action descriptions, stopping at settlement. The first frame precedes Tribute; each later step groups a choice/play with its resulting events, and ballots appear only at resolution. Playback positions are local to each viewer. No raw events, Seeds, or Templates are returned. The `/history` page lists completed Hands and offers local step controls, a progress slider, and automatic playback. Replay shares the live table presentation, with seat switching and expandable all-hands inspection; frames include the recorded Dealer Team and the latest play at each seat until lead reset. Private references use `#hand=<Room>/<sequence>`; shared links use `#replay=<Code>` so Codes stay out of request URLs. Links survive login/reload. Sharing generates Codes lazily; the new-Room action carries `#challenge=<Code>` into the existing selection flow. See [phases](archive/hand-history-plan.md).

## Web

Local previews and gameplay: run `pnpm play`. It builds the app and opens the Chinese preview gallery. Choose a page, named scenario, four/six players, viewport, and table connection state. The isolated pane uses real app components/styles with fixed, schema-validated samples; selection and Replay controls work, while submitted commands leave the scenario unchanged. Reset clears local interactions; viewport changes preserve them. Gallery URLs retain selections on reload. Preview source edits update through local Vite.

`打开试玩牌桌` opens the real signed-in four-player table in a separate window; repeated opens focus the existing table. Its toolbar pauses automation, executes one opponent action, restarts with four/six players, or returns to the gallery. Opponents pass responses, lead singles, and resolve setup choices; your seat stays manual. Restart deals a fresh Hand and pauses automation. Closing a table cleans its temporary database; closing the gallery also closes its table and local preview server. Gameplay uses built assets, so rerun after gameplay source edits. Install Chromium once with `pnpm --filter @dglz/web exec playwright install chromium` if needed. Preview entries, sample responses, controls, and bots stay in `apps/web/dev` and do not ship in the production bundle.

Add named visual states in `dev/preview-scenarios.ts`; samples pass the production protocol schemas. `dev/preview.tsx` composes existing screen components, and `dev/preview-api.ts` supplies document-local history/Replay/Challenge responses. Keep fixtures for presentation, not game-rule simulation. Focused verification: `pnpm --filter @dglz/web exec playwright test e2e/gallery.spec.ts`; full game journeys remain the integration authority.

`pnpm build` builds the Chinese browser UI; the server serves it and Room links from the same origin. For local HTTP, set `DGLZ_ALLOWED_ORIGIN=http://127.0.0.1:3000` and `DGLZ_SECURE_COOKIES=false`, then run the server command above. Open `http://127.0.0.1:3000`.

For UI development, use `DGLZ_ALLOWED_ORIGIN=http://127.0.0.1:5173` on the server and run `pnpm --filter @dglz/web dev` in another terminal. Vite proxies `/api` and `/socket.io` to port 3000. Use the same hostname as the configured origin.

Browser checks: run `pnpm --filter @dglz/web exec playwright install chromium` once, then `pnpm build` and `pnpm --filter @dglz/web test:browser`. Tests provision disposable accounts and SQLite databases and serve built assets through Fastify. Unit/server checks remain in `pnpm check`; browser checks run separately. Visual direction: [web-visual-direction](web-visual-direction.md).

Gameplay UI: keyboard/touch selection, advisory Chinese play feedback from `game-rules`, authoritative Play/Pass, unlocked rules/presets, contextual setup choices, revealed tie rounds, nonblocking previous-Hand results, and owner-only `终止比赛` throughout play/setup. Both Ruleset browser journeys continue through next-Hand play, abort/reload, and a new Match. Server tests cover both presets/ending policies, setup stages, abort races, retained configuration locks, private-state cleanup, atomic recovery, and retries across Matches.

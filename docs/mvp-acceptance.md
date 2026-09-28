# MVP Acceptance

Status: automated acceptance passed, 2026-09-27. Real-device multiplayer remains pending by user decision: no shared test site/session yet.

Target: iPhone Safari, Android Chrome, Windows and macOS browsers. Existing desktop automation covers Chrome/Edge; macOS browser coverage is undecided. The owner has Windows and iPhone for hands-on testing; macOS/Android device testing remains to be arranged. Reuse the five browser journeys; keep one gameplay journey per Ruleset.

| Gate | Evidence / remaining work |
| --- | --- |
| Rules and authority | `pnpm check`: both Rulesets/presets, legal play, settlement, audit, access control, persistence, and retries. |
| Full player flow | Existing journeys: Match → completed Hand/history → independent Replay → Challenge; Room controls and account changes. |
| Recovery/privacy | Active-Hand server restart, offline/reconnect, unchanged private cards, stale account/revoked session cleanup, and interrupted-Room recovery. |
| Browser/UI | Chrome/Edge plus Android Chrome and iPhone WebKit emulation; keyboard/touch, responsive screenshots, and reduced-motion checks. Emulation does not establish physical-device acceptance. |
| Real-device multiplayer | Pending by user decision. Run the checklist below on a reachable test site with 4–6 players. |

Run `pnpm check`, then `pnpm --filter @dglz/web test:acceptance`. The latter requires installed Chrome/Edge and `pnpm --filter @dglz/web exec playwright install webkit`. Select a profile with `--project=desktop-chrome`, `desktop-edge`, `android-chrome-emulated`, or `iphone-webkit-emulated`. Screenshots are attached to the Playwright report under `apps/web/output/playwright/report`; per-test files are under `apps/web/test-results`.

| Browser profile | Result |
| --- | --- |
| Desktop Chrome 153 | 5/5 passed |
| Desktop Edge 154 | 5/5 passed |
| Android Chrome 153, Pixel 7 emulation | 5/5 passed |
| iPhone 13 emulation, Playwright WebKit 26.6 | 5/5 passed |

Twenty distinct cases passed across runs. After the test-fixture fixes, both gameplay journeys passed again in Chrome and WebKit. The final WebKit rerun used `--grep '四人|六人' --trace=off` to avoid tracing overhead, with assertions/screenshots unchanged; it took 8.9 minutes. The latest HTML report contains those two cases, not the entire matrix. WebKit clipboard checks verify UI success; Chromium also reads back the copied value. Physical Safari and Android remain unverified.

Verification: `pnpm check` passed 293 tests with temporary `VITEST_MAX_WORKERS=2`. An existing CLI test exceeded 20 seconds under default parallel load; it passed alone in 7.8 seconds without changes. Acceptance allows five minutes per journey, ten for Windows WebKit, whose six-player trace took over six minutes to reach final Replay checks. Assertion timeouts remain unchanged.

Acceptance exposed a graceful-restart bug: a failed HTTP session probe prevented socket reconnection. Reusing the authenticated Socket.IO handshake fixes recovery and preserves authorization. Both new unit regressions failed before the fix; Astra reviewed the fix with no actionable findings. Browser helpers now await readiness acknowledgements before issuing dependent commands. Stale-response checks change input while fetching the intercepted response, then require successful delivery; sequential test waits had exceeded the production request deadline on WebKit. Astra reviewed this finding, a different Astra worker fixed it, and the coordinator reviewed both fixes.

Real-device checklist (record site/build, OS/browser versions, players, result, and issues):

1. Log in, share a Room link, select seats/readiness, and play both Rulesets; check Chinese text, touch/keyboard selection, scrolling, rotation, text enlargement, and visible actions without obstruction.
2. Settle Hands and finish a Match; exercise Tribute/Return where applicable; open history/Replay independently, copy/paste its Code, and start a Challenge.
3. Background/restore a phone, briefly disconnect/reconnect it, and restart the server; verify resynchronization and retained private cards/history without duplicate actions.
4. Change a password and perform an administrator reset; old sessions cannot act or receive new private views. Verify another account's private state never appears.

Completion requires both automated gates and the recorded real-device session. Then proceed to the [VPS release](mvp-roadmap.md); staging may be needed to host that session.

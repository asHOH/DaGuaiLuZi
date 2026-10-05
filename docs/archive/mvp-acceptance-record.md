# MVP Acceptance Record

Status: Historical automated verification evidence through 2026-10-06; not current release readiness. Active gates live in the [MVP roadmap](../mvp-roadmap.md); reusable checks live in [Development](../development.md#release-verification).

## Follow-up verification

2026-10-06 rule-label and test-fixture follow-up: Chinese rule labels now require complete type coverage; identical baseline configurations are shared across ten test files within their packages. Independent expected-value checks and differing scenarios remain intact. Removing either a variant label or a setting label was confirmed to fail typechecking. Astra review found no actionable issues; final `pnpm check` (354 tests) and all 12 Chromium cases passed. No new physical-device or cross-browser acceptance claimed.

2026-10-05 local hand grouping: `pnpm check` passed 345 tests; post-review web build, formatting, lint, and typechecks passed. All 12 Chromium browser cases passed across runs (10 initially; both Ruleset journeys rerun after correcting an owner-only test assertion). Coverage includes regrouping/dissolution, whole-hand prevention, singleton groups, played-card pruning, new-Hand/reload reset, reconnect retention, Replay exclusion, and desktop/320px layout geometry. Astra review found excess trailing group spacing; a different Astra worker fixed it, and the coordinator validated the fix/screenshots. No new physical-device or cross-browser acceptance claimed.

## 2026-09-27 automated acceptance

Automated acceptance passed. Real-device multiplayer remained pending by user decision: no shared test site/session yet.

| Browser profile | Result |
| --- | --- |
| Desktop Chrome 153 | 5/5 passed |
| Desktop Edge 154 | 5/5 passed |
| Android Chrome 153, Pixel 7 emulation | 5/5 passed |
| iPhone 13 emulation, Playwright WebKit 26.6 | 5/5 passed |

Twenty distinct cases passed across runs. After the test-fixture fixes, both gameplay journeys passed again in Chrome and WebKit. The final WebKit rerun used `--grep '四人|六人' --trace=off` to avoid tracing overhead, with assertions/screenshots unchanged; it took 8.9 minutes. The latest HTML report contains those two cases, not the entire matrix. WebKit clipboard checks verify UI success; Chromium also reads back the copied value. Physical Safari and Android remain unverified.

Verification: `pnpm check` passed 293 tests with temporary `VITEST_MAX_WORKERS=2`. An existing CLI test exceeded 20 seconds under default parallel load; it passed alone in 7.8 seconds without changes. Acceptance allows five minutes per journey, ten for Windows WebKit, whose six-player trace took over six minutes to reach final Replay checks. Assertion timeouts remain unchanged.

Acceptance exposed a graceful-restart bug: a failed HTTP session probe prevented socket reconnection. Reusing the authenticated Socket.IO handshake fixes recovery and preserves authorization. Both new unit regressions failed before the fix; Astra reviewed the fix with no actionable findings. Browser helpers now await readiness acknowledgements before issuing dependent commands. Stale-response checks change input while fetching the intercepted response, then require successful delivery; sequential test waits had exceeded the production request deadline on WebKit. Astra reviewed this finding, a different Astra worker fixed it, and the coordinator reviewed both fixes.

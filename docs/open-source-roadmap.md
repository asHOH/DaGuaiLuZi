# Open-source Research Roadmap

Status: Step 1 complete (2026-10-06); steps 2–4 planned, outside MVP scope and may take priority over MVP completion.

## Goal and scope

Make DaGuaiLuZi a reproducible environment for research-scale training. Stronger playable bots are secondary; supporting a second game is not a goal. Reducing ongoing maintenance is an independent reason to adopt a dependency.

Keep gameplay and UI iteration working throughout. MVP completion is not a prerequisite; its release gates remain in the [MVP roadmap](mvp-roadmap.md). [ADR 0002](decisions/0002-research-and-maintenance-candidates.md) records candidates, not scheduled integrations or selected dependencies.

## Delivery order

| Step | Outcome | Completion gate |
| --- | --- | --- |
| 1. Shared rule definitions | One source for allowed Rule Variant values and derived types/validation across rules, core, and protocol. Keep distinct domain and serialized shapes separate. | A setting changes in one place; both [Rulesets](ruleset.md) retain behavior and reject invalid configurations. |
| 2. Headless reference | Reuse the real engine and test/playground helpers; separate setup, policy decisions, and evaluation. | Both Rulesets complete a Hand, including setup choices, without browser, accounts, HTTP, or SQLite. Policies receive permitted observations; recorded setup/actions reproduce the result. |
| 3. Research baseline | Choose one training workload, target hardware, observation/action encoding, and reward/episode definition; expose one research interface and one baseline. | Reproducible training and evaluation cover legal actions, hidden information, team roles, and setup decisions. Record rule/engine/encoding versions, seeds, configuration, and hardware. |
| 4. Measured scale | Profile the baseline; compare one acceleration candidate with the reference before selecting a backend. | Measure legal-action generation, complete Hands/second, memory, and training wall time. Any port matches reference transitions, observations, and outcomes across supported configurations. |

Step 1: `game-rules` owns allowed values; domain types, core validation, and protocol enums consume them. Existing validation boundaries and serialized shapes are preserved. [Verification record](archive/mvp-acceptance-record.md): 354 unit/server tests and 12 Chromium browser cases passed; Astra review found no actionable issues.

Extract storage-independent Replay or presentation boundaries only when a research consumer or recurring maintenance cost requires them; reuse existing components first. No universal engine, second-game abstraction, or package publishing before independent use is demonstrated.

## Change and migration gates

- Run one integration experiment at a time, with bounded file ownership and a removable adapter; avoid broad refactors during UI work. Keep research dependencies and training execution outside the production app.
- HTTP or hosting work may precede any research step when a representative pilot demonstrates lower maintenance cost. Count code and change points removed against adapters, migrations, operations, upgrades, and regression risk; a second game is not required.
- Choose one candidate per pilot, retain the current implementation as the baseline, and remove unsuccessful experiments or superseded paths. First HTTP option: schema integration on one flow; expand to shared contracts only if it removes additional maintenance.
- Follow [verification](development.md#phase-verification); adopt only after affected behavior checks pass. Recheck candidate compatibility and licensing at selection time.
- Preserve authoritative validation, private views, queued-work session revocation checks, per-Room serialization, and atomic event/deduplication commits before acknowledgement. Keep live and completed-Hand disclosure distinct.
- Follow [architecture](architecture.md), [ADR 0001](decisions/0001-initial-application-stack.md), and the current [app compatibility policy](architecture.md#mvp-compatibility). Record any selected stack change in a new ADR; research scale does not itself change live deployment requirements.

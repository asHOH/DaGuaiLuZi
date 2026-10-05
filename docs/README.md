# Documentation map

Start with the task below; read the linked references only as needed. Roadmaps own priorities and status. This page is a reading guide, not another plan.

## Ongoing work

| Task | Read first | Then, as needed |
| --- | --- | --- |
| Reuse the engine / research | [Research roadmap](open-source-roadmap.md) | [Engine boundaries](architecture.md#deep-modules-and-seams); [verification workflow](development.md#phase-verification) |
| Continue the app / UI | [MVP roadmap](mvp-roadmap.md) | [Product requirements](product-spec.md); [visual and interaction direction](web-visual-direction.md) |
| Run, debug, or test locally | [Development](development.md) | [Architecture](architecture.md) for implementation boundaries and policies |
| Check readiness to release | [MVP acceptance](mvp-acceptance.md) | [Remaining release work](mvp-roadmap.md) |

## Behavior references

| Changing or checking | Source of truth |
| --- | --- |
| Domain terminology | [Glossary](../CONTEXT.md) |
| Play, comparison, Tribute, scoring, or Rule Variants | [Rulesets](ruleset.md) |
| Initial Room rule selections | [Rules Configuration Presets](rules-configuration-presets.md) |
| Tied Tribute-giver choices | [Tie-Choice Protocol](tie-choice-protocol.md) |
| Hand Seeds, Challenge Templates/Codes, Replay, or Challenge Hands | [Challenge Hand Sharing](challenge-hand-sharing.md) |

## Background and deferred work

- [ADR 0001](decisions/0001-initial-application-stack.md): why the current stack was selected; consult when proposing a stack change.
- [ADR 0002](decisions/0002-research-and-maintenance-candidates.md): candidate assessment, not selected dependencies or scheduled integrations.
- [Turn timing](post-mvp-turn-timing.md): deferred policy questions; not an implementation task until scheduled.
- [Archive](archive/): completed implementation records. Read for historical context, not current requirements or queued work.

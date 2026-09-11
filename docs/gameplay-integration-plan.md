# Gameplay integration

Status: Phases 1–3 implemented and verified, 2026-09-11. Each phase delivers a working browser/server slice.

Historical record of transport, persistence, orchestration, and UI integration using the implemented `game-core`.

## Boundary and decisions

- Flow: Chinese browser controls → validated protocol → authenticated Room executor → core decisions → atomic events/deduplication → account-specific full views. Follow the [synchronization/retry contract](architecture.md#client-resynchronization) and server-only core.
- Extend `packages/protocol/src/index.ts`, server `rooms.ts`/`room-executor.ts`, and web `RoomTable.tsx`/styles; change socket plumbing only where required. No new package, dependency (except web → existing `@dglz/game-rules`), storage abstraction, or expected database migration.
- This slice validated newly reachable persisted events and preserved earlier streams/acknowledgements.
- Model play, setup, settlement, and lobby views accurately: `currentActor` is absent outside a live turn. Include unbeaten play, Finish Positions, Hand result, and retained Match summary where applicable; do not infer lifecycle from a socket or card count.
- Phase 1 temporarily stopped at settlement; Phase 2 added next-Hand continuation and retained settlement summaries.
- Recover a compatible settled Room left by phase 1 through the same serialized executor on access, completing the pending internal start once. Recheck state in the queue; reconnect never starts a second Hand or makes a player choice. Failed commits install no candidate state.

## 1. One complete Hand

- Add `Play` and `Pass` payloads and authenticated mapping. Validate canonical Card Instances and bounded card arrays; core checks ownership, turn, form, and comparison.
- Decode/persist all play, pass, finish, lead-reset, result, settlement, and natural Match-completion events. The finishing play's entire event batch and acknowledgement commit together.
- Extend server projections and protocol views for unbeaten play, optional actor, settled Hand, and completed-Match lobby facts. Natural completion must already serialize correctly, even though lifecycle journeys are finalized in phase 3.
- Add keyboard/touch card selection, `出牌`/`不出`, current play, hand sizes, Finish Positions, and result. Reuse `game-rules.evaluatePlay` for immediate Chinese selection feedback, including finishing-wildcard interpretation; client verdicts are advisory and the server remains authoritative. Server rejection messages are Chinese; selection is local and never removes cards optimistically. Clear stale selection on authoritative Hand/account changes; disable submission while pending or unsynchronized. Use a real Hand number rather than unconditionally displaying `completedHandCount + 1` after settlement.
- Gate: both Rulesets reach settlement through real socket commands. Cover illegal/out-of-turn/card-ownership rejection, ordinary and Automatic Response Closure without synthetic Passes, atomic settlement, duplicate/lost acknowledgements, and restart/reconnect with private-card isolation. Extend the existing browser journeys through card selection, play/pass, and settlement.

## 2. Continue the Match

- Before setup UI, expose `省心`/`自主` presets and individual supported settings in the unlocked lobby. Reuse complete `ReplaceMatchRulesConfiguration`; keep preset mapping outside core, default new Rooms to `省心`, and preserve existing Room settings and permanent locks.
- Implement the [next-Hand and retained-summary policies](architecture.md#match-continuation). Add persisted decoding for `HandStarted` and every automatic/manual setup event; never serialize seeds to clients.
- Wire `SelectTributeCard`, `OfferReturnCandidates`, `SelectReturnCard`, and `SubmitTieChoiceBallot`. Extend full views with pending actors, eligible choices, candidate offers, own ballot, submitted-voter IDs, and revealed rounds.
- Render one contextual setup decision at a time in rule order. Show `已提交，等待其他玩家` after a final choice; reveal other ballots only after resolution. Reuse card selection and command delivery.
- Gate: both Rulesets continue from settlement through setup to the next legal play under both presets. Cover four-player non-joker Tribute, received-card return, candidate-rank constraints, pairing/leader ties and third-round fallback, no-Tribute flow, hidden ballots, concurrent choices, and restart/retry without duplicate deals or transfers. Reload preserves the previous result and current setup.

## 3. Match lifecycle

- Wire owner-only `AbortMatch`, its persisted event, and Chinese `终止比赛` control during play and every setup stage. Expose the core's aborted summary without revealing incomplete private Hand facts.
- Finish natural-completion and abort presentation in the lobby: retained final Team Levels/completed-Hand count, winner only on natural completion, cleared selection/readiness, and a new Match through the existing select/ready/connected-start path. Permanent configuration and Seating Policy locks survive.
- Gate: both Match-ending settings, owner/non-owner abort, abort racing a final play or setup choice, reconnect in the resulting lobby, and a second Match. Assert completed events remain retained and retries cannot revive or repeat an ended Match.

## Checks and scope

Each phase runs `pnpm check` plus `pnpm --filter @dglz/web test:browser`. Keep at most one browser happy path per Ruleset, extending it as phases land; use real temporary SQLite and protocol clients for branch/race coverage. Verify mobile/desktop controls and keyboard access. Test integration contracts without duplicating core's exhaustive rule tests; add a core check only if a core contract changes.

Follow the [phase verification workflow](development.md#phase-verification) for worker ownership, Astra review/fixes, browser drivers, and final gates.

This slice excluded Challenge Hands, history/Replay/sharing endpoints, remaining Room-management controls, account administration, deployment, and turn timing. Retaining a settlement summary does not implement Hand history or Replay.

# `game-core` Establishment Plan

## Module seam

Stabilize these operation shapes in Phase 1:

```ts
decide(state, command): Decision
evolve(state | undefined, event): State
derivePlayerView(state, playerId): PlayerView
deriveStartRequirements(state): StartRequirements
```

State is opaque. Command, event, rejection, and view unions may gain variants through later phases. Tests use this seam, not internal handlers.

`game-core` presents one interface. Lobby, setup, Hand, settlement, Tribute, tie-choice, Challenge Hand, view, and deterministic-randomness code may be internal modules; they do not create additional external seams.

`game-core` depends only on `game-rules`. It does not know about sockets, SQL, authentication, revisions, presence, presets, Challenge Code lookup, clocks, or UI.

Initial Room creation remains outside the Room executor. The creation path persists `RoomCreated`; `evolve(undefined, RoomCreated)` bootstraps state. There is no ordinary `CreateRoom` decision command.

## Auto-start contract

The Room executor:

1. derives durable start requirements;
2. checks authenticated presence externally;
3. obtains a fresh cryptographic Hand Seed;
4. submits an internal start command with the seed and algorithm versions;
5. lets `game-core` revalidate durable requirements.

Presence never enters `game-core`. Private Hand-start events contain the Hand Seed and reproducibility versions; player views, protocol messages, logs, and completed-history output do not expose the Hand Seed.

## Phases

### 1. Bootstrap and Match lobby

- Scaffold `@dglz/game-core`.
- Define immutable state, command, event, rejection, lifecycle, identity, and view values.
- Bootstrap from `RoomCreated`.
- Implement membership, owner transfer, seats, readiness, Match Rules Configuration, Seating Policy, and Match selection.
- Enforce Ruleset cardinality and Ruleset-change behavior.
- Defer Challenge selection.
- Gate: event replay reconstructs identical state; complete 4p2d and 6p3d Match-lobby flows pass.

### 2. Deterministic Match start

- Implement the auto-start contract.
- Build decks from Ruleset metadata.
- Add versioned, domain-separated seeded seating, dealer selection, shuffle, and selections required by resolved Rule Variants.
- Resolve seating, initial dealer, Dealer Team, Team Levels, Trump Rank, and deal.
- Reject membership, seat, Rules Configuration, and Seating Policy changes while the Room is active.
- Permanently lock Match Rules Configuration and Seating Policy when the first Match starts.
- Record all reproducibility inputs in private Hand-start events.
- Hide opponents' cards in player views.
- Gate: identical inputs reproduce identical events and deals; lifecycle locks, card conservation, and seating-permutation invariants pass.

### 3. Active Hand play

- Implement Play and Pass commands, turn ownership, card ownership, response circuits, lead resets, finished-player skipping, and Finish Positions.
- Delegate combination legality and Automatic Response Closure to `game-rules`.
- Emit no synthetic Passes for Automatic Response Closure.
- Determine winning or drawn Hand result facts.
- Gate: complete first-Hand scenarios and generated turn/card-conservation invariants pass for both Rulesets.

### 4. Match settlement

- Apply Dealer Team changes, Team Level advancement, Trump Rank `5` failure counters, and both Match Ending settings.
- Make the finishing play emit one atomic event batch containing all settlement facts.
- Implement natural Match completion and Match abortion, retaining completed Hands and final Team Levels as required.
- Gate: settlement, draws, team changes, terminal rank `6`, three-failure loss, and completion pass from completed-Hand states; abortion passes from an active, incomplete Hand.

### 5. Subsequent Hands and Tribute

- Implement deal → determine Tribute → pair recipients → Return Cards → choose leader → first play.
- Cover both Tribute Card Selection settings, both Return Card Selection settings, both pairing settings, and both leader settings where no ballot is required.
- Implement the 4p2d highest-held-non-joker Tribute rule.
- Record every card-zone change.
- Gate: complete multi-Hand flows under `省心` and `自主` pass, including 4p2d behavior.

### 6. Tie-choice protocol

- Implement private simultaneous ballots, give-up, collisions, partial commitments, three-round limits, and deterministic fallback.
- Cover tied Tribute-recipient pairing and tied highest-Tribute leader selection.
- Reveal ballots only when a round resolves; unresolved ballots remain absent from other player views.
- Gate: protocol examples, `2–1–0` partial resolution, all-give-up, and seeded fallback reproduction pass.

### 7. Challenge Hands and hardening

- Add resolved Challenge Template selection, effective-Ruleset seat handling, and readiness reset.
- Apply active-Room locks during a Challenge Hand; its first start permanently locks only Seating Policy. Its template configuration neither replaces nor locks Match Rules Configuration.
- Reproduce source logical-seat setup and seeded choices while recording independent actions and results.
- End after one Hand; implement Challenge Hand abortion without a public result or completed-Hand history.
- Complete interrupted/archive lifecycle evolution.
- Audit player-specific views and completed-Hand event sufficiency across every phase.
- Gate: source deal reproduction, reusable independent challenges, abort privacy, event replay, and hidden-information tests pass.

## Completion gate

Every phase must:

- pass `pnpm check`;
- test behavior through the module seam;
- prove that folding emitted events produces the accepted candidate state;
- cover both Rulesets where applicable;
- verify player-specific visibility for every state introduced;
- add no speculative ports or adapters;
- leave persistence envelopes, protocol validation, presence-triggered orchestration, and command deduplication outside `game-core`.

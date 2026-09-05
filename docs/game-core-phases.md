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
- `RoomCreated` carries the Room ID, owner, complete initial Match Rules Configuration, and Seating Policy; it creates the owner's membership at join order `0` with no seat, readiness, or selected activity.
- Commands cover join, leave, seat assignment/removal, readiness, complete Match Rules Configuration replacement, Seating Policy replacement, and Match selection. Every command carries its acting Player Account; only members act, except that a Player Account joins itself.
- Accepted facts are explicit events. Owner departure emits membership removal plus ownership transfer to the remaining member with the lowest join order; the sole remaining owner cannot leave in this phase. A rejoin receives the next monotonic join order.
- Membership cannot exceed the effective Ruleset's player count. Seat indices come from `game-rules` metadata; one member occupies at most one seat and assigning another seat moves that member atomically. Only seated members may become ready.
- A `4p2d → 6p3d` change preserves seats `0..3`. A `6p3d → 4p2d` change is rejected with five or more members, preserves assignments when every occupied index is `0..3`, and otherwise clears all assignments. Every effective-Ruleset change clears readiness; no other lobby mutation does.
- `derivePlayerView` exposes the complete non-secret lobby state without exposing authoritative state. `deriveStartRequirements` returns the ordered seated Player Account IDs only when a Match is selected, every required seat is occupied, and every occupant is ready; otherwise it returns no requirements.
- Reject invalid authority, membership, capacity, seat, readiness, lifecycle, and no-change commands without events. Serialization seams validate command and configuration shapes; `evolve` applies supported facts without legality decisions.
- Gate: event replay reconstructs identical state; complete 4p2d and 6p3d Match-lobby flows pass.
- Tests also compare incremental folding with full event replay, cover owner departure and rejoin order, and exercise both directions of Ruleset change.

### 2. Deterministic Match start

- Implement the auto-start contract.
- Build decks from Ruleset metadata.
- Add versioned, domain-separated seeded seating, dealer selection, shuffle, and selections required by resolved Rule Variants.
- Resolve seating, initial dealer, Dealer Team, Team Levels, Trump Rank, and deal.
- Reject membership, seat, Rules Configuration, and Seating Policy changes while the Room is active.
- Permanently lock Match Rules Configuration and Seating Policy when the first Match starts.
- Record all reproducibility inputs in private Hand-start events.
- Hide opponents' cards in player views.
- Add an internal `StartMatch` command carrying the fresh Hand Seed plus supported randomness and shuffle versions. It has no Player Account actor and revalidates the same durable conditions as `deriveStartRequirements`; presence remains external.
- Accept start as one `MatchStarted` event containing the Ruleset, resolved Rules Configuration, Seating Policy, Hand Seed, algorithm versions, resolved seat-ordered Player Accounts, dealer seat, Dealer Team, initial Team Levels `[2, 2]`, Trump Rank `2`, and Team-Level-`5` failure counters `[0, 0]`. Do not persist a duplicate deal in the event.
- Support only `dglz-random-v1` and `dglz-shuffle-v1`. Random v1 derives a separate SplitMix64 stream for each UTF-8 `Hand Seed / Ruleset ID / domain` tuple using FNV-1a-64; bounded choices use rejection sampling. Shuffle v1 is descending Fisher–Yates.
- Use domains `seating`, `initial-dealer`, and `deck`. Fixed Seating preserves lobby seat order; Randomized Seating uniformly permutes those Player Accounts. Dealer selection is an independent uniform seat choice, and alternating seat parity identifies the Dealer Team.
- Build each physical deck in `2..A` rank order, `S/H/D/C` suit order, then `SMALL/BIG`, with deck copy number outermost. Shuffle the combined deck and deal round-robin in seat-index order; both Rulesets yield 27 Card Instances per player.
- `evolve(MatchStarted)` deterministically reconstructs hands from the event inputs, installs resolved seats and initial Match facts, changes lifecycle to `ACTIVE`, and locks Match Rules Configuration and Seating Policy. Active-Room lobby commands reject without events; start cannot repeat.
- Active player views expose public initial Match facts, every hand size, and only the requesting Player Account's Card Instances. They never expose the Hand Seed, algorithm versions, or opponents' cards. Active state yields no start requirements.
- No first-Hand Rule Variant requires another seeded choice. Add further domains only in the phase that needs them.
- Gate: identical inputs reproduce identical events and deals; lifecycle locks, card conservation, and seating-permutation invariants pass.
- Tests use fixed fixtures plus generated seeds to prove deterministic replay, exact card conservation, 27-card hands, valid randomized permutations, fixed-seat preservation, domain independence, start revalidation, active locks, and player-specific visibility for both Rulesets.

### 3. Active Hand play

- Implement Play and Pass commands, turn ownership, card ownership, response circuits, lead resets, finished-player skipping, and Finish Positions.
- Delegate combination legality and Automatic Response Closure to `game-rules`.
- Emit no synthetic Passes for Automatic Response Closure.
- Determine winning or drawn Hand result facts.
- Add member-authored `Play` and `Pass` commands. `Play` carries canonical Card Instance codes; `game-core` resolves them only from the actor's current hand, supplies the active Rules Configuration, Trump Rank, finishing status, and unbeaten play to `game-rules`, and returns its rejection reason unchanged.
- Add serialized `CardsPlayed`, `PlayerPassed`, `PlayerFinished`, `TurnAdvanced`, `LeadReset`, and `HandResultDetermined` facts. A played-card fact records Card Instance codes plus the chosen form, rank, represented faces, and comparison ranks; persisted events never contain decoded card objects.
- Treat increasing seat indices modulo player count as counter-clockwise order. The dealer acts first. Only the current unfinished player acts; Pass is invalid on an open lead.
- A legal play removes exactly those Card Instances, becomes the unbeaten play, and clears passes from the prior response circuit. A Pass belongs only to the current unbeaten play. Finished players are skipped.
- After every Pass, reset the lead once every other seat relative to the unbeaten player has passed or finished. The unbeaten player leads again if unfinished; otherwise the next unfinished player counter-clockwise from that seat leads.
- After a legal Automatic Response Closure pattern, reset immediately when the Hand continues. Emit `CardsPlayed` and `LeadReset` only, plus `PlayerFinished` when applicable; never synthesize `PlayerPassed` facts or inspect hidden hands.
- Assign 1-based Finish Positions as hands empty. After each new finisher, end the Hand when either alternating-seat team has finished. If it is the first finisher's team, record a win and every unfinished opponent as caught; otherwise record a draw with nobody caught. The first finisher's team is recorded as the next Dealer Team in either result.
- Phase 3 records the Hand result and stops accepting actions but does not yet advance Team Levels, failure counters, Dealer Team, lifecycle, or Match outcome; Phase 4 extends the same finishing-command event batch with settlement facts.
- Player views expose the current actor, unbeaten serialized play, current-circuit passes, Finish Positions, public Hand result, and per-seat hand sizes. Only the requesting player's remaining Card Instance codes are visible; the Hand Seed and opponents' cards remain absent.
- Gate: complete first-Hand scenarios and generated turn/card-conservation invariants pass for both Rulesets.
- Tests cover leads, stronger responses, passes, re-entry after a new response, ordinary and automatic lead resets, finishing Wildcard interpretation, finished-player skipping, win and draw facts, rejection paths, full replay, and player-specific visibility. Generated legal-single scenarios conserve every Card Instance across remaining hands plus played facts and keep each accepted action on the current unfinished player.

### 4. Match settlement

- Apply Dealer Team changes, Team Level advancement, Trump Rank `5` failure counters, and both Match Ending settings.
- Make the finishing play emit one atomic event batch containing all settlement facts.
- Implement natural Match completion and Match abortion, retaining completed Hands and final Team Levels as required.
- Extend a Hand-ending `Play` batch after `HandResultDetermined` with one `HandSettled` fact containing the completed Hand number and resulting Dealer Team, Team Levels, and failure counters. The completed-Hand count begins at zero and advances exactly once per settled Hand.
- The first finisher's team becomes the next Dealer Team. Only a winning current Dealer Team advances one Team Level; a draw or a different winning team advances neither team. The settled Hand retains the Trump Rank it began with; Phase 5 applies the next Dealer Team's level when starting the next Hand.
- A Hand begun by a Dealer Team at Trump Rank `5` increments that team's failure counter unless that team wins. Both a draw and an opposing-team win are failures; other counters never change.
- A current Dealer Team winning at Team Level `5` advances to terminal rank `6` and wins the Match. Under `three-failure-limit-at-5`, its third failure instead completes the Match with the opposing team as winner. Under `no-failure-limit-at-5`, failures are recorded but never end the Match.
- Append `MatchCompleted` to the same finishing-play batch for a terminal result. Record the winning team, ending reason, final Team Levels, and completed-Hand count; return the Room to `LOBBY`, clear the selected activity and readiness, and retain the settled Match facts. Non-terminal settlement leaves the Room `ACTIVE` with no accepted Hand actions until Phase 5 starts the next Hand.
- Add owner-authored `AbortMatch`. While a Match is active, it emits `MatchAborted` with final Team Levels and completed-Hand count, returns the Room to `LOBBY`, clears selection and readiness, and retains only public Match summary state; incomplete-Hand facts remain private persisted events. Non-owners and non-active Rooms reject without events.
- Retain the active Match aggregate after completion or abortion so replay and later history formatting keep final facts. Player views expose completed-Hand count and a completed/aborted Match summary, but expose Hand cards, action state, and Hand result only while the Room remains `ACTIVE`.
- Gate: settlement, draws, team changes, terminal rank `6`, three-failure loss, and completion pass from completed-Hand states; abortion passes from an active, incomplete Hand.
- Tests cover Dealer and non-Dealer wins, draws, both Match Ending settings, failure-counter isolation, terminal-rank and third-failure completion, owner authorization, readiness reset, post-terminal action rejection, atomic event ordering, immutable events/views, full replay, and generated settlement invariants for both Rulesets.

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

# `game-core` Implementation Record

Status: Complete as of 2026-09-06. This document records the seven implemented phases; it is not an active roadmap.

## Module seam

The completed external interface uses these operation shapes:

```ts
decide(state | undefined, command): Decision
evolve(state | undefined, event): State
derivePlayerView(state, playerId): PlayerView
deriveStartRequirements(state): StartRequirements | undefined
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
- Add an internal `StartNextHand` command carrying a fresh Hand Seed and supported randomness/shuffle versions. Accept it only for an active, non-terminal Match whose prior Hand is settled; reject empty seeds, unsupported versions, a second start for the same settled Hand, and other lifecycle states without events. Seed freshness across Hands remains the Room executor's responsibility.
- Emit `HandStarted` with the next 1-based Hand number, Ruleset, resolved Rules Configuration, Seating Policy, seat-ordered Player Accounts, Dealer Team, Team Levels, failure counters, Trump Rank, Hand Seed, and algorithm versions. Deal 27 cards per seat with the existing deck/shuffle contract and retain the private seed for Phase 6 fallback.
- Model only durable setup stages: Tribute selection, recipient-pairing tie, Return Card selection, leader-selection tie, and play. A no-Tribute Hand skips directly to leader selection.
- Tribute givers are the previous result's caught players; recipients are the winning team's first equally many finishers. A draw has no givers. Rank Tribute cards under the new Hand's Trump Rank; 4p2d excludes Jokers before finding each giver's highest held rank.
- Under Fair Random, choose uniformly among each giver's eligible Card Instances using domain `tribute-card/<seatIndex>` and emit `TributeCardSelected`. Under Giver Choice, accept `SelectTributeCard` only from that giver and eligible set; choices remain committed while other givers act.
- Under Adjacent-first Automatic, first pair each giver with an available recipient immediately preceding that giver in play order, then pair the sole remainder. Under Finish Position by Tribute Rank, sort rank groups high-to-low and pair singleton groups automatically; expose a recipient-pairing tie and stop for Phase 6 when a group has multiple givers and recipients.
- Emit `TributeTransferred` for every paired giver/card/recipient and move that exact Card Instance. Do not represent a card in two zones or emit a second selection fact during transfer.
- For 4p2d and Recipient Choice, `SelectReturnCard` is authored by the recipient and transfers one owned Card Instance back. Under Giver Choice from Candidates, non-Joker Tribute still uses Recipient Choice; for `SMALL`/`BIG`, the recipient uses `OfferReturnCandidates` with exactly two/three owned Card Instances of distinct printed ranks, then the giver selects one offered instance through `SelectReturnCard`.
- Emit `ReturnCandidatesOffered` for a valid offer and `ReturnTransferred` for the chosen card. The received Tribute Card is eligible. Complete setup only after every Tribute transfer has exactly one Return transfer.
- Under First Finisher, choose the prior first finisher. Under Highest Tribute, choose the unique highest-ranked Tribute giver, or the first finisher when no Tribute is owed; expose a leader-selection tie and stop for Phase 6 when multiple givers share the highest rank. Emit one `HandLeaderChosen`, then enter play with that player as current actor.
- Player views expose the setup stage, committed public Tribute/Return transfers, public candidate offers, pending actors, and only the requesting player's eligible Tribute choices. They expose no Hand Seed, opponents' hands, or unresolved private Phase 6 ballots.
- Gate: complete multi-Hand flows under `省心` and `自主` pass, including 4p2d behavior.
- Tests cover deterministic next deals, both Rulesets and presets, no-Tribute fast path, automatic and rank pairing without ties, both Return Card paths, 4p2d Joker exclusion, received-card return, tie deferral, command rejection, event order/replay, player-specific visibility, and generated card-conservation/determinism invariants.

### 6. Tie-choice protocol

- Add one `SubmitTieChoiceBallot` command for the active tie. Its author chooses one current candidate or `give-up`; reject non-members, non-voters, wrong stages, duplicate submissions in a round, and stale/ineligible candidates without events.
- Record each accepted private submission as `TieChoiceBallotSubmitted`. The final submission in a round atomically adds the applicable public round-resolution fact and any resulting `TributeTransferred` or `HandLeaderChosen` facts. No clock, presence, or automatic disconnect ballot enters `game-core`.
- Keep internal tie state on the active Hand: tie kind, 1-based round, voters, current candidates, current private ballots, and resolved public rounds. Recipient-pairing voters/candidates shrink after commitments; leader voters remain the original tied givers while candidates may shrink.
- For recipient pairing, process tied Tribute-rank groups highest first. In each round, commit every recipient selected by exactly one unresolved giver; collisions and `give-up` stay unresolved. Preserve prior and singleton pairs, automatically pair a sole remainder, then continue into the next rank group or Return Cards.
- After an unresolved recipient-pairing round three, apply the existing Adjacent-first Automatic rule only to its remaining givers and recipients. Record the revealed round and exact fallback pairs before emitting their card transfers.
- For leader selection, exclude `give-up`, choose a unique plurality, or retain only candidates tied for the highest nonzero count. All-give-up retains the candidate set. Every inconclusive round keeps all original voters and advances the round.
- After an inconclusive leader round three, choose uniformly from the remaining candidates using the current private Hand Seed, existing random version, and domain `tie-choice/leader-fallback`; record the revealed ballots and selected fallback leader.
- Public resolution facts include ordered revealed ballots, newly committed outcomes, remaining candidates, round number, and whether fallback ran. `evolve` applies those facts without re-running ballot or random decisions; full event replay reaches the same setup state.
- Player views expose tie kind, round, voters, candidates, submitted voter IDs, the requesting voter's own current ballot, and previously resolved rounds. Before resolution, no other voter's choice appears; after resolution, that round's ballots and outcomes are public. `pendingPlayerIds` contains only voters who have not submitted in the current round.
- Preserve card conservation and setup ordering across chained ties: no Return Card begins before every recipient pair transfers, and no first play begins before Returns and leader resolution finish.
- Tests cover invalid/duplicate ballots, private partial commitments, collisions, give-up, `2–1–0` partial pairing, sole-remainder pairing, multiple rank groups, unique plurality, candidate narrowing, all-give-up, both three-round fallbacks, event order/replay, immutable/player-specific views, and generated seeded-fallback determinism.
- Gate: protocol examples pass under the `自主` preset without regressing `省心`, 4p2d, or Phase 5 card-conservation flows.

### 7. Challenge Hands and hardening

- Define a server-private `ChallengeTemplate` value with Ruleset, resolved Rules Configuration, Hand Seed, randomness/shuffle versions, Dealer Team, Team Levels, failure counters, and a setup union: initial-Hand dealer seat or subsequent-Hand seat-indexed Finish Positions/result facts needed for Tribute and first lead. It contains no Challenge Code or source Player Account identity.
- Add owner-authored `SelectChallengeHand` carrying an already-resolved template; Challenge Code lookup, throttling, persistence, and template creation stay outside `game-core`. Reject malformed/version-incompatible templates and selections whose effective Ruleset is smaller than current membership.
- Treat the selected activity's Ruleset as the lobby's effective Ruleset for membership capacity, valid seats, rendered seat count, and `deriveStartRequirements`. Switching Match/Challenge selection clears readiness; shrinking clears out-of-range assignments, while growth preserves valid assignments.
- Match Rules Configuration changes remain allowed until the first Match starts. While a Challenge Hand is selected, they do not change its effective Ruleset, clear Challenge readiness, or replace the selected template.
- Add internal `StartChallengeHand`, accepted only for a selected Challenge with every effective seat durably ready. Apply the Room Seating Policy to map current Player Accounts onto source logical seats, using the template Hand Seed and existing `seating` domain when randomized.
- Emit self-sufficient `ChallengeHandStarted` facts with the template setup and resolved seat-ordered current Player Accounts. Reuse the existing deal, Tribute, Return, tie-choice, leader, play, and Hand-result implementation; the same template and logical seat mapping reproduce the source seat-indexed deal and seeded choices.
- Starting the first Match permanently locks Match Rules Configuration and Seating Policy. Starting the first Challenge Hand permanently locks only Seating Policy; its template configuration becomes the active Hand configuration without replacing or locking the Room's Match configuration.
- Mark the active aggregate as Match or Challenge Hand so Match settlement/next-Hand commands cannot run against a Challenge. When its Hand result is determined, append `ChallengeHandCompleted`, return the Room to `LOBBY`, clear selection/readiness, expose a completed Challenge result, and retain enough public facts for history; never start a second Hand.
- Add owner-authored `AbortChallengeHand`. Emit `ChallengeHandAborted`, return to `LOBBY`, clear selection/readiness, and expose no result or completed-Hand summary; incomplete private events remain only in the persisted stream.
- Add internal `InterruptRoom` for an active Match or Challenge and owner-authored `ArchiveRoom` for an interrupted Room. `RoomInterrupted`/`RoomArchived` are terminal view states that reveal no active hands or seeds. Creating a replacement Room with copied Match configuration remains outside this module.
- Keep active-Room membership, seat, activity, configuration, and Seating Policy locks identical for Matches and Challenge Hands. Reject activity-specific start, abort, continuation, ballot, and play commands in the wrong lifecycle/kind without events.
- Player views expose the selected/active activity kind, effective Ruleset seating, active Challenge public facts, and a completed Challenge result only after natural completion. They never expose template/Hand Seeds, opponents' cards, source identities, or aborted/interrupted private Hand facts.
- Tests cover effective-Ruleset selection transitions, readiness/seat handling, lock isolation, first/subsequent source setup reproduction, reusable independent Challenge runs, both Rulesets, Tribute/tie seeded choices, one-Hand completion, abort privacy/authority, interruption/archive, replay/event order, immutable views/events, and generated deal/card-conservation determinism.
- Gate: all prior Match flows remain unchanged; source deals and setup choices reproduce by logical seat, completed Challenges retain history facts, and aborted/interrupted views disclose no private state.

## Completion gate

Every phase must:

- pass `pnpm check`;
- test behavior through the module seam;
- prove that folding emitted events produces the accepted candidate state;
- cover both Rulesets where applicable;
- verify player-specific visibility for every state introduced;
- add no speculative ports or adapters;
- leave persistence envelopes, protocol validation, presence-triggered orchestration, and command deduplication outside `game-core`.

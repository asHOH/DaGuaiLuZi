# 大怪路子 Game

This glossary distinguishes the game's identities and versioned rule configurations without prescribing their implementation.

## Universal Language

**Player Account**:
A persistent player identity to which participation and future match history belong.
_Avoid_: Guest, temporary player

**Room**:
A durable container for members, seats, one fixed Rules Configuration for Matches, one Seating Policy, and Matches or Challenge Hands. It exists independently of socket connections.
_Avoid_: Match, lobby, socket room

**Room Member**:
A Player Account that has joined a Room and may occupy one seat; connection state does not affect membership.
_Avoid_: Connected player, present player

**Room Owner**:
The Room Member with authority over the Rules Configuration, Seating Policy, Match or Challenge Hand choice, and Room lifecycle actions.
_Avoid_: Host, dealer

**Seating Policy**:
A Room setting deciding whether a Match or Challenge Hand retains lobby seats or randomly assigns its six members when it starts.
_Avoid_: Rule Variant, seat mode

**Aborted Match**:
An active Match ended without a winner by the Room Owner. Its completed Hand history and final Team Levels remain available.
_Avoid_: Interrupted Room, completed Match

**Aborted Challenge Hand**:
An active Challenge Hand ended by the Room Owner before settlement. It produces no result or completed-Hand history.
_Avoid_: Aborted Match, completed Challenge Hand

**Interrupted Room**:
A Room whose active Match or Challenge Hand cannot be reconstructed and resumed.
_Avoid_: Aborted Match, disconnected Room

**Ruleset**:
A versioned family of fixed rules and Rule Variants.
_Avoid_: Mode, option

**Rules Configuration**:
A Ruleset plus one selected setting for every Rule Variant.
_Avoid_: Ruleset, options

**Rules Configuration Preset**:
A named complete initial selection for a Room's Match Rules Configuration.
_Avoid_: Ruleset, Rule Variant

**Rule Variant**:
A named rule difference selected for a room, such as Joker Pair Comparison or Wildcard Rank.
_Avoid_: Special case, toggle

**Six-player Ruleset**:
The three-deck Ruleset defined by `docs/ruleset.md`; external game descriptions are references only.
_Avoid_: Default mode

**Four-player Ruleset**:
The planned two-deck, four-player ruleset.
_Avoid_: Small mode

**Hand**:
One deal of the cards, ending after its result is settled and immediately before the next deal. Hidden dealt cards may be revealed when the hand ends.
_Avoid_: Match, round

**Hand Seed**:
A server-held random value used with versioned Hand setup information to reproduce a deal and other seeded choices. It is not shared with players.
_Avoid_: Challenge Code, share code

**Hand Replay**:
A read-only playback of one completed Hand's recorded deal and actions. Multiple viewers may open the same Replay at independent playback positions; no other viewer is required. It is not a Room, Match, or opportunity to make different plays.
_Avoid_: Replay Room, replay Match, social replay

**Challenge Template**:
The reusable starting conditions captured from one completed Hand for playable duplication, independent of its recorded actions and Player Accounts.
_Avoid_: Hand Replay, Challenge Hand

**Challenge Code** (`同牌挑战码`):
The shareable identifier for one Challenge Template. It can open the source Hand Replay and initialize Challenge Hands.
_Avoid_: Hand Seed, replay code

**Challenge Hand** (`同牌挑战`):
A playable duplicate initialized from a Challenge Template. Six players receive the source Hand's logical-seat setup but make independent choices and produce a separate result.
_Avoid_: Hand Replay, continued source Hand

**Match**:
A sequence of Hands ending when one team satisfies the selected Match Ending condition, or ending without a winner as an Aborted Match.
_Avoid_: Hand, game session

**Card Face**:
The printed identity shared by equivalent cards across decks, named in rules notation without selecting a physical copy, such as `AS`, `SMALL`, or `BIG`.
_Avoid_: Card ID, Card Instance

**Card Instance**:
One specific physical copy of a Card Face in a multi-deck Hand, named by appending its copy number, such as `AS#2`.
_Avoid_: Card Face

**Joker-only Play**:
A legal 1-, 2-, 3-, or 5-card play containing only `SMALL` and `BIG`, interpreted by its dedicated gameplay rule.
_Avoid_: All-joker combination

**Automatic Response Closure**:
An immediate lead reset after one of the fixed, publicly visible Joker-only Play patterns that cannot receive a stronger response from the remaining physical deck.
_Avoid_: Globally unbeatable check, hidden-hand check

**Team Level**:
A team's retained progression rank within a Match. It begins at `2`, may advance, and never decreases.
_Avoid_: Trump Rank, score

**Dealer Team**:
The team whose Team Level determines the Hand's Trump Rank and may advance after the Hand.
_Avoid_: Dealer Side, banker team

**Trump Rank**:
The Dealer Team's Team Level as applied to one Hand.
_Avoid_: Level Card, dealer rank

**Finish Position**:
A player's place in the order in which players empty their hands.
_Avoid_: Rank, placement

**Tribute**:
A card transferred from a caught opponent's newly dealt Hand before its first lead and followed by one Return Card.
_Avoid_: Contribution, penalty card

**Return Card**:
The card transferred back from a Tribute recipient to its giver.
_Avoid_: Returned Tribute, repayment

## Rule Variants

**Joker Pair Comparison**:
A Rule Variant deciding whether `[SMALL, SMALL]` ties or beats `[SMALL, BIG]`.
_Avoid_: Joker rule

**Wildcard Rank**:
A Rule Variant deciding whether a wildcard uses the weakest or strongest legal rank after the normal strongest-form choice.
_Avoid_: Wildcard priority

**Finishing Wildcard Interpretation**:
A Rule Variant deciding whether a wildcard play that empties its player's hand uses normal interpretation or its weakest legal form and rank.
_Avoid_: Last Hand rule

**Flush Tie-Breaking**:
A Rule Variant deciding whether flushes with equal highest cards tie or compare their remaining ranks from highest to lowest.
_Avoid_: Suit comparison

**Next-Hand Leader**:
A Rule Variant deciding whether the first finisher or the giver of the highest-ranked Tribute leads the next Hand.
_Avoid_: Starting player

**Tribute Card Selection**:
A Rule Variant deciding whether the system chooses fairly at random or the giver chooses among Card Instances tied at the required Tribute rank.
_Avoid_: Tribute rank

**Return Card Selection**:
A Rule Variant deciding whether the Tribute recipient selects the Return Card or offers candidates from which the giver selects it.
_Avoid_: Return method

**Tribute Recipient Pairing**:
A Rule Variant deciding how Tribute givers are matched to recipients.
_Avoid_: Tribute order

**Match Ending**:
A Rule Variant deciding whether a team has unlimited non-winning attempts at Trump Rank `5` or loses after three.
_Avoid_: Game over rule

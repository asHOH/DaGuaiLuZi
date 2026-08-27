# 大怪路子 Game

This glossary distinguishes the game's identities and versioned rule configurations without prescribing their implementation.

## Universal Language

**Player Account**:
A persistent player identity to which participation and future match history belong.
_Avoid_: Guest, temporary player

**Ruleset**:
A complete, versioned set of game rules that binds exactly one setting for every Rule Variant.
_Avoid_: Mode, option

**Rule Variant**:
A named rule difference selected for a room, such as Joker Pair Comparison or Wildcard Interpretation.
_Avoid_: Special case, toggle

**Initial Ruleset**:
The six-player, three-deck Ruleset defined by `docs/gameplay-spec.md`; external game descriptions are references only.
_Avoid_: Default mode

**Four-player Ruleset**:
The planned two-deck, four-player ruleset.
_Avoid_: Small mode

**Hand**:
One deal of the cards, ending after its result is settled and immediately before the next deal. Hidden dealt cards may be revealed when the hand ends.
_Avoid_: Match, round

**Match**:
A sequence of Hands ending when one team satisfies the selected Match Ending condition.
_Avoid_: Hand, game session

**Card Face**:
The printed identity shared by equivalent cards across decks, named in rules notation without selecting a physical copy, such as `AS`, `SMALL`, or `BIG`.
_Avoid_: Card ID, Card Instance

**Card Instance**:
One specific physical copy of a Card Face in a multi-deck Hand, named by appending its copy number, such as `AS#2`.
_Avoid_: Card Face

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

**Wildcard Interpretation**:
A Rule Variant deciding which legal form and value a wildcard play represents, including any different treatment when it empties a player's hand.
_Avoid_: Wildcard priority

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

# 大怪路子 Game

This glossary distinguishes the game's identities and versioned rule configurations without prescribing their implementation.

## Language

**Player Account**:
A persistent player identity to which participation and future match history belong.
_Avoid_: Guest, temporary player

**Ruleset**:
A complete, versioned set of game rules, including player count, deck count, and any house-rule choices.
_Avoid_: Mode, option

**Rule Variant**:
A named rule difference selected for a room, such as whether a pair of small jokers beats a mixed big-and-small-joker pair or ties it.
_Avoid_: Special case, toggle

**Initial Ruleset**:
The six-player, three-deck ruleset based on the linked 弈棋耍大牌 description, with deviations recorded as explicit variants.
_Avoid_: Default mode

**Four-player Ruleset**:
The planned two-deck, four-player ruleset.
_Avoid_: Small mode

**Hand**:
One deal of the cards, ending after its result is settled and immediately before the next deal. Hidden dealt cards may be revealed when the hand ends.
_Avoid_: Match, round

**Card Face**:
The printed identity shared by equivalent cards across decks, named in rules notation without selecting a physical copy, such as `AS`, `SMALL`, or `BIG`.
_Avoid_: Card ID, Card Instance

**Card Instance**:
One specific physical copy of a Card Face in a multi-deck Hand, named by appending its copy number, such as `AS#2`.
_Avoid_: Card Face

**Dealer Team**:
The team whose current level determines the Hand's Trump Rank and may advance after the Hand.
_Avoid_: Dealer Side, banker team

**Trump Rank**:
The card rank selected by the Dealer Team's current level for a Hand.
_Avoid_: Level Card, dealer rank

**Finish Position**:
A player's place in the order in which players empty their hands.
_Avoid_: Rank, placement

**Tribute**:
A card transferred by a caught opponent before the next Hand and followed by one returned card.
_Avoid_: Contribution, penalty card

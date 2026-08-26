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

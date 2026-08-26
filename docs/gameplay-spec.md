# Initial Gameplay Spec

Status: Source-derived draft for the Initial Ruleset

This document condenses the linked [弈棋耍大牌 rules](https://www.17dp.com/down/gamelist/id/202), with [GameTea's fuller description](https://www.gametea.com/games/daguailuzi.html) used where it clarifies the same rules. Product requirements and explicit Rule Variants take precedence.

Six players form two teams of three in alternating seats. Three standard 54-card decks are shuffled together; each player receives 27 cards. Suited Card Faces use rank then suit (`AS`, `10H`); jokers are `SMALL` and `BIG`. Copy suffixes are omitted unless a specific Card Instance matters.

## 1. Legal Moves

### Card order and wildcards

For singles, cards rank from high to low:

`BIG > SMALL > Trump Rank > A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2`

The current Trump Rank is removed from its ordinary position. Suits do not break ties.

`SMALL` and `BIG` are wildcards in every non-single form. A play with wildcards is interpreted as its strongest legal form, except that a wildcard completes the lowest possible straight. Wildcards do not themselves become the comparison card. The room's Joker Pair Comparison variant determines whether `[SMALL, SMALL]` beats or ties `[SMALL, BIG]`.

### Legal forms

Only 1-, 2-, 3-, and 5-card plays are legal.

| Count | Form | Composition |
| ---: | --- | --- |
| 1 | Single | Any card. |
| 2 | Pair | Two cards of one rank. |
| 3 | Triple | Three cards of one rank. |
| 5 | Mixed-suit straight | Five consecutive ranks, not all one suit. |
| 5 | Flush | Five cards of one suit, but not a straight. |
| 5 | Full house | A triple and a pair of different ranks. |
| 5 | Four-plus-one | Four cards of one rank and one card of another rank. |
| 5 | Straight flush | Five consecutive cards of one suit. |
| 5 | Five of a kind | Five cards of one rank. |

If five cards satisfy more than one form, they take the strongest applicable form. Five-card forms rank:

`five of a kind > straight flush > four-plus-one > full house > flush > mixed-suit straight`

### Comparison

A response must contain the same number of cards and be strictly stronger than the previous play. For five-card plays, a higher form always beats a lower form. Otherwise compare:

- pair, triple, or five of a kind: the repeated rank;
- full house: the triple's rank;
- four-plus-one: the four-card rank;
- flush: its highest card, with no suit advantage;
- straight or straight flush: its high card.

For ordinary comparison, the Trump Rank is above `A`. Within a straight it has its natural position instead. `A2345` is the lowest straight and `10JQKA` the highest.

### Turn flow

The first dealer is random and leads the first play. A leader may play any legal form. Each following player either plays a valid stronger response or passes. After five consecutive passes, the last player who played leads again with any legal form. Play continues until the Hand result is determined.

The source states that a *Heavenly Kings Bomb* beats every other form but does not define its cards. This form remains unresolved and must be defined before implementation.

## 2. Hand Result

Players receive Finish Positions as they empty their hands. The Hand ends when every player on one team has finished.

- If the first finisher's team finishes first, that team wins. Each opponent still holding cards is caught and owes Tribute before the next Hand.
- If the opposing team finishes while teammates of the first finisher still hold cards, the result is a draw and nobody owes Tribute.
- The first finisher's team is the Dealer Team for the next Hand, and the first finisher leads it.
- A winning Dealer Team advances its Trump Rank by one. A different team becoming the Dealer Team does not advance its own level; a draw never advances either level.

Each player owing Tribute automatically gives their highest card. The corresponding recipient returns one card of their choice. Recipients follow Finish Position: one Tribute goes to the winning team's first finisher; two or three go to that team's first two or three finishers, paired by nearest play order.

Numeric scoring and longer-term victory conditions are intentionally unspecified.

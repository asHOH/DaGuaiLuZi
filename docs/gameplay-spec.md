# Initial Gameplay Spec

Status: Source-derived draft for the Initial Ruleset

This document condenses the linked [弈棋耍大牌 rules](https://www.17dp.com/down/gamelist/id/202), with [GameTea's fuller description](https://www.gametea.com/games/daguailuzi.html) used where it clarifies the same rules. Product requirements and explicit Rule Variants take precedence.

Six players form two teams of three in alternating seats. Three standard 54-card decks are shuffled together; each player receives 27 cards. Suited Card Faces use rank then suit (`AS`, `10H`); jokers are `SMALL` and `BIG`. Copy suffixes are omitted.

## 1. Legal Moves

### Card order and wildcards

For singles, cards rank from high to low:

`BIG > SMALL > Trump Rank > A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2`

The current Trump Rank is removed from its ordinary position. Suits do not break ties.

`SMALL` and `BIG` are wildcards in every non-single form. Two independent Rule Variants govern their interpretation:

- **Joker Pair Comparison** has two settings: `[SMALL, SMALL]` either ties `[SMALL, BIG]` or beats it.
- **Wildcard Interpretation** has three settings:
  - **Strongest form, lowest straight:** choose the strongest legal form, but complete the lowest possible straight.
  - **Always strongest:** choose the strongest legal form and value, including for straights.
  - **Weakest on finish:** behave as Always Strongest unless the play empties the player's hand, in which case choose the weakest legal interpretation. For example, a final `[4C, 5D, SMALL, SMALL, BIG]` becomes the mixed-suit straight `A2345`.

Wildcards do not themselves become the comparison card.

### Legal forms

Only 1-, 2-, 3-, and 5-card plays are legal.

| Count | Forms |
| ---: | --- |
| 1 | Single |
| 2 | Pair |
| 3 | Triple |
| 5 | Mixed-suit straight, flush, full house, four-plus-one, straight flush, or five of a kind |

A straight contains five consecutive ranks; a mixed-suit straight is not all one suit. A four-plus-one uses four cards of one rank and a fifth of another. If five cards satisfy multiple forms, they take the strongest applicable form.

### Comparison

A response must contain the same number of cards and be strictly stronger than the previous play. Five-card forms rank:

`five of a kind > straight flush > four-plus-one > full house > flush > mixed-suit straight`

Within the same form, compare:

- pair, triple, or five of a kind: the repeated rank;
- full house: the triple's rank;
- four-plus-one: the four-card rank;
- flush: its ranks under the Flush Tie-Breaking variant;
- straight or straight flush: its high card.

**Flush Tie-Breaking** has two settings when both flushes have the same highest card:

- **Highest card only:** the flushes tie.
- **Descending ranks:** compare the second-highest cards, then continue downward until they differ or all five ranks tie.

Suits never break a flush tie.

For ordinary comparison, the Trump Rank is above `A`. Within a straight it has its natural position instead. `A2345` is the lowest straight and `10JQKA` the highest.

### Turn flow

The first dealer is random and leads the first play. A leader may play any legal form. Each following player either plays a valid stronger response or passes. After five consecutive passes, the last player who played leads again with any legal form. Play continues until the Hand result is determined.

## 2. Hand Result

Players receive Finish Positions as they empty their hands. The Hand ends when every player on one team has finished.

- If the first finisher's team finishes first, that team wins. Each opponent still holding cards is caught and owes Tribute before the next Hand.
- If the opposing team finishes while teammates of the first finisher still hold cards, the result is a draw and nobody owes Tribute.
- The first finisher's team is the Dealer Team for the next Hand.
- A winning Dealer Team advances its Trump Rank by one. A different team becoming the Dealer Team does not advance its own level; a draw advances neither level.

**Next-Hand Leader** has two settings:

- **First finisher:** the first finisher leads the next Hand.
- **Highest Tribute:** when Tribute is owed, the player who gives the highest-ranked Tribute leads; otherwise the first finisher leads. If multiple Tributes tie for highest rank, the tied players choose the leader; the UI for this choice is TBD.

Each player owing Tribute must give a card of their highest held rank. **Tribute Card Selection** has two settings when multiple Card Instances share that rank:

- **Suit preference:** the system chooses one using a predefined suit order.
- **Giver choice:** the player giving Tribute chooses the Card Instance.

**Return Card Selection** has two settings:

- **Recipient choice:** the Tribute recipient chooses one card to return.
- **Giver choice from candidates:** the recipient offers a configured two or three cards, each of a different rank; the Tribute giver chooses the Return Card. Candidate suits are unrestricted.

**Tribute Recipient Pairing** has two settings:

- **Finish Position by Tribute rank:** sort Tributes from highest to lowest and assign them to the winning team's first, second, and third finishers respectively. When Tributes tie in rank, the tied givers choose among the corresponding recipients; the UI is TBD.
- **Adjacent-first automatic:** first pair a giver with a recipient who immediately precedes them in play order. Pair any remaining givers and recipients automatically in play order; no player choice is involved.

### Match ending

A Dealer Team at Trump Rank `5` wins the Match by winning the Hand and advancing to the terminal rank `6`. **Match Ending** has two settings:

- **Advance past 5:** only that winning advancement ends the Match.
- **Three failures at 5:** the same advancement wins the Match, but a team loses the Match upon its third non-winning Hand begun as Dealer Team at Trump Rank `5`. Both draws and losses count as failures.

Numeric scoring is intentionally unspecified.

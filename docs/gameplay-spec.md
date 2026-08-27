# Initial Gameplay Spec

Status: Authoritative gameplay specification for the Initial Ruleset

This document is the source of truth for gameplay behavior. The linked [弈棋耍大牌 rules](https://www.17dp.com/down/gamelist/id/202) and [GameTea description](https://www.gametea.com/games/daguailuzi.html) are references only.

Every room selects exactly one setting for every Rule Variant.

Six players form two teams of three in alternating seats. Three standard 54-card decks are shuffled together; each player receives 27 cards. Suited Card Faces use rank then suit (`AS`, `10H`), with `S`, `H`, `D`, and `C` for spades, hearts, diamonds, and clubs; jokers are `SMALL` and `BIG`. Copy suffixes are omitted.

Each team begins a Match at Team Level `2`, retains its level across Hands, and never loses levels. The Dealer Team's level is the current Hand's Trump Rank.

## 1. Legal Moves

### Card order and wildcards

For singles, cards rank from high to low:

`BIG > SMALL > Trump Rank > A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2`

The current Trump Rank is removed from its ordinary position. Suits do not break ties.

`SMALL` and `BIG` are wildcards in every non-single form; each may represent any non-joker Card Face (plus `BIG` can represent `SMALL`). Compare the represented form normally. Joker-only pairs outrank other pairs: `[BIG, BIG]` is highest, while **Joker Pair Comparison** decides whether `[SMALL, SMALL]` ties or beats `[SMALL, BIG]`.

- **Wildcard Interpretation** has three settings:
  - **Strongest form, lowest straight:** choose the strongest legal form and value, except complete a straight at its lowest possible value.
  - **Always strongest:** choose the strongest legal form and value, including for straights.
  - **Weakest on finish:** behave as Always Strongest unless the play empties the player's hand, then choose the weakest legal form and value. For example, a final `[4C, 5D, SMALL, SMALL, BIG]` becomes the mixed-suit straight `A2345`.

### Legal forms

Only 1-, 2-, 3-, and 5-card plays are legal.

| Count | Forms |
| ---: | --- |
| 1 | Single |
| 2 | Pair |
| 3 | Triple |
| 5 | Mixed-suit straight, flush, full house, four-plus-one, straight flush, or five of a kind |

A pair, triple, or five of a kind has two, three, or five cards of one rank. A full house has a triple and pair of different ranks; a flush has five cards of one suit; a straight flush is a same-suit straight. A straight has five consecutive ranks; a mixed-suit straight is not all one suit; a four-plus-one has four cards of one rank and a fifth of another. Copies from different decks may coexist in any form. If five cards satisfy multiple forms, use the strongest.

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

For the first Hand, a dealer is selected fairly from the six players; that player's team is the initial Dealer Team, and the dealer leads the first play. Play proceeds counter-clockwise. A leader may play any legal form. Each following unfinished player either plays a valid stronger response or passes; finished players are skipped. When a play survives a complete circuit of the other five seats, each having passed or already finished, the lead resets. The player who made that play leads if still holding cards; otherwise the next unfinished player counter-clockwise leads. Play continues until the Hand result is determined.

## 2. Hand Result

Players receive Finish Positions as they empty their hands. The Hand ends when every player on one team has finished.

- If the first finisher's team finishes first, that team wins. Each opponent still holding cards is caught and owes Tribute in the next Hand.
- If the opposing team finishes while teammates of the first finisher still hold cards, the result is a draw and nobody owes Tribute.
- The first finisher's team is the Dealer Team for the next Hand.
- A winning Dealer Team advances its Team Level by one. A different team becoming the Dealer Team does not advance its Team Level; a draw advances neither team.

Each later Hand proceeds: deal; resolve Tribute from the newly dealt cards using that Hand's Trump Rank; resolve Return Cards; first lead.

**Next-Hand Leader** has two settings:

- **First finisher:** the first finisher leads the next Hand.
- **Highest Tribute:** when Tribute is owed, the player who gives the highest-ranked Tribute leads; otherwise the first finisher leads. If multiple Tributes tie for highest rank, the tied players choose the leader; the UI for this choice is TBD.

Each player owing Tribute must give a card of their highest held rank. **Tribute Card Selection** has two settings when multiple Card Instances share that rank:

- **Fair random:** the system chooses uniformly among the eligible Card Instances.
- **Giver choice:** the player giving Tribute chooses the Card Instance.

**Return Card Selection** has two settings:

- **Recipient choice:** the Tribute recipient chooses one card to return.
- **Giver choice from candidates:** for a `SMALL` Tribute, the recipient offers two cards; for a `BIG` Tribute, three. The candidates must have different ranks, with no suit restriction, and the Tribute giver chooses the Return Card. A non-joker Tribute uses Recipient Choice.

The recipients are the winning team's first `x` finishers, where `x` is the number of Tribute givers. **Tribute Recipient Pairing** has two settings:

- **Finish Position by Tribute rank:** sort Tributes from highest to lowest and assign them to recipients in Finish Position order. When Tributes tie in rank, the tied givers choose among the corresponding recipients; the UI is TBD.
- **Adjacent-first automatic:** first pair a giver with a recipient who immediately precedes them in counter-clockwise play order. Pair any remaining givers and recipients automatically in that order; no player choice is involved.

### Match ending

A Dealer Team at Trump Rank `5` wins the Match by winning the Hand and advancing to the terminal rank `6`. **Match Ending** has two settings:

- **No failure limit at 5:** non-winning attempts at Trump Rank `5` do not themselves end the Match.
- **Three-failure limit at 5:** a team loses the Match upon its third non-winning Hand begun as Dealer Team at Trump Rank `5`. Both draws and losses count as failures.

# Tie-Choice Protocol

Status: Authoritative app-local coordination protocol

This document resolves choices delegated to tied Tribute givers. It does not define gameplay rules.

`确定贡牌 → 分配接贡方 → 完成还贡 → 选定首家 → 首次出牌`

## Common ballot rules

- Ballots are simultaneous, private, and final for their round.
- Each eligible giver selects one eligible candidate or `放弃`.
- A round resolves after every eligible giver submits. Disconnects wait for reconnection; no automatic ballot is submitted.
- Other ballots remain hidden until resolution. The result reveals the round's ballots and committed outcome.
- Each decision permits at most three rounds. The owner may instead use `终止比赛`.

## Recipient pairing

This applies to tied Tribute ranks under Finish Position by Tribute Rank.

1. Sort Tribute-rank groups highest first and give each group the corresponding consecutive recipients in Finish Position order.
2. Resolve singleton groups automatically; their pairs never reopen. Process tied groups highest first.
3. In each round, every unresolved giver selects one unresolved recipient or `放弃`.
4. A recipient selected by exactly one giver pairs with that giver. Multiple selections are a collision and remain unresolved.
5. Remove committed pairs. If one giver and recipient remain, pair them automatically; otherwise begin the next round.
6. After round three, apply Adjacent-first Automatic only to unresolved givers and recipients. Existing pairs remain unchanged.

For three tied Tributes, vote counts `2–1–0` commit the single-vote pair; the remaining two givers vote again for the remaining recipients.

## Leader selection

This applies when Highest Tribute has multiple tied givers. The original tied givers are voters and initial leader candidates.

1. Each voter selects one current candidate or `放弃`.
2. A unique plurality selects the leader; `放弃` is excluded from counts.
3. A highest-count tie removes lower-count candidates and starts another round. All original voters retain voting rights.
4. All-give-up leaves the candidate set unchanged.
5. After three inconclusive rounds, select uniformly among the remaining candidates using the current Hand Seed under a dedicated domain. Record the result.

Completion produces all recipient pairs and, when required, one leader before `首次出牌`.

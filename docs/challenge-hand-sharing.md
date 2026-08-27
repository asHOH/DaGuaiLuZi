# Challenge Hand Sharing

Status: Authoritative app-local sharing policy

A completed source Hand produces one reusable `同牌挑战码`. Sharing is its purpose. The code opens the source Hand Replay and can initialize any number of `同牌挑战` Hands.

## Responsibilities

- The **Hand Seed** is server-held random input. With versioned randomness and setup data, it reproduces the deal and other seeded choices; it is never the user-facing sharing artifact.
- The **Challenge Template** is the immutable, reusable starting setup: Ruleset, resolved Rules Configuration, randomness and shuffle versions, Hand Seed, logical seat mapping, Dealer Team and Team Levels, Match-ending counters, and the previous-Hand result facts required for Tribute and first lead.
- The **Challenge Code** is an opaque, stable reference to one Challenge Template. It is designed to be copied, reused, and placed in a shareable link; it does not contain gameplay behavior.
- The **Hand Replay** combines the source deal with its recorded actions. Multiple viewers may open the same read-only Replay at independent playback positions; no per-viewer Replay is created. It remains distinct from every Challenge Hand.

## Challenge execution

- A Challenge Hand uses a normal Room. Before play starts, the Room Owner chooses an ordinary Match or a Challenge Hand initialized by a Challenge Code.
- The Room's six seats map to the six source logical seats; their Player Accounts receive the same seat-indexed deal and starting context as the source Hand.
- Seeded choices use the source Hand Seed and the same versioned, domain-separated functions when the same decision context occurs.
- Player choices create a new event sequence, result, and completed-Hand history. They never modify the source Hand or its Replay.
- A Challenge Hand ends when its Hand result is settled; it does not continue the source Room or Match.

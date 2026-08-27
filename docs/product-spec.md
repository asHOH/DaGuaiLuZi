# 大怪路子 Product Spec

User requirements only. Be extremely concise. Do not infer.

- Friends-only responsive web app for mobile/PC on the existing VPS through `cloudflared`; no Vercel.
- MVP supports the six-player, three-deck and four-player, two-deck [Rulesets](ruleset.md). Room Match configurations start from [Rules Configuration Presets](rules-configuration-presets.md).
- Owner-managed Rooms: members join by code/link, choose seats, and ready; the owner selects fixed/random seating and a Match or Challenge Hand, which auto-starts when every seat has a ready, connected member. Browsing and discovery are post-MVP.
- post-MVP: Rooms can have spectators; membership is limited to the selected Ruleset's player count.
- Persistent username/password accounts; optional email; VPS-administrator-assisted password reset.
- Shareable completed-Hand history with read-only Hand Replay.
- Completed Hands provide reusable `同牌挑战码` for same-Ruleset Challenge Hands with the same starting setup and independent actions.
- Skip responses after `[BIG]`, `[BIG, BIG]`, any Joker-only Triple except `[SMALL, SMALL, SMALL]`, or any five-joker play.
- post-MVP: [turn timing](post-mvp-turn-timing.md) or connection-driven pause; reconnection only resynchronizes state.

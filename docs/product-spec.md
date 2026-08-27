# 大怪路子 Product Spec

User requirements only. Be concise. Do not infer.

- Friends-only responsive web app for mobile/PC on the existing VPS through `cloudflared`; no Vercel.
- Six-player, three-deck [Ruleset](ruleset.md); future four-player, two-deck Ruleset. Rooms start from [Rules Configuration Presets](rules-configuration-presets.md).
- Owner-managed Rooms: members join by code/link, choose seats, and ready; the owner selects fixed/random seating; the Match auto-starts with six connected players. Browsing and discovery are post-MVP.
- Persistent username/password accounts; optional email; VPS-administrator-assisted password reset.
- Shareable completed-Hand history with independent read-only Hand Replay.
- Completed Hands provide reusable `同牌挑战码` for six-player Challenge Hands with the same starting setup and independent actions.
- Skip responses after `[BIG]`, `[BIG, BIG]`, any Joker-only Triple except `[SMALL, SMALL, SMALL]`, or any five-joker play.
- MVP has no turn timer or connection-driven pause; reconnection only resynchronizes state. [Turn timing](post-mvp-turn-timing.md) is post-MVP.

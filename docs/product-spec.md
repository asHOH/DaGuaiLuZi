# 大怪路子 Product Spec

User requirements only. Be concise. Do not infer.

- Friends-only mobile/PC web app on the existing VPS through `cloudflared`; no Vercel.
- Initial 3-deck/6-player ruleset defined by the authoritative [gameplay specification](gameplay-spec.md), with [this external description](https://www.17dp.com/down/gamelist/id/202) retained only as a reference; future 2-deck/4-player ruleset. Rooms initialize variants through two [Rules Configuration Presets](rules-configuration-presets.md); `省心` is default.
- Rooms use an owner-managed lobby where members join by room code or shareable link, choose seats, and ready; the owner selects fixed or randomized seating before six connected players auto-start. Room browsing, lists, and public/private discovery are post-MVP.
- Persistent username/password accounts; optional email; VPS-administrator-assisted password reset.
- Detailed hand history (sharable, read-only, single-person replay).
- Completed Hands provide reusable `同牌挑战码`; another six players can play the same starting Hand with independent actions.
- Skip responses after `[BIG]`, a `BIG` pair, non-SSS Joker-only Triple, or five jokers.
- Responsive, intuitive interface.
- MVP has no turn timer or connection-driven pause state. Clients reconnect and resynchronize without changing gameplay state. Add turn timing immediately afterward; policy TBD.

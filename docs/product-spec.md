# 大怪路子 Product Spec

User requirements only. Be concise. Do not infer.

- Friends-only mobile/PC web app on the existing VPS through `cloudflared`; no Vercel.
- Initial 3-deck/6-player ruleset defined by the authoritative [gameplay specification](gameplay-spec.md), with [this external description](https://www.17dp.com/down/gamelist/id/202) retained only as a reference; future 2-deck/4-player ruleset. Rooms select variants.
- Rooms use an owner-managed lobby where authenticated members join, choose seats, ready themselves, and automatically begin once six seated players are ready and connected.
- Persistent username/password accounts; optional email; owner-assisted password reset.
- Detailed hand history.
- Shareable hand seeds.
- MVP has no turn timer or connection-driven pause state. Clients reconnect and resynchronize without changing gameplay state. Add turn timing immediately afterward; policy TBD.

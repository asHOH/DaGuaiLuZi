# 大怪路子 Product Spec

User requirements only. Be concise. Do not infer.

- Friends-only mobile/PC web app on the existing VPS through `cloudflared`; no Vercel.
- Initial 3-deck/6-player ruleset defined by the authoritative [gameplay specification](gameplay-spec.md), with [this external description](https://www.17dp.com/down/gamelist/id/202) retained only as a reference; future 2-deck/4-player ruleset. Rooms select variants.
- Persistent username/password accounts; optional email; owner-assisted password reset.
- Detailed hand history.
- Shareable hand seeds.
- Disconnects pause indefinitely; turns have a time limit, details TBD.

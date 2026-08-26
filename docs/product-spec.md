# 大怪路子 Product Spec

User requirements only. Be concise. Do not infer.

- Friends-only mobile/PC web app on the existing VPS through `cloudflared`; no Vercel.
- Initial 3-deck/6-player ruleset based on [this reference](https://www.17dp.com/down/gamelist/id/202); future 2-deck/4-player ruleset. Rooms select variants, including whether two small jokers beat or tie a mixed joker pair.
- Persistent username/password accounts; optional email; owner-assisted password reset.
- Detailed hand history.
- Shareable hand seeds.
- Disconnects pause indefinitely; turns have a time limit, details TBD.

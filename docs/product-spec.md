# 大怪路子 Product Spec

User requirements only. Be extremely concise. Do not infer.

- Friends-only responsive web app for Windows, macOS, iPhone, and Android on the existing VPS through `cloudflared`; no Vercel.
- MVP supports the six-player, three-deck and four-player, two-deck [Rulesets](ruleset.md). Room Match configurations start from [Rules Configuration Presets](rules-configuration-presets.md).
- Owner-managed Rooms: members join by code/link, choose seats, and ready; the owner selects fixed/random seating and a Match or Challenge Hand, which auto-starts when every seat has a ready, connected member. Browsing and discovery are post-MVP.
- Between Match Hands, wait until every seated player is connected before starting the next Hand; reconnecting resumes automatically.
- In the lobby, members may vacate their own seat to swap seats even when full; vacating cancels their readiness and preserves membership and ownership.
- post-MVP: Rooms can have spectators; membership is limited to the selected Ruleset's player count.
- Public self-registration with username, password, and matching confirmation; passwords may be empty. Sign in immediately and preserve pending Room/Replay/Challenge links. Persistent accounts; VPS-administrator-assisted password reset.
- Shareable completed-Hand history with read-only Hand Replay.
- Completed Hands provide reusable `同牌挑战码` for same-Ruleset Challenge Hands with the same starting setup and independent actions.
- Skip responses after `[BIG]`, `[BIG, BIG]`, any Joker-only Triple except `[SMALL, SMALL, SMALL]`, or any five-joker play.
- Live play supports private, local hand groups, including single cards, off-turn and offline; never recorded in Replay. Beside play/pass, hide `组合` with no selection; disable it when no groups exist and every card is selected. Selections wholly within one group show `解散` and ungroup only those cards; otherwise move selected cards into a new group. Preserve unselected members; dissolve the sole group when no ungrouped cards remain. Clear selection afterward; prune played cards and empty groups; reset on reload or a new Hand.
- post-MVP: [turn timing](post-mvp-turn-timing.md) or connection-driven pause; reconnection only resynchronizes state.

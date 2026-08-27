# ADR 0001: Initial application stack

Status: Accepted
Date: 2026-08-26

## Context

The application is a friends-only, turn-based card game for mobile and desktop browsers. It runs as one application instance on an existing VPS through `cloudflared`. The server must own game state, protect hidden information during active Hands, persist completed-hand history, support single-viewer read-only Hand Replay through shareable seeds, and support persistent username/password accounts with optional email. Exact recovery of an in-progress room after a restart is optional.

The selected stack is TypeScript, React/Vite, Node.js/Fastify, Socket.IO, SQLite, append-only room event streams, a deterministic seeded `game-core`, one serial executor per active room, completed-hand history, and explicit player-specific views. The main [architecture document](../architecture.md) defines how these pieces fit together; this record preserves the alternatives considered and why they were rejected.

## Decision

Use the selected stack for the initial implementation. Revisit a rejected alternative only when a new requirement or measured limitation satisfies the reconsideration condition recorded below.

## Credible alternatives

### Colyseus instead of Socket.IO plus custom room coordination

**Strengths relative to the selected stack**

- First-class authoritative room instances map naturally to one room executor.
- Built-in seat reservation, lifecycle, reconnection, state patches, and per-client `StateView` filtering remove networking boilerplate.
- Its client SDK provides a game-focused protocol rather than assembling rooms over a generic event library.

**Weaknesses relative to the selected stack**

- Command deduplication, persistent hand history, and any best-effort restart recovery remain application responsibilities.
- Its mutable schema state and automatic patch model do not naturally match the pure decision/event-evolution model; an adapter may duplicate state or let framework types leak into `game-core`.
- Hidden information is safe only if every field and client view is configured correctly; explicit player-view messages are easier to audit.
- It adds a framework-specific protocol and client SDK where six-player turn-based traffic is very small.

**Decision:** Socket.IO plus the explicit room executor is selected. Reconsider Colyseus only if measured room lifecycle or reconnection complexity becomes substantial.

### Managed Supabase Postgres/Auth instead of local SQLite/credentials

**Strengths relative to the selected stack**

- Managed PostgreSQL, dashboard, authentication, operational monitoring, and backup features.
- Existing maintainer familiarity reduces learning cost.
- Better path to multiple application instances and richer history queries.

**Weaknesses relative to the selected stack**

- Supabase Auth's normal identities are email/phone-oriented and do not directly match required username/password accounts with nullable email.
- The authoritative game server is still required; Supabase Realtime does not validate rules, serialize commands, or derive private views.
- Every accepted play crosses the VPS-to-Supabase network before acknowledgement, creating an external dependency during play.
- It adds vendor configuration and a second operational boundary for a very small application.

**Decision:** Local SQLite and local credentials are selected. Reconsider Supabase only if managed database operations become a requirement or accounts change to email-based login.

### PostgreSQL instead of SQLite

**Strengths relative to the selected stack**

- Multiple writers and processes, row locking, mature remote administration, replication, and established backup tooling.
- Natural progression to multiple game-server instances.
- More operational headroom for extensive history and analytics.

**Weaknesses relative to the selected stack**

- Adds a database server, credentials, health management, upgrades, and backup operations.
- Its concurrency advantages do not benefit one application instance with short serialized commits.
- History and account queries at the expected size are within SQLite's capabilities.

**Decision:** SQLite is selected. Reconsider PostgreSQL when multiple application instances or an existing maintained PostgreSQL deployment provides concrete value. Keep SQL portable where cheap, but do not create a speculative storage interface before a second adapter exists.

### Svelte/SvelteKit instead of React/Vite

**Strengths relative to the selected stack**

- Less component boilerplate and fine-grained reactivity.
- Small client bundles and a cohesive compiler/framework experience.
- SvelteKit is also built on Vite and self-hosts normally.

**Weaknesses relative to the selected stack**

- Smaller ecosystem for complex card interaction, accessibility patterns, and testing utilities.
- SvelteKit's server features do not remove the authoritative socket server.
- Choosing it changes UI implementation style without improving persistence, reconnection, or rule correctness.

**Decision:** React/Vite is selected for ecosystem risk and testing depth, not runtime performance.

### Phoenix Channels instead of the Node real-time server

**Strengths relative to the selected stack**

- Actor-like processes, supervision, channels, presence, clustering, and fault isolation are excellent fits for multiplayer rooms.
- Strong operational model if the application grows to many concurrent rooms.

**Weaknesses relative to the selected stack**

- Adds Elixir/Erlang and a second type system while the browser and rules fixtures remain TypeScript.
- Loses direct sharing of protocol/rules types and increases build/deployment knowledge.
- Its scale advantages are irrelevant to one friends-only room.

**Decision:** Node.js/Fastify is selected. Phoenix is technically strong but disproportionate to the expected scale.

### Cloudflare Durable Objects instead of VPS room executors

**Strengths relative to the selected stack**

- One object per room gives a built-in single-writer actor and supports long-lived WebSockets with hibernation.
- Global placement and managed failover become attractive for geographically distributed scale.

**Weaknesses relative to the selected stack**

- Moves the game away from the chosen VPS and into Cloudflare-specific runtime, storage, lifecycle, and pricing semantics.
- Splits account/history storage from active room ownership or couples both to Cloudflare.
- Harder local parity and weaker portability.

**Decision:** The VPS room executor is selected. Reconsider Durable Objects only for global scale or persistent VPS availability problems.

## Alternatives disproportionate to current requirements

| Candidate | Concise drawback |
| --- | --- |
| Next.js | SSR/server-component machinery adds complexity; sockets still require a custom or separate server. |
| Vercel/serverless functions | Explicitly excluded and a poor home for long-lived room ownership. |
| Supabase Realtime as game authority | Broadcasts data but cannot own hidden rules, command ordering, or personalized state. |
| Better Auth | Requires email for every user, conflicting with nullable-email accounts. |
| Raw WebSocket | Reimplements rooms, acknowledgements, heartbeat, reconnect, and fallback already supplied by Socket.IO. |
| boardgame.io | Framework assumptions around logs and hidden information are risky for complete post-hand reveal and explicit player-specific views. |
| Nakama | Large platform with matchmaking/social features and a restricted server runtime unnecessary for six friends. |
| Redis | Adds another database and recovery path before multiple server instances exist. |
| Bun/Deno runtime swap | No material user benefit at this load; Node LTS has broader compatibility. |
| Native mobile/desktop apps | Multiple delivery targets without a requirement the responsive web app cannot meet. |
| Canvas/WebGL table | Worse accessibility, responsive layout, text rendering, and browser testing for a small number of cards. |

## References

- [Colyseus Rooms](https://docs.colyseus.io/room)
- [Colyseus StateView](https://docs.colyseus.io/state/view)
- [Supabase architecture](https://supabase.com/docs/guides/getting-started/architecture)
- [Phoenix Channels](https://hexdocs.pm/phoenix/channels.html)
- [Cloudflare Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

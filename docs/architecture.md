# Preferred Architecture

Status: Engineering guidance, not product requirements  
Updated: 2026-08-26

## Decision summary

Use a TypeScript monorepo with a React/Vite PWA, a Node.js/Fastify application, Socket.IO, a deterministic rules module, a per-room serial game executor, a small local credentials module, and SQLite in WAL mode. Run one application instance on the existing VPS behind `cloudflared`.

The defining architecture is not React or SQLite. It is:

1. the server is authoritative and never trusts a client-reported game state;
2. every game-changing command for one room has exactly one logical executor;
3. accepted commands, events, and the resulting snapshot commit before acknowledgement;
4. the rules are versioned and independent of networking, storage, clocks, and UI;
5. each player receives a view derived specifically for that account.

```text
Mobile / desktop React PWA
          |
   HTTPS + Socket.IO
          |
    cloudflared tunnel
          |
 One Fastify application
   |-- credentials and sessions
   |-- room/lobby HTTP endpoints
   |-- one serial executor per active room
   |-- player-specific socket views
   `-- built web assets
          |
 Local SQLite file
   |-- accounts and sessions
   |-- rooms, hands, and participants
   |-- accepted command IDs
   |-- ordered hand events
   `-- current snapshots
```

## Repository shape

```text
apps/
  web/                 React PWA
  server/              Fastify, Socket.IO, auth, room executors
packages/
  game-core/           rules, state transitions, view derivation
  protocol/            shared Zod schemas and protocol versions
  database/            Drizzle schema, transactions, migrations
docs/
  product-spec.md      user requirements only
  architecture.md      engineering decisions and trade-offs
CONTEXT.md              domain vocabulary
```

## Detailed preferred stack

| Area | Choice | Reason |
| --- | --- | --- |
| Language | TypeScript in strict mode | Share card, command, event, ruleset, and view types across browser, server, and tests. Validate all runtime input despite shared types. |
| Workspace | pnpm workspaces | Enough structure for three applications/modules without adding a build orchestrator. |
| Browser | React + Vite | Mature interaction, accessibility, and testing ecosystem for a client-heavy application that does not need SSR. |
| Routing | TanStack Router, introduced when multiple routes exist | Type-safe account, lobby, room, game, and future history routes without adopting a full-stack rendering framework. |
| Client state | React local state plus a small Zustand store | Component state handles card selection; the store holds connection status and the latest authoritative player view. |
| Styling | CSS variables and CSS Modules | Precise responsive card/table geometry without coupling the design to a utility framework. |
| Card rendering | Semantic DOM with SVG/CSS artwork | Accessible, responsive, selectable, and straightforward to test. |
| PWA | Manifest plus a conservative service worker | Installable on phones and PCs. Cache the application shell only; never imply that live play works offline. |
| Runtime | Node.js 24 LTS | Stable production ecosystem and compatibility with the selected server, socket, SQLite, testing, and security libraries. |
| HTTP server | Fastify | Small self-hosted server with validation hooks, Pino logging, and direct access to the underlying HTTP server. |
| Real time | Socket.IO | Provides rooms, acknowledgements, heartbeat/reconnection behavior, ordered packets, and fallback transport. Application-level deduplication and full resynchronization remain mandatory. |
| Validation | Zod | Shared runtime schemas for HTTP, sockets, events, configuration, snapshots, and the client/server compatibility handshake. |
| Password hashing | Argon2id using a maintained implementation | Passwords are salted and adaptively hashed, never encrypted or stored directly. Parameters follow current OWASP guidance and are stored with the hash for later upgrades. |
| Sessions | Opaque random cookie token; only its hash is stored | `HttpOnly`, `Secure`, `SameSite` cookies; revocable server-side sessions; reset operations revoke every existing session for that account. |
| Database | SQLite in WAL mode with `synchronous=FULL` | Matches a single-process, low-write-volume game; gives local ACID commits without operating a database server. `FULL` is required because acknowledged plays must survive OS crashes and power loss, not merely process crashes. |
| SQLite driver | `better-sqlite3` | Stable synchronous transactions suit the single-writer design. Pin a release embedding a fixed SQLite version; do not use SQLite 3.7.0–3.51.2 because of the WAL-reset bug. |
| Database schema | Drizzle ORM plus explicit transactions/SQL | Typed schema and migrations while keeping durability, uniqueness, and transaction behavior visible. |
| Rule tests | Vitest + fast-check | Examples lock down reference/variant behavior; generated cases test card conservation, legal combinations, ordering, and wildcard invariants. |
| Integration tests | Vitest against a real temporary SQLite database | Verify atomic commits, duplicate commands, restart reconstruction, account authorization, and hidden information. |
| Browser tests | Playwright | Multiple browser contexts exercise six seats, private hands, timed turns, disconnect pause, reconnect, and end-of-hand reveal. |
| Deployment | Multi-stage Docker image with a mounted local SQLite volume | One application artifact on the VPS. Existing `cloudflared` may remain host-managed. |
| Logs | Pino JSON logs | Correlate account, room, hand, command, and sequence without logging passwords, session tokens, or private hands. |

Use exact dependency and container versions. Database migrations and backup restore checks are explicit deployment steps.

## Deep modules and seams

### `game-core`

This is the deepest module. Its small interface accepts a versioned ruleset, current state, and command, then returns either a rejection or a transition containing the next state and domain events. It contains deck construction, legal combinations, comparison, turn order, finishing, tribute, scoring, and player-view derivation.

It does not know about sockets, SQL, accounts, wall-clock time, or React. Randomness and time are inputs. A secure shuffle result or entropy source is injected when a hand starts; the resulting deck order is persisted so replay and restart are exact.

### Room executor

One executor owns all game-changing commands for one active room. Its interface is essentially `execute(authenticatedCommand) -> acknowledgedResult`. Internally it:

1. queues commands serially;
2. rejects stale, unauthorized, or illegal commands;
3. invokes `game-core`;
4. atomically persists command deduplication, events, and snapshot;
5. acknowledges only after commit;
6. derives and publishes one view per player.

SQLite unique constraints on command ID and `(handId, sequence)` are a second safety fence. They do not replace the executor. Different rooms may execute rules concurrently, while SQLite serializes their short commit transactions.

### Credentials module

The account interface is intentionally small: create account, authenticate, resolve/revoke session, change password, and owner-reset password. The implementation hides username normalization, Argon2id, session-token hashing, throttling, and persistence.

Accounts require a unique username and password. Email is nullable. If an email is later supplied, an email-reset adapter may be added; until then, the owner resets a password through an administrative command that records an audit event and revokes all sessions.

This local module is preferred over Better Auth because Better Auth requires an email for every user, including users signing up through its username plugin, which conflicts with the product requirement.

## Room-level rules

Every room selects a complete, immutable rules configuration before a hand starts. A hand records both `rulesetId` and the resolved variant values, so a later default change cannot reinterpret history.

Initial identifiers may look like:

- `dglz-6p-3d-v1` — initial six-player, three-deck ruleset;
- `dglz-4p-2d-v1` — future four-player, two-deck ruleset.

The first explicit variant is represented as a named domain choice rather than scattered conditionals, for example:

```ts
type JokerPairComparison =
  | "two-small-jokers-win"
  | "two-small-and-mixed-are-equal";
```

The linked [弈棋耍大牌 rules](https://www.17dp.com/down/gamelist/id/202) seed the initial ruleset. Any disagreement or house rule becomes a named variant with example hands that are also executable tests.

## Turn timing and disconnection

Every turn will have a time limit, but its duration and expiry consequence remain undefined. Do not hard-code either. Store timing state so it can survive a process restart.

For now, any required player's disconnection pauses the game indefinitely. A paused game consumes no turn time. After an application restart all sockets are disconnected, so the room reconstructs from SQLite in a paused state and resumes only when the required players reconnect. The eventual timing policy must define warnings, grace, expiry action, and whether all six players or only the current player must be connected.

Use a monotonic clock for elapsed time while the process is alive and persist enough wall-clock/timer state for restart reconstruction. The clock is injected into the executor for deterministic tests.

## Persistence and end-of-hand reveal

An accepted command transaction stores:

- a globally unique command ID and its original result;
- room, hand, account, and monotonic event sequence;
- versioned private domain events;
- the latest versioned snapshot;
- the exact shuffled/dealt order needed for reconstruction.

The server sends success only after SQLite commits with WAL and `synchronous=FULL`. A retry with the same command ID returns the stored result rather than playing twice.

During a hand, raw events and snapshots remain server-private and each client receives a redacted view. When the hand ends—and before the next deal—the view policy may expose every player's dealt cards to the hand's participants. The complete private event record is already sufficient for the later history feature.

Ruleset implementation version, event version, snapshot version, and protocol version are independent. A reconnect or PWA load performs a compatibility handshake; an incompatible cached client must refresh before acting.

## Why off-VPS replication is optional

Local SQLite durability and disaster recovery solve different failures:

| Failure | WAL + `synchronous=FULL` on the VPS | Off-VPS copy |
| --- | --- | --- |
| Application crash/restart | Protects committed plays | Not needed |
| VPS reboot or OS crash with disk intact | Protects committed plays | Not needed |
| Accidental application deployment | Usually protects data, but not operator deletion | Useful |
| Filesystem/disk failure | Cannot help | Required for recovery |
| VPS account/provider loss | Cannot help | Required for recovery |

Therefore off-VPS replication is not required to build or test the first version. It becomes necessary only if accounts and history must survive loss of the VPS itself.

Litestream is a suitable later disaster-recovery adapter because it continuously copies SQLite WAL changes to object storage. It is asynchronous: it reduces data loss but does not prove that the very latest acknowledged command survived total disk destruction. Zero loss under that failure would require synchronous remote durability before acknowledgement, which is disproportionate for this friends-only app.

Encrypt remote backups when the destination cannot be treated as equally trusted as the VPS. The database contains password hashes, session records, optional email addresses, private dealt cards, and complete history. Encryption at rest may be provided by the storage service or by the backup pipeline; it need not be a separate custom encryption layer. Keep the encryption key outside the backup destination and test restoration.

## Potent alternatives

These could reasonably replace part of the preferred stack if priorities change.

### Colyseus instead of Socket.IO plus custom room coordination

**Strengths relative to the preferred stack**

- First-class authoritative room instances map naturally to one room executor.
- Built-in seat reservation, lifecycle, reconnection, state patches, and per-client `StateView` filtering remove networking boilerplate.
- Its client SDK provides a game-focused protocol rather than assembling rooms over a generic event library.

**Weaknesses relative to the preferred stack**

- Durable commands, events, snapshots, and restart recovery remain application responsibilities.
- Its mutable schema state and automatic patch model do not naturally match the pure transition/event model; an adapter may duplicate state or let framework types leak into `game-core`.
- Hidden information is safe only if every field and client view is configured correctly; explicit player-view messages are easier to audit.
- It adds a framework-specific protocol and client SDK where six-player turn-based traffic is very small.

**Decision:** keep Socket.IO initially. Reconsider Colyseus if custom room lifecycle/reconnection code becomes substantial; evaluate it with a narrow prototype containing six private hands, reconnect, and snapshot restoration.

### Managed Supabase Postgres/Auth instead of local SQLite/credentials

**Strengths relative to the preferred stack**

- Managed PostgreSQL, dashboard, authentication, operational monitoring, and backup features according to the selected plan.
- Existing maintainer familiarity reduces learning cost.
- Better path to multiple application instances and richer history queries.

**Weaknesses relative to the preferred stack**

- Supabase Auth's normal identities are email/phone-oriented and do not directly match required username/password accounts with nullable email.
- The authoritative game server is still required; Supabase Realtime does not validate rules, serialize commands, or derive private views.
- Every accepted play crosses the VPS-to-Supabase network before acknowledgement, creating an external dependency during play.
- More vendor configuration and a second operational boundary for a very small application.

**Decision:** not selected. It becomes preferable if managed database operations matter more than a self-contained VPS or if the account requirement changes to email-based login. If adopted, use Postgres/Auth only and keep gameplay behind the authoritative server; skip Realtime.

### PostgreSQL instead of SQLite

**Strengths relative to the preferred stack**

- Multiple writers/processes, row locking, mature remote administration, replication, and established backup tooling.
- Natural progression to multiple game-server instances.
- More operational headroom for extensive history/analytics.

**Weaknesses relative to the preferred stack**

- Adds a database server, credentials, health management, upgrades, and backup operations.
- Its concurrency advantages do not benefit one application instance with short serialized commits.
- History and account queries at the expected size are well within SQLite's capabilities.

**Decision:** not selected now. Migrate when multiple application instances or an existing maintained PostgreSQL deployment provides concrete value. Keep SQL portable where doing so costs little, but do not create a speculative storage interface until a second adapter exists.

### Svelte/SvelteKit instead of React/Vite

**Strengths relative to the preferred stack**

- Less component boilerplate and fine-grained reactivity.
- Small client bundles and a cohesive compiler/framework experience.
- SvelteKit is also built on Vite and self-hosts normally.

**Weaknesses relative to the preferred stack**

- Smaller ecosystem for complex card interaction, accessibility patterns, and testing utilities.
- SvelteKit's server features do not remove the authoritative socket server.
- Choosing it changes UI implementation style without improving persistence, reconnection, or rule correctness.

**Decision:** React remains preferred for ecosystem risk, not runtime performance. Svelte is equally defensible if the maintainer strongly prefers its model.

### Phoenix Channels instead of the Node real-time server

**Strengths relative to the preferred stack**

- Actor-like processes, supervision, channels, presence, clustering, and fault isolation are excellent fits for multiplayer rooms.
- Strong operational model if the application grows to many concurrent rooms.

**Weaknesses relative to the preferred stack**

- Adds Elixir/Erlang and a second type system while the browser and rules fixtures remain TypeScript.
- Loses direct sharing of protocol/rules types and increases build/deployment knowledge.
- Its scale advantages are irrelevant to one friends-only room.

**Decision:** technically strong but disproportionate unless learning/using Elixir is itself a goal.

### Cloudflare Durable Objects instead of VPS room executors

**Strengths relative to the preferred stack**

- One object per room gives a built-in single-writer actor and supports long-lived WebSockets with hibernation.
- Global placement and managed failover become attractive for geographically distributed scale.

**Weaknesses relative to the preferred stack**

- Moves the core game away from the chosen VPS and into Cloudflare-specific runtime, storage, lifecycle, and pricing semantics.
- Splits account/history storage from active room ownership or couples both to Cloudflare.
- Harder local parity and weaker portability.

**Decision:** not selected because it conflicts with the deployment preference. Revisit only for global scale or VPS availability problems.

## Clearly inferior for current requirements

| Candidate | Concise drawback |
| --- | --- |
| Next.js | SSR/server-component machinery adds complexity; sockets still require a custom or separate server. |
| Vercel/serverless functions | Explicitly excluded and a poor home for long-lived room ownership. |
| Supabase Realtime as game authority | Broadcasts data but cannot own hidden rules, command ordering, or personalized state. |
| Better Auth | Requires email for every user, conflicting with nullable-email accounts. |
| Raw WebSocket | Reimplements rooms, acknowledgements, heartbeat, reconnect, and fallback already supplied by Socket.IO. |
| boardgame.io | Framework assumptions around logs/hidden information are risky for complete post-hand reveal and long-lived versioned history. |
| Nakama | Large platform with matchmaking/social features and a restricted server runtime unnecessary for six friends. |
| Redis | Adds another database and recovery path before multiple server instances exist. |
| Bun/Deno runtime swap | No material user benefit at this load; Node LTS has broader compatibility. |
| Native mobile/desktop apps | Multiple delivery targets without a requirement the PWA cannot meet. |
| Canvas/WebGL table | Worse accessibility, responsive layout, text rendering, and browser testing for a small number of cards. |

## Known costs of the preferred stack

- The local credentials module is security-sensitive and needs focused review, login throttling, Argon2id parameter tests, secure reset tooling, and session-revocation tests.
- Socket.IO is a non-standard higher-level protocol and still needs application durability and resynchronization.
- SQLite constrains deployment to one write host and its database file must remain on a local filesystem, not a network volume.
- A single VPS is an availability limit. Off-VPS disaster recovery does not keep games online during an outage.
- Event, snapshot, protocol, and ruleset compatibility require ongoing version discipline.
- Indefinite pause means abandoned rooms need an eventual owner cleanup/archive policy, even if no gameplay timeout exists yet.

These costs are proportionate to an application with one owner, a small friend group, persistent accounts, hidden information, and later replay.

## Primary references

- [Game rules reference](https://www.17dp.com/down/gamelist/id/202)
- [Cloudflare Tunnel WebSocket support](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/)
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees)
- [Socket.IO connection-state recovery](https://socket.io/docs/v4/connection-state-recovery)
- [SQLite WAL](https://sqlite.org/wal.html)
- [SQLite synchronous settings](https://sqlite.org/pragma.html#pragma_synchronous)
- [SQLite WAL-reset bug](https://sqlite.org/wal.html#walreset)
- [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)
- [Litestream architecture](https://litestream.io/how-it-works/)
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Better Auth username signup](https://better-auth.com/docs/plugins/username)
- [Colyseus Rooms](https://docs.colyseus.io/room)
- [Colyseus StateView](https://docs.colyseus.io/state/view)
- [Supabase architecture](https://supabase.com/docs/guides/getting-started/architecture)
- [Phoenix Channels](https://hexdocs.pm/phoenix/channels.html)
- [Cloudflare Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)


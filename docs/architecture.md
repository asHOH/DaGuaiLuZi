# Preferred Architecture

Status: Initial stack selected; engineering guidance, not product requirements
Updated: 2026-08-27

## Decision summary

Use a TypeScript monorepo with a responsive React/Vite web application, a Node.js/Fastify application, Socket.IO, a deterministic rules module, a per-room serial game executor, a small local credentials module, and SQLite in WAL mode. Run one application instance on the existing VPS behind `cloudflared`.

The defining architecture is not React or SQLite. It is:

1. the server is authoritative and never trusts a client-reported game state;
2. after a room is created, every room-scoped mutation has exactly one logical executor;
3. the accepted command's deduplication record and resulting domain events commit before acknowledgement;
4. the rules are versioned and independent of networking, storage, clocks, and UI;
5. each player receives a view derived specifically for that account.

```text
Mobile / desktop React web app
          |
   HTTPS + Socket.IO
          |
    cloudflared tunnel
          |
 One Fastify application
   |-- credentials and sessions
   |-- room creation and read-only room/lobby HTTP endpoints
   |-- one serial executor per active room
   |-- player-specific socket views
   `-- built web assets
          |
 Local SQLite file
   |-- accounts and sessions
   |-- append-only room event streams
   |-- accepted command IDs and results
   `-- hand seeds and shuffle versions inside events
```

## Initial repository shape

```text
apps/
  web/                 Responsive React web app
  server/              Fastify, Socket.IO, auth, database, room executors
packages/
  game-rules/          shared pure combination and play-legality rules
  game-core/           authoritative decisions, event evolution, and views
  protocol/            shared serialized commands, results, and player views
docs/
  product-spec.md      user requirements only
  architecture.md      engineering decisions and trade-offs
  decisions/           accepted architecture decision records
CONTEXT.md              domain vocabulary
```

`game-rules` is deliberately shared by the web and server applications so both evaluate a proposed play with the same pure rules. `game-core` remains server-only and authoritative. `protocol` is the real serialization seam shared by both applications; it contains only commands, acknowledged results, and player-view schemas, not full private game state. Database code initially belongs to the server. Package placement is an implementation choice, not a permanent architectural seam.

## Preferred stack

| Area | Choice | Reason |
| --- | --- | --- |
| Language | TypeScript in strict mode | Use one language across browser, server, and tests while sharing only `game-rules` and serialized protocol types with the browser. Validate all runtime input despite shared types. |
| Workspace | pnpm workspaces | Enough structure for the web app, server, and `game-core` without adding a build orchestrator. |
| Browser | React + Vite | Mature interaction, accessibility, and testing ecosystem for a client-heavy application that does not need SSR. |
| Routing | Start without a routing dependency; TanStack Router is the initial default when multiple routes justify it | Type-safe account, lobby, room, game, and future history routes without adopting a full-stack rendering framework. This is an implementation choice rather than an architectural constraint. |
| Client state | React local state and context initially; add a small Zustand store only if shared state becomes awkward | Component state handles card selection; shared state is limited to connection status and the latest authoritative player view. |
| Styling | CSS variables and CSS Modules | Precise responsive card/table geometry without coupling the design to a utility framework. |
| Card rendering | Semantic DOM with SVG/CSS artwork | Accessible, responsive, selectable, and straightforward to test. |
| Web delivery | Responsive web app, manifest, and content-hashed assets; no service worker initially | Mobile and desktop browsers are required, but installation and offline behavior are not. Avoiding a service worker also avoids unnecessary stale-client behavior. |
| Runtime | Node.js 24 LTS | Stable production ecosystem and compatibility with the selected server, socket, SQLite, testing, and security libraries. |
| HTTP server | Fastify | Small self-hosted server with validation hooks, Pino logging, and direct access to the underlying HTTP server. |
| Real time | Socket.IO | Provides rooms, acknowledgements, heartbeat/reconnection behavior, ordered packets, and fallback transport. Application-level deduplication and full resynchronization remain mandatory. |
| Validation | Zod | Validate untrusted HTTP/socket input, configuration, compatibility messages, and persisted formats when decoded. Trusted in-process domain values remain ordinary TypeScript types unless they cross a serialization boundary. |
| Password hashing | Argon2id using a maintained implementation | Passwords are salted and adaptively hashed, never encrypted or stored directly. Parameters follow current OWASP guidance and are stored with the hash for later upgrades. |
| Sessions | Opaque random cookie token; only its hash is stored | `HttpOnly`, `Secure`, `SameSite` cookies; revocable server-side sessions; reset operations revoke every existing session for that account. |
| Database | SQLite in WAL mode with `synchronous=FULL` | Matches a single-process, low-write-volume game; gives local ACID commits without operating a database server. `FULL` intentionally interprets acknowledged plays surviving VPS restarts broadly enough to include OS crashes and power disruption. The tiny write volume makes the additional sync cost acceptable. |
| SQLite driver | `better-sqlite3` | Stable synchronous transactions suit the single-writer design. Pin a release embedding a fixed SQLite version; do not use SQLite 3.7.0–3.51.2 because of the WAL-reset bug. |
| Database schema | Drizzle for schema, migrations, and routine queries | Use raw SQL only for SQLite pragmas or operations that Drizzle cannot express clearly; keep durability, uniqueness, and transaction behavior visible. |
| Rule tests | Vitest + fast-check | Examples lock down reference/variant behavior; generated cases test card conservation, legal combinations, ordering, wildcard invariants, and equivalence between live event evolution and full replay. |
| Integration tests | Vitest against a real temporary SQLite database | Verify atomic event appends, duplicate commands, ordered replay and restart reconstruction, sequence conflicts, account authorization, and hidden information. |
| Browser tests | Playwright | Exercise UI behavior, private views, reconnect, and end-of-hand reveal with one or two browser contexts. Test six-seat coordination primarily with protocol-level integration clients; retain at most one six-browser happy-path smoke test. Add timed-turn tests only after the timing policy is defined. |
| Deployment | Multi-stage Docker image with a mounted local SQLite volume | One application artifact on the VPS, routed through the existing host-managed `cloudflared`. |
| Logs | Pino JSON logs | Correlate account, room, hand, command, and room-event sequence without logging passwords, session tokens, seeds, or private hands. |

Use exact dependency and container versions. Database migrations and backup restore checks are explicit deployment steps.

## Stack closure

The user-approved architectural stack is decided: TypeScript, React/Vite, Node.js/Fastify, Socket.IO, SQLite, one VPS application instance, an authoritative server, serialized room commands, append-only room event streams, deterministic rules, and player-specific views. [ADR 0001](decisions/0001-initial-application-stack.md) retains the rejected trade-offs; coding agents should not reopen these choices without a new requirement or a measured limitation.

TanStack Router, Zustand, CSS organization, ORM details, and exact package placement are implementation defaults rather than immutable architecture. Introduce them when their concrete benefit appears, and change them without reopening the approved stack. Other implementation details include exact locked dependency versions, the maintained Argon2id package, and the card artwork source.

## Deep modules and seams

### `game-rules`

This shared pure module classifies card combinations, compares them, and evaluates a proposed play using only the immutable rules configuration and information present in that player's view. The browser uses it for immediate feedback, and `game-core` uses the same implementation during authoritative command handling. A client verdict is advisory: the server still checks authentication, command revision, turn ownership, card ownership, and legality against the full current state.

### `game-core`

This is the deepest module. Its decision interface is `decide(currentState, command) -> rejection | domainEvents`; its evolution interface is `evolve(state, event) -> state`. `decide` may consult `game-rules` and reject a command. `evolve` is total and decision-free for every supported event and valid prior state: it applies the accepted fact without checking legality, reading clocks or randomness, consulting external state, or rejecting. Folding `evolve` over a room's ordered events reconstructs its current state. A selected rules configuration becomes state through an event before a hand starts, so callers never supply a second ruleset value that could disagree with an active hand. The module uses `game-rules` and contains deck construction, authoritative decisions and evolution, turn order, finishing, tribute, scoring, and player-view derivation.

It does not know about sockets, SQL, accounts, wall-clock time, or React. Randomness and time are inputs. Trusted server code generates a fresh cryptographically random seed for each hand and passes it to `game-core`, which uses a versioned deterministic shuffle. No match-level seed derives future hand seeds. Hand-start events record the hand seed and shuffle-algorithm version; `game-core` derives the original deal, and later events record every card-zone change so replay, restart recovery, and the required end-of-hand reveal are exact.

### `protocol`

This shared module defines and validates serialized browser/server messages. It contains commands, acknowledged results, compatibility information, and player-specific views. It does not expose the authoritative state or make gameplay decisions.

### Room executor

Once a room exists, one executor owns every durable mutation of that room: membership and seats, readiness, rules selection, starting and dealing, gameplay, and room archival. It also owns ephemeral socket presence and the connection-driven pause or resume gate. Account operations, initial room creation, and read-only queries remain outside this seam. Its interface is essentially `execute(authenticatedCommand) -> acknowledgedResult`. Internally it:

1. queues commands serially;
2. rejects stale or unauthorized commands;
3. invokes `game-core`, which rejects an illegal command or decides the resulting events;
4. folds the proposed events into a candidate next state without mutating the current state;
5. atomically appends those events and persists command deduplication;
6. installs the already-derived candidate state after commit;
7. acknowledges only after commit;
8. derives and publishes one view per player.

A single process-wide executor registry is the only entry point for existing-room mutations. Its `getOrCreate(roomId)` operation makes concurrent lookup or event-stream reconstruction share the same executor rather than constructing competing owners; HTTP and socket handlers do not write existing-room state directly. SQLite uniqueness on command ID and `(roomId, sequence)` is a second safety fence. Commands use the last event sequence as their expected room revision. These constraints do not replace the executor. Room queues operate independently, but ordinary synchronous rule evaluation, replay, and SQLite commits still run on the single Node.js thread; this design does not imply worker-thread CPU parallelism.

### Credentials module

The account interface is intentionally small: owner-provision account, authenticate, resolve/revoke session, change password, and owner-reset password. The implementation hides username normalization, Argon2id, session-token hashing, throttling, and persistence. The initial application has no public registration endpoint.

Accounts require a unique username and password. Email is nullable. The owner provisions accounts and resets passwords through administrative commands; a reset records an audit action and revokes all sessions. These commands may initially be CLI-only. If email later becomes meaningful, an email-reset adapter may be added.

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

Every turn will have a time limit, but its duration and expiry consequence remain undefined. Do not hard-code either or design wall-clock restart behavior before the product policy is decided.

For now, any required player's disconnection pauses the game indefinitely. Socket presence and the resulting pause gate are ephemeral executor state, not domain events. A paused game consumes no turn time. After an application restart all sockets are disconnected, so the room reconstructs its durable state from SQLite with a fresh paused gate and resumes only when the required players reconnect. The eventual timing policy must define warnings, grace, expiry action, and whether all six players or only the current player must be connected.

Do not persist timer state until the timing policy is defined. For now, reconstruct the room in a paused state after an application restart. Once duration, warnings, grace, expiry behavior, and disconnection semantics are decided, use an injected monotonic clock for elapsed time while the process is alive and for deterministic tests. Add persisted remaining time or wall-clock reconstruction only if that policy requires it.

## Event streams, recovery, and end-of-hand reveal

An append-only ordered event stream is the sole persisted authority for each room's durable state. Accounts, sessions, and other non-room administrative data remain ordinary relational records. The initial implementation uses a SQLite table as the event store and does not introduce a message queue, a separate CQRS read store, or a specialized event-store product.

Each event envelope records the room ID, monotonic room sequence, optional hand ID, event type and schema version, causation command ID, server-recorded time, and domain payload. Sequence, not timestamp, defines order. Domain events record accepted facts such as room creation, seating, rules selection, dealing, playing, passing, hand completion, and room archival; commands and rejected attempts are not domain events.

Starting a hand records the ruleset ID and resolved variants, fresh per-hand seed, and shuffle-algorithm version in the resulting events. `game-core` deterministically derives the immutable original deal from those fields, so the deal is not stored as a second representation that could disagree with the seed. Later play events contain enough information to reconstruct every active card zone exactly. Folding the complete ordered stream through `game-core.evolve` reconstructs the room after a process restart; because all sockets are then disconnected, the reconstructed room starts paused.

An accepted command transaction atomically stores:

- a globally unique command ID, originating account, request fingerprint, and original acknowledged result;
- one or more domain events with the next contiguous room sequence numbers.

The server sends success only after SQLite commits with WAL and `synchronous=FULL`. A retry with the same command ID, account, and request fingerprint returns the stored result rather than applying the command twice; mismatched reuse of an ID is rejected.

Persisted snapshots are omitted initially. If measured replay time later becomes material, a snapshot may be added only as a disposable cache identified by the last included room sequence. Deleting every snapshot and replaying the authoritative event stream must always reconstruct the same state.

Raw events, seeds, reconstructed state, and original deals remain server-private during a hand; each client receives only its player-specific view. When the hand ends—and before the next deal—the view policy must expose every player's originally dealt cards to that hand's participants. Revealing the seed after the hand is optional unless verifiable dealing becomes a product requirement.

The event stream preserves action history from the first release. A later history feature formats or projects these existing events for authorized participants rather than creating a second action-history model. No asynchronous projection infrastructure is required initially.

Every stored event version must remain decodable and replayable. Database migrations manage SQLite structure; they do not reinterpret gameplay. Replay applies accepted events without rerunning historical command authorization or legality under current code. Prefer additive event evolution; add an explicit decoder or upcaster only when a concrete schema change requires one. Ruleset identifiers and client/server protocol compatibility remain separate concerns. Content-hashed assets handle normal deployments; if a client and server protocol are incompatible, the server rejects commands with a reload-required response.

Off-VPS backups are not required for the initial release. Reconsider them only if recovery after total VPS loss becomes a product requirement.

## Decision history

The comparison of rejected stacks and frameworks is retained separately in [ADR 0001: Initial application stack](decisions/0001-initial-application-stack.md). This document describes the selected architecture; the ADR preserves why credible alternatives were not selected and the conditions that would justify revisiting them.

## Known costs of the preferred stack

- The local credentials module is security-sensitive and needs focused review, login throttling, Argon2id parameter tests, secure reset tooling, and session-revocation tests.
- Socket.IO is a non-standard higher-level protocol and still needs application durability and resynchronization.
- SQLite constrains deployment to one write host and its database file must remain on a local filesystem, not a network volume.
- Persisted event and command formats, the client/server protocol, and rulesets require deliberate compatibility changes. Old event versions must remain replayable, but no generic migration framework is built before a concrete change requires one.
- Indefinite pause means abandoned rooms need an eventual owner cleanup/archive policy, even if no gameplay timeout exists yet.

These costs are proportionate to an application with one owner, a small friend group, persistent accounts, hidden information, and later detailed history.

## Primary references

- [Game rules reference](https://www.17dp.com/down/gamelist/id/202)
- [Cloudflare Tunnel WebSocket support](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/)
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees)
- [Socket.IO connection-state recovery](https://socket.io/docs/v4/connection-state-recovery)
- [Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
- [SQLite WAL](https://sqlite.org/wal.html)
- [SQLite synchronous settings](https://sqlite.org/pragma.html#pragma_synchronous)
- [SQLite WAL-reset bug](https://sqlite.org/wal.html#walreset)
- [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Better Auth username signup](https://better-auth.com/docs/plugins/username)

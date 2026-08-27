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
   |-- room creation and read-only room/lobby/history HTTP endpoints
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
  protocol/            shared serialized commands, results, views, and history
docs/
  product-spec.md      user requirements only
  gameplay-spec.md     authoritative gameplay rules and variants
  architecture.md      engineering decisions and trade-offs
  decisions/           accepted architecture decision records
CONTEXT.md              domain vocabulary
```

`game-rules` is deliberately shared by the web and server applications so both evaluate a proposed play with the same pure rules. `game-core` remains server-only and authoritative. `protocol` is the real serialization seam shared by both applications; it contains only commands, acknowledged results, player views, completed-hand history, and seed-share schemas, not full private live game state. Database code initially belongs to the server. Package placement is an implementation choice, not a permanent architectural seam.

## Preferred stack

| Area | Choice | Reason |
| --- | --- | --- |
| Language | TypeScript in strict mode | Use one language across browser, server, and tests while sharing only `game-rules` and serialized protocol types with the browser. Validate all runtime input despite shared types. |
| Workspace | pnpm workspaces | Enough structure for the web app, server, and `game-core` without adding a build orchestrator. |
| Browser | React + Vite | Mature interaction, accessibility, and testing ecosystem for a client-heavy application that does not need SSR. |
| Routing | Start without a routing dependency; TanStack Router is the initial default when multiple routes justify it | Type-safe account, lobby, room, game, and history routes without adopting a full-stack rendering framework. This is an implementation choice rather than an architectural constraint. |
| Client state | React local state and context initially; add a small Zustand store only if shared state becomes awkward | Component state handles card selection; shared state is limited to connection status and the latest authoritative player view. |
| Styling | CSS variables and CSS Modules | Precise responsive card/table geometry without coupling the design to a utility framework. |
| Card rendering | Semantic DOM with SVG/CSS artwork | Accessible, responsive, selectable, and straightforward to test. |
| Web delivery | Responsive web app, manifest, and content-hashed assets; no service worker initially | Mobile and desktop browsers are required, but installation and offline behavior are not. Avoiding a service worker also avoids unnecessary stale-client behavior. |
| Runtime | Node.js 24 LTS | Stable production ecosystem and compatibility with the selected server, socket, SQLite, testing, and security libraries. |
| HTTP server | Fastify | Small self-hosted server with validation hooks, Pino logging, and direct access to the underlying HTTP server. |
| Real time | Socket.IO | Provides rooms, acknowledgements, heartbeat/reconnection behavior, ordered packets, and fallback transport. Application-level deduplication and revisioned full-view resynchronization remain mandatory. |
| Validation | Zod | Validate untrusted HTTP/socket input, configuration, compatibility messages, and persisted formats when decoded. Trusted in-process domain values remain ordinary TypeScript types unless they cross a serialization boundary. |
| Password hashing | Argon2id using a maintained implementation | Passwords are salted and adaptively hashed, never encrypted or stored directly. Parameters follow current OWASP guidance and are stored with the hash for later upgrades. |
| Sessions | Opaque random cookie token; only its hash is stored | `HttpOnly`, `Secure`, `SameSite` cookies; revocable server-side sessions; reset operations revoke every existing session for that account. |
| Database | SQLite in WAL mode with `synchronous=NORMAL` | Matches a single-process, low-write-volume game and preserves committed data across application crashes without operating a database server. Recovery after OS crashes, power loss, or total VPS loss is not guaranteed. |
| SQLite driver | `better-sqlite3` | Stable synchronous transactions suit the single-writer design. Pin a release embedding a fixed SQLite version; do not use SQLite 3.7.0–3.51.2 because of the WAL-reset bug. |
| Database schema | Drizzle for schema, migrations, and routine queries | Use raw SQL only for SQLite pragmas or operations that Drizzle cannot express clearly; keep durability, uniqueness, and transaction behavior visible. |
| Rule tests | Vitest + fast-check | Examples lock down reference/variant behavior; generated cases test card conservation, legal combinations, ordering, wildcard invariants, and identical deals from identical seed metadata. |
| Integration tests | Vitest against a real temporary SQLite database | Verify atomic event appends, duplicate commands, supported-version replay, sequence conflicts, history authorization, seed reproduction, and hidden information. |
| Browser tests | Playwright | Exercise UI behavior, private views, reconnect/resynchronization, completed-hand history, seed sharing, and replay-room warnings with one or two browser contexts. Test six-seat coordination primarily with protocol-level integration clients; retain at most one six-browser happy-path smoke test. Add timed-turn tests only after the timing policy is defined. |
| Deployment | Multi-stage Docker image with a mounted local SQLite volume | One application artifact on the VPS, routed through the existing host-managed `cloudflared`. |
| Logs | Pino JSON logs | Correlate account, room, hand, command, and room-event sequence without logging passwords, session tokens, seeds, or private hands. |

Use exact dependency and container versions. Database migrations are explicit deployment steps.

## Stack closure

The user-approved architectural stack is decided: TypeScript, React/Vite, Node.js/Fastify, Socket.IO, SQLite, one VPS application instance, an authoritative server, serialized room commands, append-only room event streams, deterministic seeded rules, first-release hand history, and player-specific views. [ADR 0001](decisions/0001-initial-application-stack.md) retains the rejected trade-offs; coding agents should not reopen these choices without a new requirement or a measured limitation.

TanStack Router, Zustand, CSS organization, ORM details, and exact package placement are implementation defaults rather than immutable architecture. Introduce them when their concrete benefit appears, and change them without reopening the approved stack. Other implementation details include exact locked dependency versions, the maintained Argon2id package, and the card artwork source.

## Deep modules and seams

### `game-rules`

This shared pure module classifies card combinations, compares them, and evaluates a proposed play using only the immutable Rules Configuration and information present in that player's view. The browser uses it for immediate feedback, and `game-core` uses the same implementation during authoritative command handling. A client verdict is advisory: the server still checks authentication, command revision, turn ownership, card ownership, and legality against the full current state.

### Card identity and serialization

A Card Face has one canonical string code, such as `AS`, `SMALL`, or `BIG`; a Card Instance appends its one-based copy number, such as `AS#2`. Protocol messages, persisted events, commands, fixtures, and logs use these strings and do not accept an alternative object-shaped serialization. At a boundary, the application validates and decodes each string once into an internal card value object; rules operate on that object rather than parsing identifiers.

### `game-core`

This is the deepest module. Its decision interface is `decide(currentState, command) -> rejection | domainEvents`; its evolution interface is `evolve(state, event) -> state`. `decide` may consult `game-rules` and reject a command. `evolve` is total and decision-free for every supported event and valid prior state: it applies the accepted fact without checking legality, reading clocks or randomness, consulting external state, or rejecting. Folding `evolve` over a room's supported ordered events reconstructs its current state. A selected Rules Configuration becomes state through an event before a hand starts, so callers never supply a second configuration that could disagree with an active hand. The module uses `game-rules` and contains deck construction, authoritative decisions and evolution, turn order, finishing, tribute, scoring, and player-view derivation.

It does not know about sockets, SQL, accounts, wall-clock time, or React. Randomness and time are inputs. A normal hand receives a fresh cryptographically random seed; a social replay receives the seed and metadata decoded from a share code. For the first Hand of a Match, `game-core` derives the initial dealer uniformly from that Hand's seed through a versioned, domain-separated selection function. Random selections required by resolved Rule Variants use the same approach and remain domain-separated from both dealer selection and shuffling. `game-core` uses a versioned deterministic shuffle, so the same seed, ruleset, resolved variants, shuffle version, and seat ordering produce the same original deal. No match-level seed derives future hand seeds. Hand-start events record these inputs, and later events record every card-zone change needed for live evolution and completed-hand history.

### `protocol`

This shared module defines and validates serialized browser/server messages. It contains commands, acknowledged results, compatibility information, player-specific views, completed-hand history, and seed-share codes. It does not expose the authoritative live state or make gameplay decisions.

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

### Client resynchronization

Every player view includes its room revision. On initial connection, after unsuccessful Socket.IO connection recovery, or whenever the client detects a revision gap, the server sends a complete view derived for that account. The client atomically replaces its room state with that view and does not submit room commands until synchronization finishes. Command acknowledgements include the committed revision. Transient packets may accelerate reconnection, but correctness never depends on replaying every socket packet.

### Credentials module

The account interface is intentionally small: owner-provision account, authenticate, resolve/revoke session, change password, and owner-reset password. The implementation hides username normalization, Argon2id, session-token hashing, throttling, and persistence. The initial application has no public registration endpoint.

Accounts require a unique username and password. Email is nullable. The owner provisions accounts and resets passwords through administrative commands; a reset records an audit action and revokes all sessions. These commands may initially be CLI-only. If email later becomes meaningful, an email-reset adapter may be added.

This local module is preferred over Better Auth because Better Auth requires an email for every user, including users signing up through its username plugin, which conflicts with the product requirement.

## Room-level rules

Every room selects a complete, immutable Rules Configuration before a hand starts. A hand records both `rulesetId` and the resolved variant values, so a later default change cannot reinterpret history.

Initial identifiers may look like:

- `dglz-6p-3d-v1` — initial six-player, three-deck ruleset;
- `dglz-4p-2d-v1` — future four-player, two-deck ruleset.

The first explicit variant is represented as a named domain choice rather than scattered conditionals, for example:

```ts
type JokerPairComparison =
  | "two-small-jokers-win"
  | "two-small-and-mixed-are-equal";
```

The authoritative [gameplay specification](gameplay-spec.md) defines the Initial Ruleset. The linked [弈棋耍大牌 description](https://www.17dp.com/down/gamelist/id/202) is non-authoritative reference material. Each configured difference is a named variant with example hands that are also executable tests.

## Turn timing and disconnection

Turn timing is application policy rather than gameplay behavior and is intentionally excluded from the gameplay specification.

Every turn will have a time limit, but its duration and expiry consequence remain undefined. Do not hard-code either or design wall-clock restart behavior before the product policy is decided.

For now, any required player's disconnection pauses the game indefinitely. Socket presence and the resulting pause gate are ephemeral executor state, not domain events. A paused game consumes no turn time. After an application restart all sockets are disconnected. The server may reconstruct a compatible in-progress room from SQLite with a fresh paused gate, but exact recovery is best-effort; an unrecoverable room may instead be marked interrupted and restarted. The eventual timing policy must define warnings, grace, expiry action, and whether all six players or only the current player must be connected.

Do not persist timer state until the timing policy is defined. A recovered room starts paused. Once duration, warnings, grace, expiry behavior, and disconnection semantics are decided, use an injected monotonic clock for elapsed time while the process is alive and for deterministic tests. Add persisted remaining time or wall-clock reconstruction only if that policy requires it.

## Event streams, history, seed sharing, and optional recovery

An append-only ordered event stream records every accepted room action and drives the active executor's in-memory state. The same stream supplies completed-hand history and may reconstruct a compatible in-progress room after a restart. Accounts, sessions, and other non-room administrative data remain ordinary relational records. The initial implementation uses a SQLite table and does not introduce a message queue, a separate CQRS read store, or a specialized event-store product.

Each event envelope records the room ID, monotonic room sequence, optional hand ID, event type and schema version, causation command ID, server-recorded time, and domain payload. Sequence, not timestamp, defines order. Domain events record accepted facts such as room creation, seating, rules selection, dealing, playing, passing, hand completion, and room archival; commands and rejected attempts are not domain events.

Starting a hand records the ruleset ID, resolved variants, seed, shuffle-algorithm version, and seat ordering. `game-core` deterministically derives the immutable original deal from those fields, so the event stream and share code use one canonical representation of the deal. Later play events contain enough information to evolve the live state and render the hand's action history.

For a normal hand, the seed and original deals remain server-private until the hand ends. The completed-hand history then exposes the original deals and a share code containing the seed and all metadata needed to reproduce the deal by seat. A room created from a share code is visibly marked as a social replay. Because anyone who knows the code can derive every hidden card, a replay room does not claim hidden-information fairness.

An accepted command transaction atomically stores:

- a globally unique command ID, originating account, request fingerprint, and original acknowledged result;
- one or more domain events with the next contiguous room sequence numbers.

The server sends success only after SQLite commits with WAL and `synchronous=NORMAL`. A retry with the same command ID, account, and request fingerprint returns the stored result rather than applying the command twice; mismatched reuse of an ID is rejected. This protects history from duplicate actions and survives ordinary application crashes, but it is not a power-loss guarantee.

Persisted snapshots are omitted initially. Add them only if measured recovery time becomes material.

Raw events, reconstructed state, seeds, and original deals remain server-private during a normal hand; each client receives only its player-specific view. When the hand ends—and before the next deal—the history view exposes every player's originally dealt cards and the share code to that hand's participants.

History ships in the first release. An authenticated read-only endpoint formats a completed hand's events into its ordered action sequence, selected rules, original deals, result, and share code. Only participants in that hand may read it. Formatting is synchronous and requires no asynchronous projection infrastructure or second action-history model.

Completed-hand events must remain decodable for history, but they do not have to remain replayable into the current live game engine. Best-effort room recovery only replays event versions supported by the deployed server; an incompatible in-progress room may be marked interrupted. Database migrations manage SQLite structure and do not reinterpret gameplay. Add a history decoder only when a concrete event-schema change requires one. Ruleset identifiers, share-code shuffle versions, event schemas, and client/server protocol compatibility remain separate concerns. If a client and server protocol are incompatible, the server rejects commands with a reload-required response.

Off-VPS backups are not required for the initial release. Reconsider them only if recovery after total VPS loss becomes a product requirement.

## Decision history

The comparison of rejected stacks and frameworks is retained separately in [ADR 0001: Initial application stack](decisions/0001-initial-application-stack.md). This document describes the selected architecture; the ADR preserves why credible alternatives were not selected and the conditions that would justify revisiting them.

## Known costs of the preferred stack

- The local credentials module is security-sensitive and needs focused review, login throttling, Argon2id parameter tests, secure reset tooling, and session-revocation tests.
- Socket.IO is a non-standard higher-level protocol and still needs application-level command idempotency and view resynchronization.
- SQLite constrains deployment to one write host and its database file must remain on a local filesystem, not a network volume.
- Persisted events must remain readable for completed-hand history. Live replay compatibility is required only for event versions the deployed server promises to recover; no generic migration framework is built before a concrete change requires one.
- A shared seed makes every hand reproducible, but anyone who knows it can derive hidden cards. Share codes appear only after normal hands and replay rooms are clearly identified as social rather than cheat-resistant.
- Indefinite pause means abandoned rooms need an eventual owner cleanup/archive policy, even if no gameplay timeout exists yet.

These costs are proportionate to an application with one owner, a small friend group, persistent accounts, hidden information in normal hands, first-release detailed history, and social seed sharing.

## Primary references

- [Non-authoritative original game description](https://www.17dp.com/down/gamelist/id/202)
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

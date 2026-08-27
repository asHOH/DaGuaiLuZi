# Post-MVP Turn Timing

Status: Deferred until the MVP is complete

Turn timing is application policy, not part of the Ruleset. The MVP has no timer or connection-driven pause state; its clients reconnect and receive complete player-specific views as defined in [architecture.md](architecture.md#mvp-reconnection).

Before implementation, decide:

- turn duration, warnings, and grace;
- expiry action;
- whether disconnection affects only the current player's timer;
- behavior across browser and application restarts;
- abandoned-room cleanup.

After the policy is fixed, use an injected monotonic clock for live elapsed time and deterministic tests. Persist remaining time or reconstruct it from wall-clock time only if the policy requires it. A timeout that changes gameplay must enter through the room executor and produce ordinary domain events. Socket presence remains ephemeral.

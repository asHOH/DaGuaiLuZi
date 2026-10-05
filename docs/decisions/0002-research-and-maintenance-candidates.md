# ADR 0002: Research and maintenance candidates

Status: Accepted direction; dependency selections deferred.
Date: 2026-10-06

## Decision

Prioritize reproducible research-scale training for DaGuaiLuZi; stronger playable bots are secondary and a second game is out of scope. HTTP and hosting changes remain eligible for demonstrated maintenance savings. Follow the [roadmap](../open-source-roadmap.md) one bounded experiment at a time; this record selects no dependency or engine rewrite and does not supersede [ADR 0001](0001-initial-application-stack.md).

The following is a documentation/package-metadata assessment, not a DaGuaiLuZi benchmark. Target hardware and willingness to maintain a separate research implementation remain unresolved. Interfaces, simulators, and trainers are separate choices; listed integrations are not all required.

## Research interfaces

| Candidate | Strength | Cost / limitation | Position |
| --- | --- | --- | --- |
| [PettingZoo AEC](https://pettingzoo.farama.org/api/aec/) | Sequential decisions, individual observations, action masks, trainer interoperability. | Does not accelerate simulation; a TypeScript bridge adds overhead. | First public interface candidate; retain a native batched path if needed. |
| [OpenSpiel](https://openspiel.readthedocs.io/en/stable/api_reference.html) | Information states, chance, legal actions, cloning, search/game-theory tooling. | Larger API and Python/C++ integration; algorithms have game-specific assumptions. | Add for a concrete search/game-theory consumer. |
| [RLCard](https://github.com/datamllab/rlcard) | Card-specific encodings, trajectories, and baseline examples. | Narrower interoperability; our rules/action representation still need implementation. | Design reference; adapter only for an identified consumer. |

Exclude a custom-only public API: it transfers integration work to researchers.

## Simulation backends

| Candidate | Strength | Cost / limitation | Position |
| --- | --- | --- | --- |
| Existing TypeScript engine | Exact app rules; no port; reusable fixtures and recorded actions. | Training throughput and bridge cost are unmeasured. | Correctness and performance baseline. |
| [Pgx-style JAX](https://github.com/sotetsuk/pgx) | Functional, accelerator-batched transitions; current-player interface. | Rules port; static shapes, branching, and legal-action generation may limit gains. | First accelerator prototype candidate. |
| [JaxMARL](https://github.com/bold-lab-ai/JaxMARL) | JAX environments plus MARL baselines; Hanabi reference. | Rules port; parallel interface uses inactive-player dummy actions. | Prefer when MARL integration outweighs interface adaptation. |
| [OpenSpiel C++](https://github.com/google-deepmind/open_spiel) | Native CPU simulation and search; Python access. | Port/build maintenance and learner transfer overhead. | CPU alternative for irregular action generation or search. |
| [PufferLib 5](https://puffer.ai/docs.html) | Integrated native C/CUDA simulation and training. | Specialized port/toolchain; current native path has CPU evaluation but no CPU training. | Consider only for measured end-to-end gains; older wrapper claims do not describe v5. |

Exclude [boardgame-go](https://github.com/tjcran/boardgame-go), [Boardzilla](https://github.com/boardzilla/boardzilla-core), and [boardgame.io](https://github.com/boardgameio/boardgame.io) as replacements: game-authoring/multiplayer features do not justify adapting the engine for training. Boardzilla core also uses AGPL-3.0.

## Training and evaluation

| Candidate | Strength | Cost / limitation | Position |
| --- | --- | --- | --- |
| [JaxMARL baselines](https://github.com/bold-lab-ai/JaxMARL) | Inspectable JAX IPPO/MAPPO/value-decomposition implementations. | Opponent selection, opposing teams, masking, and evaluation require adaptation. | First JAX training baseline candidate. |
| [Mava](https://github.com/instadeepai/Mava) | Distributed/recurrent MARL; accelerator-native and CPU-environment architectures. | Research codebase to modify; architecture support differs by algorithm. | Evaluate for measured scaling needs. |
| [TorchRL](https://docs.pytorch.org/rl/main/reference/generated/torchrl.envs.PettingZooWrapper.html) | Composable PyTorch training; AEC support with inactive-agent masks. | More assembly; wrappers do not accelerate the engine. | Flexible PyTorch path. |
| [BenchMARL](https://github.com/facebookresearch/BenchMARL) | TorchRL-based standardized experiments and reporting. | Built-in [PettingZoo tasks](https://github.com/facebookresearch/BenchMARL/blob/main/benchmarl/environments/pettingzoo/common.py) use parallel environments; our AEC task needs integration. | Evaluate after the environment works. |
| [Ray RLlib](https://docs.ray.io/en/latest/rllib/multi-agent-envs.html) | Turn-based multi-agent support, policy mapping, distributed execution, existing adapters. | Larger configuration/operational surface; coordination overhead needs measurement. | Consider for policy populations or cluster workloads. |
| [DouZero / DMC](https://github.com/kwai/DouZero) | Action encoding and self-play for a hidden-information shedding game. | Dou Dizhu-specific rules, roles, and models; not general training infrastructure. | Specialized algorithm baseline. |

RLCard examples alone do not address scale; PufferLib's trainer belongs to its integrated backend option above. All trainers must preserve opposing teams, actor information limits, setup choices, and reward/discount semantics across inactive turns.

## HTTP contracts

| Candidate | Strength | Cost / limitation | Position |
| --- | --- | --- | --- |
| Current Fastify + Zod | Existing behavior; no migration. | Manual endpoint/client coordination. | Baseline. |
| [fastify-type-provider-zod](https://github.com/turkerdev/fastify-type-provider-zod) | Small schema/typing/serialization integration compatible with our Zod generation. | No shared endpoint/client contract by itself. | First maintenance pilot on one HTTP flow. |
| [oRPC](https://v1.orpc.dev/docs/adapters/fastify) | Shared contracts, typed clients, OpenAPI, Fastify integration. | Contract/router migration and existing error/cookie/version handling. | Compare when endpoint/client duplication warrants it. |

Defer [ts-rest](https://ts-rest.com/server/fastify): assessed stable 3.52.1 declares Fastify 4/Zod 3 peers; Zod 4 RC still declares Fastify 4. [tRPC](https://trpc.io/docs/server/adapters/fastify) showed no clearer fit than oRPC for shared contracts. [Valibot](https://valibot.dev/guides/introduction/) addresses unmeasured validation footprint, not the identified maintenance work. Training steps bypass HTTP.

## Live hosting and room execution

| Candidate | Strength | Cost / limitation | Position |
| --- | --- | --- | --- |
| Current executor + SQLite | Existing VPS fit, private views, atomic events/deduplication. | Single-host limits; lifecycle/recovery maintenance remains ours. | Baseline; retain unless replacement wins. |
| [Rivet Actors / RivetKit](https://rivet.dev/actors/docs/) | Keyed actors, lifecycle, realtime connections, persistence. | Infrastructure/adapter cost; default [state saves](https://rivet.dev/actors/docs/state/) are throttled, not action-boundary commits. | Pilot against recurring hosting maintenance; preserve commit-before-acknowledgement explicitly. |
| [Restate Virtual Objects](https://docs.restate.dev/foundations/services) | Single writer per key and durable execution. | Extra runtime; external DB atomicity remains integration work. Server [BSL 1.1](https://github.com/restatedev/restate/blob/main/LICENSE), unlike MIT TypeScript SDK. | Compare when durability/recovery maintenance dominates. |

Defer [PartyServer/Durable Objects](https://github.com/cloudflare/partykit/blob/main/packages/partyserver/README.md): changes the VPS deployment model. [Colyseus](https://docs.colyseus.io/state/view) remains conditional on measured multiplayer lifecycle complexity under ADR 0001. Live room hosting is separate from training execution.

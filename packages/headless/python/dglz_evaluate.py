"""Trusted local policies: duplicate teams on fixed seat-indexed Templates.

A factory(seed) must return a fresh callable(raw_private_snapshot) -> action index.
Factories may share frozen weights, never seat memory. Optional decision_timeout
uses one spawned process per seat and requires picklable top-level factories.
Without it, a policy that does not return blocks. Observation time is measured apart.
"""

import argparse
from copy import deepcopy
from importlib.metadata import version
import json
import math
import multiprocessing
from numbers import Integral
from pathlib import Path
import platform
import random
from queue import Queue, Empty
import subprocess
from threading import Thread
from time import perf_counter

from dglz_env import BridgeError, DaguailuziEnv, ENCODING_VERSION


def _policy_worker(connection, factory, seed):
    try:
        policy = factory(seed)
        connection.send((True, None))
        while True:
            snapshot = connection.recv()
            try:
                connection.send((True, policy(snapshot)))
            except Exception as error:
                connection.send((False, type(error).__name__))
    except (EOFError, BrokenPipeError):
        pass
    except Exception as error:
        connection.send((False, type(error).__name__))
    finally:
        connection.close()


class _TimedPolicy:
    def __init__(self, factory, seed, timeout):
        self.timeout = timeout
        context = multiprocessing.get_context("spawn")
        self.connection, child = context.Pipe()
        self.process = context.Process(
            target=_policy_worker, args=(child, factory, seed), daemon=True
        )
        try:
            self.process.start()
            child.close()
            self._receive(
                max(10, timeout)
            )  # Startup/imports are separate from decisions.
        except Exception:
            child.close()
            self.close()
            raise

    def _receive(self, timeout):
        if not self.connection.poll(timeout):
            self.close()
            raise TimeoutError("策略响应超时。")
        success, value = self.connection.recv()
        if not success:
            raise RuntimeError("策略执行失败：" + value)
        return value

    def __call__(self, snapshot):
        if not self.process.is_alive():
            raise RuntimeError("策略进程已停止。")
        sent = Queue()

        def send():
            try:
                self.connection.send(snapshot)
                sent.put(None)
            except Exception as error:
                sent.put(error)

        started = perf_counter()
        writer = Thread(target=send, daemon=True)
        writer.start()
        try:
            error = sent.get(timeout=self.timeout)
            if error is not None:
                raise error
            return self._receive(max(0, self.timeout - (perf_counter() - started)))
        except Empty:
            self.close()
            raise TimeoutError("策略传输超时。") from None
        finally:
            writer.join(timeout=2)

    def close(self):
        if self.process.pid is not None:
            if self.process.is_alive():
                self.process.terminate()
            self.process.join(timeout=2)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(timeout=2)
        self.connection.close()


def random_policy(seed):
    """Uniform legal-action baseline with private, per-seat RNG state."""
    rng = random.Random(seed)
    return lambda snapshot: rng.randrange(len(snapshot["legalActions"]))


def fallback_action(snapshot):
    """Pass, rightmost display-order single, or first canonical setup candidate."""
    actions = snapshot["legalActions"]
    for index, action in enumerate(actions):
        if action["type"] == "Pass":
            return index
    view = snapshot["view"]
    if view["setupStage"] != "play":
        return 0

    def display_key(card):
        face, copy = card.split("#")
        rank = face if face in ("BIG", "SMALL") else face[:-1]
        strength = {"BIG": 16, "SMALL": 15, view["trumpRank"]: 14}.get(rank)
        if strength is None:
            strength = [
                "2",
                "3",
                "4",
                "5",
                "6",
                "7",
                "8",
                "9",
                "10",
                "J",
                "Q",
                "K",
                "A",
            ].index(rank)
        suit = 0 if rank in ("BIG", "SMALL") else "SHCD".index(face[-1])
        return -strength, suit, int(copy)

    rightmost = max(view["hand"], key=display_key)
    return next(
        i
        for i, action in enumerate(actions)
        if action["type"] == "Play" and action["cards"] == [rightmost]
    )


def evaluate(
    templates,
    policy_a=random_policy,
    policy_b=random_policy,
    *,
    seed=0,
    action_limit=1500,
    fallback=False,
    decision_timeout=None,
    env_factory=DaguailuziEnv,
):
    """Return evaluator-only reports. Incomplete pairs never contribute scores."""
    if not isinstance(seed, Integral) or isinstance(seed, bool) or seed < 0:
        raise ValueError("种子必须为非负整数。")
    if decision_timeout is not None and (
        not math.isfinite(decision_timeout) or decision_timeout <= 0
    ):
        raise ValueError("策略超时必须为有限正数。")
    rng = random.Random(int(seed))
    report = {
        "encodingVersion": ENCODING_VERSION,
        "seed": int(seed),
        "actionLimit": action_limit,
        "fallback": fallback,
        "decisionTimeout": decision_timeout,
        "rulesets": {},
    }
    for template_index, source in enumerate(templates):
        template = deepcopy(source)
        ruleset = template["rulesetId"]
        if ruleset not in ("dglz-4p-2d-v1", "dglz-6p-3d-v1"):
            raise ValueError("不支持的规则集。")
        players = 4 if ruleset == "dglz-4p-2d-v1" else 6
        group = report["rulesets"].setdefault(
            ruleset, {"pairs": [], "completedPairs": 0, "pairedScoreA": 0.0}
        )
        pair = {"templateIndex": template_index, "template": template, "legs": []}
        # Same policy seed per physical seat across legs; objects are always fresh.
        seeds = [rng.randrange(2**63) for _ in range(players)]
        for a_team in (0, 1):
            leg = {
                "teamA": a_team,
                "policySeeds": seeds[:],
                "status": "engine-failure",
                "scoreA": None,
                "outcome": None,
                "actions": 0,
                "botFailures": [],
                "timingSeconds": {
                    "reset": 0.0,
                    "observation": 0.0,
                    "policy": 0.0,
                    "step": 0.0,
                },
            }
            pair["legs"].append(leg)
            with env_factory(
                players,
                template=template,
                seating_policy="fixed",
                action_limit=action_limit,
                record=True,
            ) as env:
                policies = {}
                try:
                    started = perf_counter()
                    env.reset(seed=seed)
                    leg["timingSeconds"]["reset"] += perf_counter() - started
                    for seat, agent in enumerate(env.possible_agents):
                        factory = policy_a if seat % 2 == a_team else policy_b
                        try:
                            policies[agent] = (
                                factory(seeds[seat])
                                if decision_timeout is None
                                else _TimedPolicy(
                                    factory, seeds[seat], decision_timeout
                                )
                            )
                        except Exception as error:
                            leg["botFailures"].append(
                                {
                                    "playerId": agent,
                                    "actionCount": 0,
                                    "error": type(error).__name__,
                                    "stage": "factory",
                                }
                            )
                            leg["status"] = "bot-failure"
                            break
                    if leg["status"] == "bot-failure":
                        continue
                    while True:
                        actor = env.agent_selection
                        if env.terminations[actor] or env.truncations[actor]:
                            info = env.infos[actor]
                            leg["status"], leg["outcome"] = (
                                info["status"],
                                info["outcome"],
                            )
                            if leg["status"] == "completed":
                                # Every teammate receives the same terminal reward: count once.
                                leg["scoreA"] = env.rewards[env.possible_agents[a_team]]
                                record = env.export_record()
                                leg["engineVersions"] = {
                                    key: record[key]
                                    for key in (
                                        "formatVersion",
                                        "sourceVersion",
                                        "randomnessVersion",
                                        "shuffleVersion",
                                    )
                                }
                            break
                        started = perf_counter()
                        snapshot = env.observe_raw(actor)
                        leg["timingSeconds"]["observation"] += perf_counter() - started
                        policy_input = deepcopy(snapshot)
                        started = perf_counter()
                        try:
                            action = policies[actor](policy_input)
                            if (
                                isinstance(action, bool)
                                or not isinstance(action, Integral)
                                or not 0 <= action < len(snapshot["legalActions"])
                            ):
                                raise ValueError("策略动作不在合法候选中。")
                        except Exception as error:
                            leg["botFailures"].append(
                                {
                                    "playerId": actor,
                                    "actionCount": leg["actions"],
                                    "error": type(error).__name__,
                                    "stage": "decision",
                                }
                            )
                            if not fallback:
                                leg["status"] = "bot-failure"
                                break
                            action = fallback_action(snapshot)
                        finally:
                            leg["timingSeconds"]["policy"] += perf_counter() - started
                        started = perf_counter()
                        env.step(action)
                        leg["timingSeconds"]["step"] += perf_counter() - started
                        leg["actions"] += 1
                except BridgeError as error:
                    leg["status"] = "engine-failure"
                    leg["scoreA"], leg["outcome"] = None, None
                    leg["engineError"] = {"code": error.code, "message": str(error)}
                finally:
                    for policy in policies.values():
                        if isinstance(policy, _TimedPolicy):
                            policy.close()
        if all(leg["status"] == "completed" for leg in pair["legs"]):
            pair["scoreA"] = sum(leg["scoreA"] for leg in pair["legs"])
            group["pairedScoreA"] += pair["scoreA"]
            group["completedPairs"] += 1
        else:
            pair["scoreA"] = None
        group["pairs"].append(pair)
    return report


def main():
    parser = argparse.ArgumentParser(
        description="随机策略同牌换边对战；报告包含私有模板，请勿传给策略。"
    )
    parser.add_argument("templates", nargs="+", type=Path, help="挑战模板 JSON 文件")
    parser.add_argument("--seed", type=int, default=0, help="策略随机种子")
    parser.add_argument("--action-limit", type=int, default=1500, help="每手动作上限")
    parser.add_argument(
        "--fallback", action="store_true", help="策略错误时使用确定性后备动作"
    )
    parser.add_argument(
        "--decision-timeout", type=float, help="策略决策超时秒数；默认不限制"
    )
    args = parser.parse_args()
    report = evaluate(
        [json.loads(path.read_text(encoding="utf-8-sig")) for path in args.templates],
        seed=args.seed,
        action_limit=args.action_limit,
        fallback=args.fallback,
        decision_timeout=args.decision_timeout,
    )
    report["versions"] = {
        "python": platform.python_version(),
        "node": subprocess.check_output(["node", "--version"], text=True).strip(),
        **{name: version(name) for name in ("numpy", "gymnasium", "pettingzoo")},
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

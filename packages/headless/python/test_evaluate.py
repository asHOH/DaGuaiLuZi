"""Focused evaluator contract checks; native adapter checks cover engine rules."""

from copy import deepcopy
import json
from pathlib import Path
import random
from time import perf_counter, sleep
import unittest

from dglz_env import BridgeError, DaguailuziEnv, team_reward
from dglz_evaluate import evaluate, fallback_action, _TimedPolicy


def hanging_policy(seed):
    def decide(snapshot):
        sleep(30)
        return 0

    return decide


class FakeEnv:
    instances = []
    status = "completed"
    failure = False

    def __init__(self, players, **options):
        self.options = deepcopy(options)
        self.possible_agents = [f"p{i + 1}" for i in range(players)]
        self.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def reset(self, seed):
        self.turn = 0
        self.agent_selection = "p1"
        self.terminations = dict.fromkeys(self.possible_agents, False)
        self.truncations = self.terminations.copy()
        self.rewards = dict.fromkeys(self.possible_agents, 0)
        self.infos = {}

    def observe_raw(self, actor):
        if self.failure:
            raise BridgeError("engine-test", "测试引擎失败。")
        return {
            "playerId": actor,
            "legalActions": [{"type": "Pass"}],
            "view": {"setupStage": "play"},
        }

    def step(self, action):
        assert action == 0
        self.turn += 1
        if self.turn == len(self.possible_agents):
            self.terminations = dict.fromkeys(
                self.possible_agents, self.status == "completed"
            )
            self.truncations = dict.fromkeys(
                self.possible_agents, self.status == "truncated"
            )
            self.rewards = {
                a: 3 if i % 2 == 0 else -3 for i, a in enumerate(self.possible_agents)
            }
            self.infos = {
                a: {
                    "status": self.status,
                    "outcome": {"result": "测试"}
                    if self.status == "completed"
                    else None,
                }
                for a in self.possible_agents
            }
        else:
            self.agent_selection = self.possible_agents[self.turn]

    def export_record(self):
        return dict.fromkeys(
            ("formatVersion", "sourceVersion", "randomnessVersion", "shuffleVersion"), 1
        )


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        FakeEnv.instances = []
        FakeEnv.status = "completed"
        FakeEnv.failure = False
        self.templates = [
            {
                "rulesetId": f"dglz-{n}p-{n // 2}d-v1",
                "handSeed": "私有",
                "dealerTeam": 1,
                "trumpRank": "7",
            }
            for n in (4, 6)
        ]

    def test_duplicate_isolation_privacy_and_single_team_score(self):
        calls = []
        identities = []

        def factory(label):
            def make(seed):
                memory = []
                identities.append(memory)

                def decide(snapshot):
                    self.assertNotIn("template", snapshot)
                    self.assertNotIn("handSeed", snapshot)
                    self.assertFalse(memory)
                    memory.append(snapshot["playerId"])
                    calls.append((label, snapshot["playerId"]))
                    snapshot[
                        "legalActions"
                    ].clear()  # Cannot mutate evaluator validation.
                    return 0

                return decide

            return make

        original = deepcopy(self.templates)
        report = evaluate(
            self.templates, factory("A"), factory("B"), env_factory=FakeEnv
        )
        self.assertEqual(self.templates, original)
        self.assertEqual(len({id(x) for x in identities}), 20)
        self.assertEqual(
            calls[:8],
            [
                ("A", "p1"),
                ("B", "p2"),
                ("A", "p3"),
                ("B", "p4"),
                ("B", "p1"),
                ("A", "p2"),
                ("B", "p3"),
                ("A", "p4"),
            ],
        )
        for index, group in enumerate(report["rulesets"].values()):
            pair = group["pairs"][0]
            self.assertEqual([leg["scoreA"] for leg in pair["legs"]], [3, -3])
            self.assertEqual(group["pairedScoreA"], 0)
            self.assertEqual(group["completedPairs"], 1)
            self.assertEqual(
                FakeEnv.instances[index * 2].options,
                FakeEnv.instances[index * 2 + 1].options,
            )
            self.assertEqual(
                FakeEnv.instances[index * 2].options["seating_policy"], "fixed"
            )

    def test_failures_and_truncation_never_score(self):
        for status, failure, expected in [
            ("truncated", False, "truncated"),
            ("completed", True, "engine-failure"),
        ]:
            FakeEnv.status, FakeEnv.failure = status, failure
            report = evaluate(self.templates[:1], env_factory=FakeEnv)
            group = next(iter(report["rulesets"].values()))
            self.assertEqual(group["completedPairs"], 0)
            self.assertIsNone(group["pairs"][0]["scoreA"])
            for leg in group["pairs"][0]["legs"]:
                self.assertEqual(leg["status"], expected)
                self.assertIsNone(leg["scoreA"])
                self.assertIsNone(leg["outcome"])

    def test_invalid_policy_and_opt_in_fallback(self):
        for enabled in (False, True):
            report = evaluate(
                self.templates[:1],
                lambda seed: lambda snapshot: True,
                fallback=enabled,
                env_factory=FakeEnv,
            )
            for leg in next(iter(report["rulesets"].values()))["pairs"][0]["legs"]:
                self.assertEqual(
                    leg["status"], "completed" if enabled else "bot-failure"
                )
                self.assertTrue(leg["botFailures"])

    def test_rightmost_standard_order_and_setup(self):
        cards = ["BIG#1", "SMALL#1", "2D#2", "3S#1", "3D#1", "3D#2", "AS#1"]
        snapshot = {
            "view": {"setupStage": "play", "trumpRank": "2", "hand": cards},
            "legalActions": [{"type": "Play", "cards": [c]} for c in cards],
        }
        self.assertEqual(fallback_action(snapshot), 5)
        snapshot["legalActions"].append({"type": "Pass"})
        self.assertEqual(fallback_action(snapshot), 7)
        self.assertEqual(
            fallback_action(
                {
                    "view": {"setupStage": "tribute-selection"},
                    "legalActions": [{"type": "SelectTributeCard"}],
                }
            ),
            0,
        )

    def test_hard_timeout_reaps_process(self):
        policy = _TimedPolicy(hanging_policy, 0, 0.1)
        try:
            started = perf_counter()
            with self.assertRaises(TimeoutError):
                policy({})
            self.assertLess(perf_counter() - started, 5)
            self.assertFalse(policy.process.is_alive())
        finally:
            policy.close()

    def test_native_duplicate_templates(self):
        initial = []
        records = []
        assignments = []

        class CapturingEnv(DaguailuziEnv):
            def reset(self, seed=None, options=None):
                super().reset(seed, options)
                initial.append(
                    [self.observe_raw(agent) for agent in self.possible_agents]
                )
                assignments.append({})

            def export_record(self):
                record = super().export_record()
                records.append(record)
                self.replay_record(record)
                return record

        def factory(label):
            def make(seed):
                rng = random.Random(seed + (1 if label == "B" else 0))

                def decide(snapshot):
                    assignments[-1][snapshot["playerId"]] = label
                    self.assertNotIn("handSeed", snapshot)
                    self.assertNotIn("template", snapshot)
                    return rng.randrange(len(snapshot["legalActions"]))

                return decide

            return make

        paths = Path(__file__).parent / "examples"
        templates = [
            json.loads((paths / f"{n}p-subsequent.json").read_text(encoding="utf-8"))
            for n in (4, 6)
        ]
        saved = deepcopy(templates)
        report = evaluate(
            templates, factory("A"), factory("B"), seed=31, env_factory=CapturingEnv
        )
        self.assertEqual(templates, saved)
        for index, group in enumerate(report["rulesets"].values()):
            self.assertEqual(initial[index * 2], initial[index * 2 + 1])
            self.assertEqual(group["completedPairs"], 1)
            pair = group["pairs"][0]
            for team, leg in enumerate(pair["legs"]):
                self.assertEqual(leg["status"], "completed")
                self.assertFalse(leg["botFailures"])
                self.assertEqual(leg["scoreA"], team_reward(leg["outcome"], team))
                self.assertEqual(
                    records[index * 2 + team]["setup"]["template"], templates[index]
                )
                for seat, snapshot in enumerate(initial[index * 2 + team]):
                    self.assertEqual(
                        assignments[index * 2 + team][snapshot["playerId"]],
                        "A" if seat % 2 == team else "B",
                    )
            self.assertEqual(pair["scoreA"], sum(leg["scoreA"] for leg in pair["legs"]))


if __name__ == "__main__":
    unittest.main()

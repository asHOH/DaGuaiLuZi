"""Run with the pinned requirements after building headless dependencies."""

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import tempfile
from threading import Timer
from time import monotonic
import unittest

import numpy as np
from pettingzoo.test import api_test, seed_test

from dglz_env import BridgeError, DaguailuziEnv, _Bridge, team_reward


ROOT = Path(__file__).resolve().parents[3]


class AdapterTests(unittest.TestCase):
    def test_upstream_aec_and_seed_checks(self):
        for players in (4, 6):
            with (
                self.subTest(players=players),
                DaguailuziEnv(players, action_limit=3) as env,
            ):
                api_test(env, num_cycles=4)
            # Upstream seed_test constructs two envs; always close them even on failure.
            envs = []

            def make():
                env = DaguailuziEnv(players, action_limit=2)
                envs.append(env)
                return env

            try:
                seed_test(make, num_cycles=3)
            finally:
                for env in envs:
                    env.close()

    def test_rejections_resets_truncation_and_cleanup(self):
        with DaguailuziEnv(4, action_limit=1, seating_policy="randomized") as env:
            with self.assertRaises(BridgeError):
                env.step(0)
            env.reset(seed=42)
            pid = env._bridge.process.pid
            agent = env.agent_selection
            initial = env.observe_raw(agent)
            initial["legalActions"].clear()
            self.assertTrue(env.observe_raw(agent)["legalActions"])
            initial = env.observe_raw(agent)
            for bad in (-1, 101963, True, 0.5, None):
                with self.assertRaises(ValueError):
                    env.step(bad)
                self.assertEqual(env.observe_raw(agent), initial)
            for other in env.possible_agents:
                view = env.observe_raw(other)
                self.assertNotIn("handSeed", json.dumps(view))
                self.assertNotIn("template", view)
                self.assertNotIn("record", view)
                if other != agent:
                    self.assertEqual(view["legalActions"], [])
            env.step(np.int32(0))
            self.assertTrue(all(env.truncations.values()))
            self.assertFalse(any(env.terminations.values()))
            self.assertTrue(all(info["outcome"] is None for info in env.infos.values()))
            ended = []
            for actor in env.agent_iter():
                observation, reward, terminated, truncated, _ = env.last()
                self.assertEqual(reward, 0)
                self.assertFalse(terminated)
                self.assertTrue(truncated)
                self.assertEqual(observation["candidates"].shape, (0, 9))
                ended.append(actor)
                env.step(None)
            self.assertCountEqual(ended, env.possible_agents)
            with self.assertRaises(ValueError):
                env.step(None)
            env.reset(seed=42)
            self.assertEqual(env._bridge.process.pid, pid)
            self.assertEqual(env.observe_raw(agent), initial)
            with DaguailuziEnv(4, action_limit=1, seating_policy="randomized") as other:
                other.reset(seed=42)
                self.assertEqual(other.observe_raw(agent), initial)
                env.step(0)
                self.assertEqual(other.observe_raw(agent), initial)
            process = env._bridge.process
        self.assertIsNotNone(process.poll())
        env.close()
        with self.assertRaises(BridgeError):
            env.observe(agent)

    def test_engine_failure_and_reset_recovery(self):
        with DaguailuziEnv(4, action_limit=1) as env:
            env.reset(seed=7)
            process = env._bridge.process
            process.kill()
            process.wait(timeout=5)
            with self.assertRaises(BridgeError) as failure:
                env.observe_raw(env.agent_selection)
            self.assertTrue(failure.exception.code.startswith("engine-"))
            self.assertFalse(any(env.terminations.values()))
            self.assertFalse(any(env.truncations.values()))
            self.assertEqual(set(env.rewards.values()), {0})
            env.reset(seed=7)
            self.assertNotEqual(env._bridge.process.pid, process.pid)
        # An unresponsive or malformed engine cannot hang the caller or yield a result.
        for script, code in [
            ("setInterval(() => {}, 1000);", "engine-timeout"),
            ("process.stdout.write('not-json\\n');", "engine-protocol"),
            (
                "process.stdout.write(JSON.stringify({version:1,id:1,ok:true,data:{}})+'\\n');",
                "engine-protocol",
            ),
        ]:
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "engine.cjs"
                path.write_text(script, encoding="utf-8")
                with DaguailuziEnv(4, bridge_path=path, engine_timeout=1) as env:
                    with self.assertRaises(BridgeError) as failure:
                        env.reset(seed=0)
                    self.assertEqual(failure.exception.code, code)
                    self.assertIsNone(env._bridge)

    def test_large_request_timeout_and_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "engine.cjs"
            path.write_text("setInterval(() => {}, 1000);", encoding="utf-8")
            bridge = _Bridge(path, timeout=0.1)
            # Keep a broken implementation from hanging the test process forever.
            watchdog = Timer(5, bridge.process.kill)
            watchdog.start()
            started = monotonic()
            try:
                with self.assertRaises(BridgeError) as failure:
                    bridge.call("replay", {"record": "x" * 1_000_000})
                self.assertEqual(failure.exception.code, "engine-timeout")
                self.assertLess(monotonic() - started, 3)
                self.assertIsNotNone(bridge.process.poll())
                self.assertFalse(bridge.writer.is_alive())
                self.assertFalse(bridge.reader.is_alive())
                self.assertTrue(bridge.process.stdin.closed)
                self.assertTrue(bridge.process.stdout.closed)
            finally:
                watchdog.cancel()
                watchdog.join()
                bridge.close()

    def test_terminal_score_table(self):
        # Explicit expected values, including draws and both first-finisher teams.
        for players, magnitudes in ((4, [1, 3, 5]), (6, [1, 3, 5, 8])):
            for first_team in (0, 1):
                for caught, expected in enumerate(magnitudes):
                    outcome = {
                        "finishPositions": [None] * players,
                        "result": {
                            "outcome": "win" if caught else "draw",
                            "firstFinisherTeam": first_team,
                            "caughtPlayerIds": [f"caught{i}" for i in range(caught)],
                        },
                    }
                    self.assertEqual(team_reward(outcome, first_team), expected)
                    self.assertEqual(team_reward(outcome, 1 - first_team), -expected)

    def test_native_transcripts_privacy_and_terminal_delivery(self):
        fixtures = json.loads(
            subprocess.check_output(
                ["node", str(ROOT / "packages/headless/research/adapter-fixtures.mjs")],
                cwd=ROOT,
                text=True,
                encoding="utf-8",
                timeout=120,
            )
        )
        kinds, stages = set(), set()
        saw_early_finisher = saw_closure = saw_pair = False
        for fixture in fixtures:
            with (
                self.subTest(players=fixture["players"]),
                DaguailuziEnv(
                    fixture["players"],
                    template=fixture["template"],
                    seating_policy="randomized",
                    record=True,
                ) as env,
            ):
                env.reset(seed=0)
                expected_steps = [
                    s for s in fixture["record"]["steps"] if "observationHash" in s
                ]
                for count, step in enumerate(expected_steps):
                    actor = env.agent_selection
                    self.assertEqual(actor, step["command"]["playerId"])
                    if str(count) in fixture["checkpoints"]:
                        for expected in fixture["checkpoints"][str(count)]:
                            actual = env.observe_raw(expected["playerId"])
                            self.assertEqual(actual, expected)
                            stages.add(actual["view"]["setupStage"])
                            self.assertNotIn(
                                fixture["template"]["handSeed"], json.dumps(actual)
                            )
                    raw = env.observe_raw(actor)
                    if any(
                        p is not None for p in raw["view"].get("finishPositions", [])
                    ):
                        saw_early_finisher = True
                        self.assertEqual(env.agents, env.possible_agents)
                        self.assertFalse(any(env.terminations.values()))
                    action = {
                        k: v for k, v in step["command"].items() if k != "playerId"
                    }
                    kinds.add(action["type"])
                    if action["type"] == "Play" and len(action["cards"]) == 2:
                        saw_pair = True
                    if (
                        len(step["events"]) == 2
                        and step["events"][0]["type"] == "CardsPlayed"
                        and step["events"][1]["type"] == "LeadReset"
                    ):
                        saw_closure = True
                    env.step(raw["legalActions"].index(action))
                for expected in fixture["checkpoints"][str(len(expected_steps))]:
                    self.assertEqual(env.observe_raw(expected["playerId"]), expected)
                self.assertEqual(env.export_record(), fixture["record"])
                self.assertEqual(
                    env.replay_record(env.export_record()),
                    {
                        "outcome": fixture["outcome"],
                        "actionCount": len(expected_steps),
                    },
                )
                bad_record = deepcopy(fixture["record"])
                bad_record["sourceVersion"] = "incompatible"
                with self.assertRaises(BridgeError) as failure:
                    env.replay_record(bad_record)
                self.assertEqual(failure.exception.code, "invalid-record")
                delivered = {}
                for actor in env.agent_iter():
                    observation, reward, terminated, truncated, info = env.last()
                    self.assertTrue(terminated)
                    self.assertFalse(truncated)
                    self.assertFalse(observation["action_mask"].any())
                    self.assertEqual(info["outcome"], fixture["outcome"])
                    self.assertEqual(
                        reward, team_reward(fixture["outcome"], env._teams[actor])
                    )
                    delivered[actor] = reward
                    env.step(None)
                self.assertCountEqual(delivered, env.possible_agents)
                self.assertEqual(sum(delivered.values()), 0)
                self.assertEqual(env.export_record(), fixture["record"])
        self.assertTrue(saw_early_finisher and saw_pair and saw_closure)
        self.assertEqual(
            kinds,
            {
                "Play",
                "Pass",
                "SelectTributeCard",
                "SelectReturnCard",
                "OfferReturnCandidates",
                "SubmitTieChoiceBallot",
            },
        )
        self.assertTrue(
            {
                "tribute-selection",
                "recipient-pairing-tie",
                "leader-selection-tie",
                "return-card-selection",
            }.issubset(stages)
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)

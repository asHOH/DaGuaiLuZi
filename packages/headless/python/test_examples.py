"""Focused rollout/update checks; requires the optional pinned PyTorch extra."""

import json
from pathlib import Path
import unittest

import numpy as np

from dglz_examples import candidate_features, run_episode


class ExampleTests(unittest.TestCase):
    def test_candidate_distinctions(self):
        context = {"seatIndex": 0, "view": {"handSizes": [27] * 4}}
        observation = {
            "context": np.frombuffer(json.dumps(context).encode(), dtype=np.uint8),
            "candidates": np.array(
                [
                    [0, 1, 0, 0, 0, 0, 0, 0, 0],
                    [0, 2, 0, 0, 0, 0, 0, 0, 0],
                    [1, 0, 0, 0, 0, 0, 0, 0, 0],
                    [5, 0, 0, 0, 0, 0, 2, 1, 1],
                    [5, 0, 0, 0, 0, 0, 3, 1, 1],
                ]
            ),
        }
        features = candidate_features(observation)
        self.assertEqual(len(np.unique(features, axis=0)), 5)
        self.assertTrue(np.isfinite(features).all())

    def test_first_hand_truncation_never_trains(self):
        for players in (4, 6):
            with self.subTest(players=players):
                result = run_episode(players, 0, learn=True, action_limit=1)
                self.assertEqual(result["状态"], "truncated")
                self.assertIsNone(result["结果"])
                self.assertEqual(set(result["玩家奖励"].values()), {0})
                self.assertEqual(result["学习"]["更新次数"], 0)

    def test_complete_setup_trajectories_update(self):
        for players in (4, 6):
            template = json.loads(
                (
                    Path(__file__).parent / "examples" / f"{players}p-subsequent.json"
                ).read_text(encoding="utf-8")
            )
            with self.subTest(players=players):
                result = run_episode(players, 0, template=template, learn=True)
                self.assertEqual(result["状态"], "completed")
                self.assertEqual(result["配置"]["template"], template)
                self.assertGreater(len(result["阶段"]), 1)
                self.assertIn("play", result["阶段"])
                self.assertEqual(len(result["玩家奖励"]), players)
                self.assertEqual(sum(result["玩家奖励"].values()), 0)
                update = result["学习"]
                self.assertEqual(update["更新次数"], 1)
                self.assertEqual(update["样本数"], result["动作数"])
                self.assertTrue(np.isfinite(update["损失"]))
                self.assertGreater(update["参数变化"], 0)
                self.assertTrue(all(value > 0 for value in result["耗时秒"].values()))


if __name__ == "__main__":
    unittest.main(verbosity=2)

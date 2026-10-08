# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["gymnasium==1.4.0", "pettingzoo==1.27.0", "torch==2.14.1"]
# ///
"""Space and candidate-scorer probe; the live AEC adapter belongs to phase 3."""
import json
from pathlib import Path
import subprocess

import gymnasium as gym
import numpy as np
import pettingzoo
import torch
from torch import nn


def card_id(code):
    face, copy = code.split("#")
    ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
    face_id = (52 if face == "SMALL" else 53) if face in ("SMALL", "BIG") else ranks.index(face[:-1]) * 4 + "SHDC".index(face[-1])
    return face_id * 3 + int(copy)


def main():
    root = Path(__file__).resolve().parents[3]
    raw = subprocess.check_output(["node", str(Path(__file__).with_name("encoding-fixtures.mjs"))], cwd=root, text=True, encoding="utf-8")
    fixture = json.loads(raw)
    # AEC permits Gymnasium composite spaces. Lossless context remains available
    # to user encoders; this example scorer deliberately selects a small feature set.
    observation_space = gym.spaces.Dict({
        "context": gym.spaces.Sequence(gym.spaces.Discrete(256), stack=True),
        "candidates": gym.spaces.Sequence(gym.spaces.MultiDiscrete(fixture["actionBounds"]), stack=True),
        "action_mask": gym.spaces.MultiBinary(fixture["maxActions"]),
    })
    action_space = gym.spaces.Discrete(fixture["maxActions"])
    torch.manual_seed(0)
    # DMC-style action-conditioned scorer, not a fixed-size output per possible action.
    state_encoder = nn.Linear(162 + 6 + 6, 16)
    card_embedding = nn.Embedding(163, 8, padding_idx=0)
    scorer = nn.Sequential(nn.Linear(16 + 8 + 6 + 7 + 3 + 4, 32), nn.ReLU(), nn.Linear(32, 1))
    kinds = set()
    candidate_counts = set()
    for sample in fixture["samples"]:
        assert sample["encodingVersion"] == "dglz-research-3"
        context = {k: v for k, v in sample.items() if k not in ("legalActions", "actionFeatures")}
        encoded = np.frombuffer(json.dumps(context, ensure_ascii=False).encode("utf-8"), dtype=np.uint8)
        rows = np.asarray(sample["actionFeatures"], dtype=np.int64).reshape((-1, 9))
        count = len(rows)
        candidate_counts.add(count)
        mask = np.zeros(fixture["maxActions"], dtype=np.int8)
        mask[:count] = 1
        observation = {"context": encoded, "candidates": rows, "action_mask": mask}
        assert observation_space.contains(observation)
        assert json.loads(encoded.tobytes().decode("utf-8")) == context
        assert len(sample["legalActions"]) == count
        for action, row in zip(sample["legalActions"], rows):
            kinds.add(action["type"])
            cards = action.get("cards", action.get("candidateCards", [action["card"]] if "card" in action else []))
            assert sorted(card_id(card) for card in cards) == [int(i) for i in row[1:6] if i]
        if not count:
            assert not mask.any()
            continue
        view = context["view"]
        state = torch.zeros(174)
        for card in view.get("hand", []):
            state[card_id(card) - 1] = 1
        sizes = view.get("handSizes", [])
        state[162:162 + len(sizes)] = torch.tensor(sizes) / 28
        state[168 + context["seatIndex"]] = 1
        tokens = torch.from_numpy(rows)
        features = torch.cat([
            state_encoder(state).expand(count, -1),
            card_embedding(tokens[:, 1:6]).sum(1),
            nn.functional.one_hot(tokens[:, 0], 6),
            nn.functional.one_hot(tokens[:, 6], 7),
            nn.functional.one_hot(tokens[:, 7], 3),
            nn.functional.one_hot(tokens[:, 8], 4),
        ], dim=1).float()
        scores = scorer(features).squeeze(-1)
        assert scores.shape == (count,) and torch.isfinite(scores).all()
        choice = int(scores.argmax())
        assert action_space.contains(choice) and mask[choice]
        assert int(action_space.sample(mask=mask)) < count
    assert len(kinds) == 6 and len(candidate_counts) > 2 and 0 in candidate_counts
    print(json.dumps({"验证": "空间与候选动作评分通过", "样本数": len(fixture["samples"]),
                      "PettingZoo": pettingzoo.__version__, "采样耗时": fixture["timings"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()

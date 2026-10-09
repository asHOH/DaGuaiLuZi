"""Legal-random collection and one CPU Monte Carlo regression update.

The tiny scorer demonstrates the training connection, not playing strength.
Only a seat's permitted observation enters its features; evaluator metadata does not.
"""

import argparse
from importlib.metadata import version
import json
from pathlib import Path
import platform
import subprocess
from time import perf_counter

import numpy as np

from dglz_env import DaguailuziEnv, ENCODING_VERSION


def candidate_features(observation):
    """Small replaceable encoder; preserve physical candidate-card distinctions."""
    rows = observation["candidates"]
    context = json.loads(observation["context"].tobytes())
    count = len(rows)
    cards = np.zeros((count, 163), dtype=np.float32)
    for slot in range(1, 6):
        cards[np.arange(count), rows[:, slot]] = 1
    sizes = np.zeros(6, dtype=np.float32)
    hand_sizes = context["view"]["handSizes"]
    sizes[: len(hand_sizes)] = np.asarray(hand_sizes) / 28
    state = np.concatenate((sizes, np.eye(6)[context["seatIndex"]]))
    # ponytail: sizes/seat omit strategic context; replace this encoder for research.
    return np.concatenate(
        (
            cards[:, 1:],
            np.eye(6)[rows[:, 0]],
            np.eye(7)[rows[:, 6]],
            np.eye(3)[rows[:, 7]],
            np.eye(4)[rows[:, 8]],
            np.broadcast_to(state, (count, len(state))),
        ),
        axis=1,
    ).astype(np.float32)


def learner_update(features, returns, seed):
    """One actual update from completed-Hand, per-seat terminal returns."""
    try:
        import torch
    except ImportError as error:
        raise RuntimeError(
            "学习示例需要运行 python -m pip install torch==2.14.1。"
        ) from error
    torch.manual_seed(seed)
    torch.set_num_threads(1)
    x = torch.tensor(np.asarray(features), dtype=torch.float32)
    y = torch.tensor(returns, dtype=torch.float32)
    if x.ndim != 2 or len(x) == 0 or y.shape != (len(x),):
        raise ValueError("学习更新需要完整且非空的轨迹。")
    model = torch.nn.Sequential(
        torch.nn.Linear(x.shape[1], 16),
        torch.nn.Tanh(),
        torch.nn.Linear(16, 1),
    )
    optimizer = torch.optim.SGD(model.parameters(), lr=0.01)
    before = [parameter.detach().clone() for parameter in model.parameters()]
    loss = torch.nn.functional.mse_loss(model(x).squeeze(-1), y)
    if not torch.isfinite(loss):
        raise ValueError("学习损失不是有限数值。")
    optimizer.zero_grad()
    loss.backward()
    optimizer.step()
    delta = sum(
        float((old - new.detach()).abs().sum())
        for old, new in zip(before, model.parameters())
    )
    if not np.isfinite(delta) or delta <= 0:
        raise ValueError("模型参数未完成有效更新。")
    return {
        "损失": float(loss.detach()),
        "参数变化": delta,
        "样本数": len(x),
        "更新次数": 1,
        "PyTorch": torch.__version__,
        "配置": {
            "设备": "CPU",
            "隐藏单元": 16,
            "优化器": "SGD",
            "学习率": 0.01,
            "目标": "每个动作所属玩家的实际终局团队奖励",
        },
    }


def run_episode(players=4, seed=0, *, template=None, learn=False, **env_options):
    """Collect one full legal-random Hand; truncation never becomes a target."""
    started = perf_counter()
    rng = np.random.default_rng(seed)
    observations = bridge = 0.0
    features, actors = [], []
    rewards, stages = {}, set()
    actions = 0
    outcome = None
    status = None
    with DaguailuziEnv(players, template=template, record=True, **env_options) as env:
        tick = perf_counter()
        env.reset(seed=seed)
        bridge += perf_counter() - tick
        for actor in env.agent_iter():
            # Dead steps deliver final team rewards even to early finishers.
            if env.terminations[actor] or env.truncations[actor]:
                _, reward, terminated, _, info = env.last(observe=False)
                rewards[actor] = reward
                status = "completed" if terminated else "truncated"
                outcome = info["outcome"]
                env.step(None)
                continue
            tick = perf_counter()
            observation = env.observe(actor)
            observations += perf_counter() - tick
            context = json.loads(observation["context"].tobytes())
            stages.add(context["view"]["setupStage"])
            action = int(rng.integers(len(observation["candidates"])))
            if learn:
                features.append(candidate_features(observation)[action])
                actors.append(actor)
            tick = perf_counter()
            env.step(action)
            bridge += perf_counter() - tick
            actions += 1
        tick = perf_counter()
        record = env.export_record() if status == "completed" else None
        bridge += perf_counter() - tick
    rollout = perf_counter() - started
    report = {
        "人数": players,
        "种子": seed,
        "策略": "合法动作均匀随机",
        "状态": status,
        "动作数": actions,
        "动作上限": env_options.get("action_limit", 1500),
        "阶段": sorted(stages),
        "结果": outcome,
        "玩家奖励": rewards,
        "版本": {
            "编码": ENCODING_VERSION,
            "引擎": record["sourceVersion"] if record else None,
            "随机数": record["randomnessVersion"] if record else None,
            "洗牌": record["shuffleVersion"] if record else None,
            "Python": platform.python_version(),
            "NumPy": np.__version__,
            "PettingZoo": version("pettingzoo"),
            "Gymnasium": version("gymnasium"),
            "Node.js": subprocess.check_output(
                ["node", "--version"], text=True
            ).strip(),
        },
        "配置": record["setup"] if record else {"template": template, **env_options},
        "耗时秒": {
            "观察（含引擎通信）": observations,
            "其他引擎调用（重置、动作、记录）": bridge,
            "整手采集": rollout,
        },
    }
    if learn:
        if status != "completed":
            report["学习"] = {"更新次数": 0, "原因": "手牌截断，不生成终局学习目标。"}
        else:
            report["学习"] = learner_update(
                features, [rewards[a] for a in actors], seed
            )
    return report


def main():
    parser = argparse.ArgumentParser(description="合法随机手牌与微型学习示例。")
    parser.add_argument("--players", type=int, choices=(4, 6), default=4, help="人数")
    parser.add_argument("--seed", type=int, default=0, help="非负随机种子")
    parser.add_argument("--template", type=Path, help="挑战模板 JSON 文件")
    parser.add_argument(
        "--preset", choices=("省心", "自主"), default="省心", help="规则预设"
    )
    parser.add_argument("--action-limit", type=int, default=1500, help="动作上限")
    parser.add_argument(
        "--learn", action="store_true", help="完整手牌后执行一次 CPU 学习更新"
    )
    args = parser.parse_args()
    template = (
        json.loads(args.template.read_text(encoding="utf-8")) if args.template else None
    )
    print(
        json.dumps(
            run_episode(
                args.players,
                args.seed,
                template=template,
                learn=args.learn,
                preset=args.preset,
                action_limit=args.action_limit,
            ),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

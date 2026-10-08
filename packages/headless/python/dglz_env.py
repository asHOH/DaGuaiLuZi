"""Single-Hand PettingZoo AEC adapter. Node owns rules; Python owns rewards."""

from copy import deepcopy
import atexit
import json
from numbers import Integral
from pathlib import Path
from queue import Empty, Queue
import subprocess
from threading import Thread
from time import monotonic

import gymnasium as gym
import numpy as np
from pettingzoo import AECEnv


ENCODING_VERSION = "dglz-research-3"
MAX_ACTIONS = 101963
ACTION_BOUNDS = [6, 163, 163, 163, 163, 163, 7, 3, 4]


class BridgeError(RuntimeError):
    """Machine-readable failure; no engine failure is a game outcome."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def team_reward(outcome, team_index):
    """Replaceable zero-sum terminal score, including Dealer advantage on draws."""
    result = outcome["result"]
    caught = len(result["caughtPlayerIds"])
    scores = (1, 3, 5) if len(outcome["finishPositions"]) == 4 else (1, 3, 5, 8)
    magnitude = scores[caught]
    return magnitude if team_index == result["firstFinisherTeam"] else -magnitude


class _Bridge:
    def __init__(self, path, timeout):
        self.timeout = timeout
        self.counter = 0
        self.lines = Queue()
        self.writer = None
        try:
            self.process = subprocess.Popen(
                ["node", str(path)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=None,
                text=True,
                encoding="utf-8",
                bufsize=1,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except OSError as error:
            raise BridgeError("engine-start", "无法启动 Node.js 引擎。") from error
        self.reader = Thread(target=self._read, daemon=True)
        self.reader.start()
        atexit.register(self.close)

    def _read(self):
        try:
            for line in self.process.stdout:
                self.lines.put(line)
        finally:
            self.lines.put(None)

    def call(self, op, args):
        self.counter += 1
        request = {"version": 1, "id": self.counter, "op": op, "args": args}
        payload = json.dumps(request, ensure_ascii=False, allow_nan=False) + "\n"
        written = Queue()

        def write():
            try:
                self.process.stdin.write(payload)
                self.process.stdin.flush()
            except (OSError, ValueError) as error:
                written.put(error)
            else:
                written.put(None)

        deadline = monotonic() + self.timeout
        self.writer = Thread(target=write, daemon=True)
        self.writer.start()
        try:
            error = written.get(timeout=max(0, deadline - monotonic()))
            if error is not None:
                self.close()
                raise BridgeError(
                    "engine-closed", "引擎连接已关闭，请重置环境。"
                ) from error
            line = self.lines.get(timeout=max(0, deadline - monotonic()))
        except Empty as error:
            self.close()
            raise BridgeError("engine-timeout", "引擎响应超时，请重置环境。") from error
        try:
            response = json.loads(line) if line is not None else None
            if (
                not isinstance(response, dict)
                or type(response.get("version")) is not int
                or response["version"] != 1
                or type(response.get("id")) is not int
                or response["id"] != self.counter
                or type(response.get("ok")) is not bool
            ):
                raise ValueError("invalid envelope")
            if response["ok"]:
                if "data" not in response:
                    raise ValueError("missing data")
                return response["data"]
            failure = response.get("error")
            if (
                not isinstance(failure, dict)
                or not isinstance(failure.get("code"), str)
                or not isinstance(failure.get("message"), str)
            ):
                raise ValueError("invalid error")
        except (ValueError, TypeError) as error:
            self.close()
            raise BridgeError(
                "engine-protocol", "引擎响应无效或连接已中断，请重置环境。"
            ) from error
        raise BridgeError(failure["code"], failure["message"])

    def close(self):
        atexit.unregister(self.close)
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2)
        # Terminate first: closing stdin while a write holds its lock can deadlock.
        if self.writer is not None:
            self.writer.join(timeout=2)
        self.reader.join(timeout=2)
        for stream in (self.process.stdin, self.process.stdout):
            try:
                stream.close()
            except OSError:
                pass  # A broken pipe may also fail its final flush on Windows.


class DaguailuziEnv(AECEnv):
    """One Hand, 4 or 6 seats. Finished seats remain until terminal team rewards.

    `observe` and `observe_raw` expose one seat's permitted information.
    `export_record` is evaluator-only; never pass its result to a policy.
    An instance is synchronous, like its engine process; do not share across threads.
    """

    metadata = {"name": "daguailuzi_v0", "render_modes": [], "is_parallelizable": False}

    def __init__(
        self,
        players=6,
        *,
        preset="省心",
        rules_configuration=None,
        template=None,
        seating_policy="fixed",
        action_limit=1500,
        record=False,
        reward_fn=team_reward,
        bridge_path=None,
        engine_timeout=120,
    ):
        if type(players) is not int or players not in (4, 6):
            raise ValueError("人数必须为四或六。")
        if (
            not isinstance(action_limit, Integral)
            or isinstance(action_limit, bool)
            or not 0 < action_limit <= 2**53 - 1
        ):
            raise ValueError("动作上限必须为正整数。")
        if not np.isfinite(engine_timeout) or engine_timeout <= 0:
            raise ValueError("引擎等待时间必须为有限正数。")
        self.possible_agents = [f"p{i + 1}" for i in range(players)]
        self.render_mode = None
        self._setup = {
            "players": players,
            "seatingPolicy": seating_policy,
            "actionLimit": int(action_limit),
            "record": record,
        }
        if template is not None:
            if rules_configuration is not None:
                raise ValueError("挑战模板不能与规则设置混用。")
            self._setup["template"] = deepcopy(template)
        elif rules_configuration is not None:
            self._setup["rulesConfiguration"] = deepcopy(rules_configuration)
        else:
            self._setup["preset"] = preset
        self._reward_fn = reward_fn
        self._bridge_path = (
            Path(bridge_path)
            if bridge_path is not None
            else Path(__file__).resolve().parents[1] / "dist" / "bridge.js"
        )
        self._engine_timeout = engine_timeout
        self._bridge = None
        self._ready = False
        self._rng = np.random.default_rng()
        self._raw = {}
        self._action_spaces = {
            a: gym.spaces.Discrete(MAX_ACTIONS) for a in self.possible_agents
        }
        self._observation_space = gym.spaces.Dict(
            {
                "context": gym.spaces.Sequence(gym.spaces.Discrete(256), stack=True),
                "candidates": gym.spaces.Sequence(
                    gym.spaces.MultiDiscrete(ACTION_BOUNDS), stack=True
                ),
                "action_mask": gym.spaces.MultiBinary(MAX_ACTIONS),
            }
        )

    def _call(self, op, args):
        if self._bridge is None:
            raise BridgeError("not-reset", "请先初始化环境。")
        try:
            data = self._bridge.call(op, args)
            if not isinstance(data, dict):
                raise BridgeError("engine-protocol", "引擎数据必须为对象。")
            if op in ("reset", "step"):
                if (
                    data.get("status") not in ("active", "completed", "truncated")
                    or type(data.get("episode")) is not int
                    or data["episode"] < 1
                    or type(data.get("actionCount")) is not int
                    or data["actionCount"] < 0
                    or "outcome" not in data
                    or (
                        data["status"] == "active"
                        and data.get("currentPlayerId") not in self.possible_agents
                    )
                    or (
                        data["status"] != "active"
                        and data.get("currentPlayerId") is not None
                    )
                    or (
                        data["status"] == "completed"
                        and not isinstance(data["outcome"], dict)
                    )
                    or (data["status"] != "completed" and data["outcome"] is not None)
                ):
                    raise BridgeError("engine-protocol", "引擎状态无效。")
            if op == "reset":
                players = data.get("players")
                if (
                    not isinstance(players, list)
                    or len(players) != len(self.possible_agents)
                    or any(
                        not isinstance(p, dict)
                        or p.get("playerId") not in self.possible_agents
                        or type(p.get("seatIndex")) is not int
                        or not 0 <= p["seatIndex"] < len(players)
                        or p.get("teamIndex") != p["seatIndex"] % 2
                        for p in players
                    )
                    or len({p["playerId"] for p in players}) != len(players)
                    or len({p["seatIndex"] for p in players}) != len(players)
                    or data["status"] != "active"
                    or data["actionCount"] != 0
                ):
                    raise BridgeError("engine-protocol", "引擎座位信息无效。")
            return data
        except BridgeError as error:
            if error.code.startswith("engine-") or error.code == "version-mismatch":
                self.close()
            raise

    def reset(self, seed=None, options=None):
        # Reset options are reserved; the fixed constructor keeps spaces/agents stable.
        if seed is not None:
            if not isinstance(seed, Integral) or isinstance(seed, bool) or seed < 0:
                raise ValueError("种子必须为非负整数。")
            self._rng = np.random.default_rng(int(seed))
        setup = deepcopy(self._setup)
        if "template" not in setup:
            setup["handSeed"] = str(int(self._rng.integers(0, 2**63)))
        if self._bridge is None:
            self._bridge = _Bridge(self._bridge_path, self._engine_timeout)
        data = self._call("reset", setup)
        if (
            data.get("encodingVersion") != ENCODING_VERSION
            or data.get("maxActions") != MAX_ACTIONS
            or data.get("actionBounds") != ACTION_BOUNDS
        ):
            self.close()
            raise BridgeError("version-mismatch", "研究编码版本不兼容。")
        self._status = data
        self._teams = {p["playerId"]: p["teamIndex"] for p in data["players"]}
        self.agents = self.possible_agents[:]
        self.agent_selection = data["currentPlayerId"]
        self.rewards = {a: 0 for a in self.agents}
        self._cumulative_rewards = self.rewards.copy()
        self.terminations = {a: False for a in self.agents}
        self.truncations = self.terminations.copy()
        self.infos = {a: {} for a in self.agents}
        self._skip_agent_selection = None
        self._raw.clear()
        for space in self._action_spaces.values():
            space.seed(int(self._rng.integers(0, 2**63)))
        self._ready = True

    def _check(self, agent=None):
        if not self._ready:
            raise BridgeError("not-reset", "请先初始化环境。")
        if agent is not None and agent not in self.possible_agents:
            raise ValueError("玩家不在当前手牌中。")

    def action_space(self, agent):
        return self._action_spaces[agent]

    def observation_space(self, agent):
        if agent not in self.possible_agents:
            raise ValueError("玩家不在当前手牌中。")
        return self._observation_space

    def _snapshot(self, agent):
        self._check(agent)
        if agent not in self._raw:
            data = self._call("observe", {"playerId": agent})
            rows, actions = data.get("actionFeatures"), data.get("legalActions")
            if (
                data.get("encodingVersion") != ENCODING_VERSION
                or data.get("playerId") != agent
                or data.get("actionCount") != self._status["actionCount"]
                or not isinstance(data.get("view"), dict)
                or not isinstance(data.get("publicHistory"), list)
                or not isinstance(rows, list)
                or not isinstance(actions, list)
                or len(rows) != len(actions)
                or len(rows) > MAX_ACTIONS
                or any(
                    not isinstance(row, list)
                    or len(row) != 9
                    or any(
                        type(x) is not int or not 0 <= x < bound
                        for x, bound in zip(row, ACTION_BOUNDS)
                    )
                    for row in rows
                )
                or any(not isinstance(a, dict) for a in actions)
            ):
                self.close()
                raise BridgeError(
                    "engine-protocol", "观察与当前回合不一致，请重置环境。"
                )
            self._raw[agent] = data
        return self._raw[agent]

    def observe_raw(self, agent):
        return deepcopy(self._snapshot(agent))

    def observe(self, agent):
        raw = self._snapshot(agent)
        context = {
            k: v for k, v in raw.items() if k not in ("legalActions", "actionFeatures")
        }
        encoded = np.frombuffer(
            json.dumps(context, ensure_ascii=False).encode("utf-8"), dtype=np.uint8
        ).copy()
        rows = np.asarray(raw["actionFeatures"], dtype=np.int64).reshape((-1, 9))
        mask = np.zeros(MAX_ACTIONS, dtype=np.int8)
        mask[: len(rows)] = 1
        return {"context": encoded, "candidates": rows, "action_mask": mask}

    def step(self, action):
        self._check()
        if not self.agents:
            raise ValueError("手牌已结束，请重置环境。")
        agent = self.agent_selection
        if self.terminations[agent] or self.truncations[agent]:
            if action is not None:
                raise ValueError("已结束的玩家只能提交空动作。")
            self._was_dead_step(action)
            return
        if isinstance(action, bool) or not isinstance(action, Integral):
            raise ValueError("动作编号必须为整数。")
        if not 0 <= int(action) < len(self._snapshot(agent)["legalActions"]):
            raise ValueError("动作编号不在合法候选中。")
        data = self._call(
            "step",
            {
                "episode": self._status["episode"],
                "actionCount": self._status["actionCount"],
                "playerId": agent,
                "actionId": int(action),
            },
        )
        self._status = data
        self._raw.clear()
        self._cumulative_rewards[agent] = 0
        self._clear_rewards()
        if data["status"] == "active":
            self.agent_selection = data["currentPlayerId"]
        else:
            completed = data["status"] == "completed"
            if completed:
                try:
                    # Calculate once per team, never once per seat with mutable inputs.
                    scores = {
                        team: float(self._reward_fn(deepcopy(data["outcome"]), team))
                        for team in (0, 1)
                    }
                    if not all(np.isfinite(score) for score in scores.values()):
                        raise ValueError("nonfinite reward")
                except Exception:
                    self.close()
                    raise
                self.rewards = {a: scores[self._teams[a]] for a in self.agents}
            self.terminations = {a: completed for a in self.agents}
            self.truncations = {a: not completed for a in self.agents}
            self.infos = {
                a: {"status": data["status"], "outcome": deepcopy(data["outcome"])}
                for a in self.agents
            }
            self._deads_step_first()
        self._accumulate_rewards()

    def export_record(self):
        """Evaluator-only reproduction record, including private setup and history."""
        self._check()
        return self._call("record", {})

    def replay_record(self, record):
        """Evaluator-only native replay check; does not replace the current episode."""
        self._check()
        return self._call("replay", {"record": record})

    def close(self):
        self._ready = False
        self._raw.clear()
        if self._bridge is not None:
            self._bridge.close()
            self._bridge = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

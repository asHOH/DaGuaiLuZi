"""Run with an installed wheel from outside the checkout: python -I test_package.py."""

from contextlib import chdir
from importlib.metadata import distribution
import json
from pathlib import Path
import tempfile

from dglz_env import DaguailuziEnv
import dglz_evaluate
import dglz_examples


def check():
    package = distribution("daguailuzi-env")
    engine = Path(package.locate_file("dglz_engine/dist"))
    assert (engine / "node_modules/zod/LICENSE").is_file()
    assert (engine / "versions.json").is_file()
    assert dglz_evaluate.__file__ and dglz_examples.__file__
    with tempfile.TemporaryDirectory() as directory:
        with chdir(directory):
            for players in (4, 6):
                with DaguailuziEnv(players=players, action_limit=1) as env:
                    assert env._bridge_path.is_relative_to(engine)
                    env.reset(seed=4104 + players)
                    env.step(0)
                    assert all(env.truncations.values())
                    assert not any(env.terminations.values())
                template = json.loads(
                    (engine / "examples" / f"{players}p-subsequent.json").read_text(
                        encoding="utf-8"
                    )
                )
                result = dglz_examples.run_episode(
                    players, 0, template=template, learn=False
                )
                assert result["状态"] == "completed"
                assert result["配置"]["template"] == template
                assert len(result["阶段"]) > 1
                assert "play" in result["阶段"]
                assert len(result["玩家奖励"]) == players
                assert sum(result["玩家奖励"].values()) == 0
    print("安装包检查通过：四人、六人引擎可在仓库外完成含准备阶段的整手对局。")


if __name__ == "__main__":
    check()

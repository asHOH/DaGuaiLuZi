# 大怪路子研究环境

单局 PettingZoo AEC 环境，支持四人、六人规则。每个 episode 只打一手牌；研究者自行选择模型和训练方法。安装包自带编译后的规则引擎，无需下载仓库或构建 TypeScript。

## 安装与首次运行

需要 Python 3.12 和 Node.js 24（验证版本：Python 3.12.12/3.12.13、Node.js 24.11.0）。将提供的 wheel 放入当前目录，在独立环境安装：

```sh
python -m venv .venv
# Linux/macOS
. .venv/bin/activate
# Windows PowerShell 改用：.venv\Scripts\Activate.ps1
python -m pip install ./daguailuzi_env-0.1.0-py3-none-any.whl
python -m dglz_examples --players 4 --seed 7
python -m dglz_examples --players 6 --seed 7
```

示例随机选择合法动作，输出局面结果、配置、版本、种子和耗时。合法动作枚举以正确性为先；一手牌可能需要数分钟，当前版本不承诺训练吞吐量。

## 接入自己的策略

```python
from dglz_env import DaguailuziEnv

with DaguailuziEnv(players=4) as env:
    env.reset(seed=7)
    for agent in env.agent_iter():
        observation, reward, terminated, truncated, info = env.last()
        action = None if terminated or truncated else env.action_space(agent).sample(
            mask=observation["action_mask"]
        )
        env.step(action)
```

`context` 是无损 UTF-8 JSON 字节；`candidates` 的每行对应一个合法动作，`action_mask` 标记有效编号。动作编号只对当前观察有效。`observe_raw(agent)` 返回结构化的私有观察、公开历史、合法动作和特征。候选数可变，策略应按候选评分；不支持直接套用标准 TorchRL PettingZoo 包装器。

每行九列：动作类型、五个升序实体牌编号（零补位）、投票目标座位加一、平票类型、平票轮次。动作类型 0–5 分别是出牌、不出、选贡牌、提供还贡候选、选还贡牌、平票投票。实体牌编号 1–162 按点数 2..A、花色 SHDC、小王、大王排列，每种牌三个副本；四人规则仅使用前两个副本。投票目标零表示弃权；平票类型 0/1/2 表示无/收贡人/领出人。原始 `legalActions` 同时保留完整动作内容，勿从编号推断跨回合的含义。

结束前已出完牌的玩家仍留在环境中，以接收最终团队奖励；结束后逐个提交 `None`。正常结束与动作上限截断分别标记，截断不产生结果或终局奖励。引擎故障抛出 `BridgeError`，不是平局。

默认团队奖励：六人抓三/二/一/零人分别为 8/5/3/1；四人为 5/3/1。首位出完者所在队得正分，对手得相反数；零抓仍体现下手坐庄优势。每名队员收到团队分，评估时每队只计一次。可传入 `reward_fn(outcome, team_index)` 替换。

## 最小学习检查

```sh
python -m pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu
python -m dglz_examples --players 4 --seed 7 --learn
```

示例收集一手牌的轨迹，用实际终局团队奖励执行一次模型更新并检查参数变化。这仅验证学习流程接通，不代表学到了有效策略或具备竞技水平。

## 同牌换边对战

安装包附带四人、六人进贡与还贡模板。先复制到当前目录：

```python
from pathlib import Path
import shutil
import dglz_engine

samples = Path(dglz_engine.__file__).parent / "dist" / "examples"
for path in samples.glob("*.json"):
    shutil.copy2(path, Path.cwd() / path.name)
```

```sh
python -m dglz_examples --players 4 --template 4p-subsequent.json
python -m dglz_evaluate 4p-subsequent.json 6p-subsequent.json --seed 7
```

命令用随机策略验证流程。替换策略时调用 `evaluate(templates, policy_a, policy_b, seed=7)`；每个工厂接受一个策略随机种子，返回接收单座位原始观察并输出合法动作编号的函数。每次换边、每个座位都重新创建函数；固定模型权重，勿在评估中训练或共享记忆。

两次独立 Hand 保留同一模板的发牌、逻辑座位、庄家、主级与起始设置，只交换策略所属队伍。两手都完成才计入配对分数（策略 A 两手团队分之和）；四人、六人分别汇总。报告包含私有模板，仅供评估者保存。

默认策略错误或非法动作使本手失败，默认不限制策略用时。`--decision-timeout 2` 可启用独立进程中的每步两秒上限；不计观察生成，包含策略输入传输，启动另限至少十秒。该模式的策略工厂必须可序列化并定义在模块顶层，调用脚本须使用 `if __name__ == "__main__":`。

`--fallback` 开启错误/超时后备动作：可不出时不出；领出时选标准牌序最右侧单牌（点数从强到弱、同点数黑桃/红桃/梅花/方块、副本号递增）；设置阶段选首个合法候选。每次干预记入报告。超时进程被终止，后续该座位继续使用后备动作；工厂启动失败直接结束本手。引擎故障不使用后备动作，也不计分。

耗时分开记录观察、其他引擎调用、策略与整手采集；这些是端到端调用耗时，不是纯通信开销。需要性能结论时应另做代表性负载测量。

## 隐私与复现

策略只能接收自己座位的观察。同队可以共用固定模型权重，不可共用私有观察或记忆。不要把环境、Template、手牌种子或 `export_record()` 的完整记录传给策略。完整记录仅供评估者使用，可用 `replay_record(record)` 检查重放。

种子、Template、配置和软件版本必须与实验结果一起保留。相同种子不保证跨引擎版本兼容；当前只支持本版本的数据格式。

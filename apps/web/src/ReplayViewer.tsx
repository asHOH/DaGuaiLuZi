import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ChallengeCodeSchema,
  HandReplayResponseEnvelopeSchema,
  type HandReplay,
  type HandReplayStep,
  type RulesetId,
} from "@dglz/protocol";

import { ApiError, api } from "./api";
import {
  ACTIVITY_LABELS,
  completionLabel,
  resultLabel,
  RULE_LABELS,
  RULE_VALUES,
} from "./game-display";
import {
  HandCards,
  PlayedCards,
  TableHeading,
  TableSurface,
  positionLabel,
} from "./TableSurface";
import { ChallengeShare } from "./ChallengeControls";
import { type ReplaySource } from "./replay-links";

import styles from "./ReplayViewer.module.css";
import tableStyles from "./RoomTable.module.css";

type ReplayViewerProps = {
  accountId: string;
  onFailure: (reason: unknown) => void;
  onSourceChange: (source: ReplaySource | undefined) => void;
  initialSource?: ReplaySource | undefined;
  invalidLink: boolean;
  onChallenge: (code: string, rulesetId: RulesetId) => Promise<void>;
  disabled: boolean;
};

const SETUP_STAGE_LABELS: Record<HandReplayStep["setupStage"], string> = {
  "tribute-selection": "进贡选牌",
  "recipient-pairing-tie": "进贡配对",
  "return-card-selection": "还牌选牌",
  "leader-selection-tie": "领牌选择",
  play: "出牌阶段",
};

function replayError(reason: unknown): string {
  const code = reason instanceof ApiError ? reason.code : "unsupported";
  return (
    {
      "not-found": "找不到这份回放，请检查挑战码或本局是否已完成。",
      forbidden: "你无权查看这份回放。",
      "unsupported-persisted-event":
        "这份回放暂时无法打开，牌局版本可能已不再支持。",
      "rate-limited": "操作太频繁，请稍后再试。",
      "malformed-input": "回放挑战码格式不正确。",
      unsupported: "这份回放数据暂时无法读取，请稍后再试。",
    }[code] ?? "回放暂时无法加载，请重试。"
  );
}

function RulesSummary({ replay }: { replay: HandReplay }) {
  const configuration = replay.summary.rulesConfiguration;
  return (
    <details className={styles.rules}>
      <summary>规则配置</summary>
      <dl className={styles.ruleList}>
        <div>
          <dt>规则组</dt>
          <dd>
            {RULE_VALUES[configuration.rulesetId] ?? configuration.rulesetId}
          </dd>
        </div>
        <div>
          <dt>座位方式</dt>
          <dd>
            {replay.summary.seatingPolicy === "fixed" ? "固定座位" : "随机座位"}
          </dd>
        </div>
        {Object.entries(configuration)
          .filter(([key]) => key !== "rulesetId")
          .map(([key, value]) => (
            <div key={key}>
              <dt>{RULE_LABELS[key] ?? key}</dt>
              <dd>{RULE_VALUES[value] ?? value}</dd>
            </div>
          ))}
      </dl>
    </details>
  );
}

function ActionList({
  step,
  trumpRank,
}: {
  step: HandReplayStep;
  trumpRank: HandReplay["summary"]["trumpRank"];
}) {
  return (
    <section className={styles.actions} aria-labelledby="replay-actions-title">
      <h4 id="replay-actions-title">本步记录</h4>
      <ol>
        {step.actions.map((action, index) => (
          <li key={`${action.text}-${index}`}>
            <span>{action.text}</span>
            {action.cards !== undefined && (
              <PlayedCards cards={action.cards} trumpRank={trumpRank} />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReplayTable({
  replay,
  step,
  accountId,
  seatIndex,
  onSeatChange,
}: {
  replay: HandReplay;
  step: HandReplayStep;
  accountId: string;
  seatIndex: number;
  onSeatChange: (seat: number) => void;
}) {
  const { trumpRank, playerIds, handNumber } = replay.summary;
  const hand = step.hands[seatIndex]!;
  return (
    <div
      className={`${tableStyles.roomTable} ${tableStyles.roomActive} ${styles.replayTable}`}
    >
      <header className={tableStyles.roomHeader}>
        <TableHeading
          title={`回放 · 第${handNumber}局`}
          trumpRank={trumpRank}
          dealerTeam={step.dealerTeam}
          teamLevels={step.teamLevels}
        />
        <label className={styles.perspective}>
          查看座位
          <select
            value={seatIndex}
            onChange={(event) => onSeatChange(Number(event.target.value))}
          >
            {playerIds.map((player, index) => (
              <option key={player} value={index}>
                {positionLabel(index)}
                {player === accountId ? " · 本人" : ""}
              </option>
            ))}
          </select>
        </label>
      </header>
      {step.setupStage !== "play" && (
        <p className={styles.status}>{SETUP_STAGE_LABELS[step.setupStage]}</p>
      )}
      <TableSurface
        perspectiveSeat={seatIndex}
        currentActorSeat={step.currentActorSeat}
        handSizes={step.hands.map((cards) => cards.length)}
        finishPositions={step.finishPositions}
        latestPlays={step.latestPlays}
        unbeatenSeat={step.unbeatenPlay?.seatIndex}
        passedSeatIndices={step.passedSeatIndices}
        trumpRank={trumpRank}
        result={
          step.result !== undefined && (
            <p className={tableStyles.result}>
              本局结果：{resultLabel(step.result)}
            </p>
          )
        }
      >
        <section
          className={tableStyles.handPanel}
          aria-label="当前视角手牌"
          data-own-turn={
            step.result === undefined &&
            step.setupStage === "play" &&
            step.currentActorSeat === seatIndex
          }
        >
          <div className={tableStyles.handCount}>
            {positionLabel(seatIndex)} · {hand.length} 张
            {step.finishPositions[seatIndex] != null &&
              ` · 第${step.finishPositions[seatIndex]}名`}
          </div>
          <HandCards
            cards={hand}
            trumpRank={trumpRank}
            label={`${positionLabel(seatIndex)}手牌`}
            testId="replay-card"
          />
        </section>
        <details className={styles.allHands} data-testid="replay-all-hands">
          <summary>查看所有手牌</summary>
          {playerIds.map((playerId, index) => (
            <section
              key={playerId}
              aria-label={`${positionLabel(index)}全部手牌`}
            >
              <h4>
                {positionLabel(index)}
                {playerId === accountId ? " · 本人" : ""} ·{" "}
                {step.hands[index]!.length} 张
              </h4>
              <p>
                {step.finishPositions[index] != null
                  ? `第${step.finishPositions[index]}名`
                  : step.result?.caughtPlayerIds.includes(playerId)
                    ? "被捉"
                    : "未完牌"}
              </p>
              <HandCards
                cards={step.hands[index]!}
                trumpRank={trumpRank}
                label={`${positionLabel(index)}手牌`}
                testId="replay-all-card"
              />
            </section>
          ))}
        </details>
      </TableSurface>
    </div>
  );
}
export function ReplayViewer({
  accountId,
  onFailure,
  onSourceChange,
  initialSource,
  invalidLink,
  onChallenge,
  disabled,
}: ReplayViewerProps) {
  const [code, setCode] = useState(
    initialSource && "code" in initialSource ? initialSource.code : "",
  );
  const [replay, setReplay] = useState<HandReplay | undefined>();
  const [stepIndex, setStepIndex] = useState(0);
  const [seatIndex, setSeatIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    invalidLink ? "回放链接不正确，请重新输入同牌挑战码。" : "",
  );
  const [playing, setPlaying] = useState(false);
  const request = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (replay !== undefined) heading.current?.focus();
  }, [replay]);

  // The parent remounts this viewer for each account/navigation, keeping positions local.
  useEffect(() => {
    if (initialSource !== undefined) void load(initialSource);
    return () => {
      request.current++;
    };
  }, []);
  useEffect(() => {
    if (!playing || replay === undefined) return;
    if (stepIndex === replay.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(
      () => setStepIndex((value) => value + 1),
      1200,
    );
    return () => window.clearTimeout(timer);
  }, [playing, replay, stepIndex]);

  function clearReplay(value: string) {
    request.current++;
    setCode(value);
    setReplay(undefined);
    setStepIndex(0);
    setError("");
    setBusy(false);
    setPlaying(false);
    onSourceChange(undefined);
  }

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = ChallengeCodeSchema.safeParse(code.trim().toLowerCase());
    if (!parsed.success) {
      request.current++;
      setReplay(undefined);
      setStepIndex(0);
      setBusy(false);
      setError("请输入完整的 12 位回放挑战码。");
      return;
    }
    await load({ code: parsed.data });
  }

  async function load(source: ReplaySource) {
    const generation = ++request.current;
    setBusy(true);
    setError("");
    setReplay(undefined);
    setStepIndex(0);
    setPlaying(false);
    try {
      const response = await api(
        "code" in source
          ? "/replays/lookup"
          : `/rooms/${source.roomId}/hands/${source.handStartSequence}/replay`,
        HandReplayResponseEnvelopeSchema,
        "code" in source ? { code: source.code } : undefined,
      );
      if (generation === request.current) {
        setSeatIndex(
          Math.max(0, response.data.summary.playerIds.indexOf(accountId)),
        );
        setReplay(response.data);
        onSourceChange(source);
      }
    } catch (reason) {
      if (generation !== request.current) return;
      if (
        reason instanceof ApiError &&
        (reason.code === "unauthorized" || reason.code === "reload-required")
      ) {
        onFailure(reason);
        return;
      }
      setError(replayError(reason));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  }

  const step = replay?.steps[stepIndex];

  return (
    <section className={styles.viewer} aria-labelledby="replay-viewer-title">
      <div className={styles.lookupPanel}>
        <div>
          <h2 id="replay-viewer-title">查看一手牌的回放</h2>
        </div>
        <form
          className={styles.lookupForm}
          onSubmit={(event) => void lookup(event)}
        >
          <label htmlFor="replay-code">回放挑战码</label>
          <div className={styles.lookupControls}>
            <input
              id="replay-code"
              value={code}
              autoComplete="off"
              spellCheck={false}
              maxLength={12}
              onChange={(event) => clearReplay(event.target.value)}
            />
            <button type="submit" disabled={busy}>
              {busy ? "正在加载…" : "查看回放"}
            </button>
          </div>
        </form>
        {busy && (
          <p className={styles.status} role="status">
            正在加载回放…
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>

      {replay !== undefined && step !== undefined && (
        <section className={styles.replay} aria-label="牌局回放">
          <header className={styles.replayHeader}>
            <div>
              <p className={styles.eyebrow}>只读牌局</p>
              <h3 ref={heading} tabIndex={-1}>
                第 {replay.summary.handNumber} 局 ·{" "}
                {ACTIVITY_LABELS[replay.summary.activity]}
              </h3>
            </div>
            <dl className={styles.metadata}>
              <div>
                <dt>完成时间</dt>
                <dd>{completionLabel(replay.summary.completedAt)}</dd>
              </div>
            </dl>
          </header>

          <RulesSummary replay={replay} />
          <details className={styles.rules}>
            <summary>分享或再打一局</summary>
            <ChallengeShare
              key={`${replay.summary.roomId}:${replay.summary.handStartSequence}`}
              roomId={replay.summary.roomId}
              handStartSequence={replay.summary.handStartSequence}
              initialCode={replay.summary.challengeCode}
              disabled={disabled}
              onFailure={onFailure}
              onChallenge={(challengeCode) =>
                onChallenge(
                  challengeCode,
                  replay.summary.rulesConfiguration.rulesetId,
                )
              }
            />
          </details>

          <div className={styles.stepToolbar}>
            <button
              type="button"
              disabled={stepIndex === 0}
              onClick={() => {
                setPlaying(false);
                setStepIndex(0);
              }}
            >
              回到发牌
            </button>
            <button
              type="button"
              disabled={stepIndex === 0}
              onClick={() => {
                setPlaying(false);
                setStepIndex((value) => Math.max(0, value - 1));
              }}
            >
              上一步
            </button>
            <output aria-live="polite" data-testid="replay-position">
              第 {stepIndex + 1} / {replay.steps.length} 步
            </output>
            <button
              type="button"
              disabled={stepIndex === replay.steps.length - 1}
              onClick={() => {
                setPlaying(false);
                setStepIndex((value) =>
                  Math.min(replay.steps.length - 1, value + 1),
                );
              }}
            >
              下一步
            </button>
            <button
              type="button"
              disabled={stepIndex === replay.steps.length - 1}
              onClick={() => {
                setPlaying(false);
                setStepIndex(replay.steps.length - 1);
              }}
            >
              查看结算
            </button>
          </div>
          <div className={styles.playback}>
            <button
              type="button"
              disabled={stepIndex === replay.steps.length - 1}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? "暂停回放" : "自动播放"}
            </button>
            <label>
              回放进度
              <input
                type="range"
                min={1}
                max={replay.steps.length}
                value={stepIndex + 1}
                onChange={(event) => {
                  setPlaying(false);
                  setStepIndex(Number(event.target.value) - 1);
                }}
              />
            </label>
          </div>

          <ReplayTable
            replay={replay}
            step={step}
            accountId={accountId}
            seatIndex={seatIndex}
            onSeatChange={(seat) => {
              setPlaying(false);
              setSeatIndex(seat);
            }}
          />
          <ActionList step={step} trumpRank={replay.summary.trumpRank} />
        </section>
      )}
    </section>
  );
}

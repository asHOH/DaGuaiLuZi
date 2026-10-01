import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ChallengeCodeSchema,
  HandReplayResponseEnvelopeSchema,
  type HandReplay,
  type HandReplayStep,
  type RulesetId,
} from "@dglz/protocol";

import { ApiError, api } from "./api";
import { PLAY_FORM_LABELS } from "./play-feedback";
import { RULE_LABELS, RULE_VALUES } from "./RoomTable";
import { cardLabel } from "./card-display";
import { SuitIcon } from "./SuitIcon";
import { ChallengeShare } from "./ChallengeControls";
import { type ReplaySource } from "./replay-links";

import styles from "./ReplayViewer.module.css";

type ReplayViewerProps = {
  accountId: string;
  onFailure: (reason: unknown) => void;
  onSourceChange: (source: ReplaySource | undefined) => void;
  initialSource?: ReplaySource | undefined;
  invalidLink: boolean;
  onChallenge: (code: string, rulesetId: RulesetId) => Promise<void>;
  disabled: boolean;
};

const ACTIVITY_LABELS = {
  match: "比赛",
  challenge: "同牌挑战",
} as const;

const SETUP_STAGE_LABELS: Record<HandReplayStep["setupStage"], string> = {
  "tribute-selection": "进贡选牌",
  "recipient-pairing-tie": "进贡配对",
  "return-card-selection": "还牌选牌",
  "leader-selection-tie": "领牌选择",
  play: "出牌阶段",
};

const resultLabel = (result: NonNullable<HandReplayStep["result"]>) =>
  result.outcome === "draw"
    ? "平局"
    : `${result.winningTeam === 0 ? "一队" : "二队"}获胜`;

function completionLabel(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

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

function CardList({
  cards,
  label,
  testId,
}: {
  cards: readonly string[];
  label: string;
  testId?: string;
}) {
  return (
    <ul className={styles.cardList} aria-label={label}>
      {cards.map((code, index) => {
        const card = cardLabel(code);
        return (
          <li
            className={`${styles.card} ${
              card.tone === "red"
                ? styles.cardRed
                : card.tone === "joker"
                  ? styles.cardJoker
                  : styles.cardBlack
            }`}
            key={`${code}-${index}`}
          >
            <span
              role="img"
              aria-label={card.aria}
              data-testid={testId}
              title={card.aria}
            >
              {card.rank}
              {card.suit !== undefined && <SuitIcon suit={card.suit} />}
            </span>
          </li>
        );
      })}
    </ul>
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

function ActionList({ step }: { step: HandReplayStep }) {
  return (
    <section className={styles.actions} aria-labelledby="replay-actions-title">
      <h4 id="replay-actions-title">本步记录</h4>
      <ol>
        {step.actions.map((action, index) => (
          <li key={`${action.text}-${index}`}>
            <span>{action.text}</span>
            {action.cards !== undefined && (
              <CardList cards={action.cards} label="本步相关牌" />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function TableState({
  step,
  trumpRank,
}: {
  step: HandReplayStep;
  trumpRank: HandReplay["summary"]["trumpRank"];
}) {
  return (
    <section className={styles.tableState} aria-labelledby="replay-table-title">
      <div className={styles.sectionHeading}>
        <h4 id="replay-table-title">牌桌状态</h4>
        <span>{SETUP_STAGE_LABELS[step.setupStage]}</span>
      </div>
      <div className={styles.tableMeta}>
        <span>本局级牌：{trumpRank}</span>
        <span>
          当前行动：
          {step.currentActorSeat === undefined
            ? "暂无"
            : `第${step.currentActorSeat + 1}号位`}
        </span>
        <span>
          已不出：
          {step.passedSeatIndices.length === 0
            ? "暂无"
            : step.passedSeatIndices
                .map((seat) => `第${seat + 1}号位`)
                .join("、")}
        </span>
        <span>
          一队等级 {step.teamLevels[0]} · 二队等级 {step.teamLevels[1]}
        </span>
      </div>
      <div className={styles.unbeatenPlay}>
        <h5>当前出牌</h5>
        {step.unbeatenPlay === undefined ? (
          <p>当前没有未收牌型。</p>
        ) : (
          <>
            <p>
              第{step.unbeatenPlay.seatIndex + 1}号位 ·{" "}
              {PLAY_FORM_LABELS[step.unbeatenPlay.form] ??
                step.unbeatenPlay.form}
            </p>
            <CardList cards={step.unbeatenPlay.cards} label="当前出牌" />
          </>
        )}
      </div>
    </section>
  );
}

function HandsState({
  replay,
  step,
  accountId,
  useOriginalDeal,
}: {
  replay: HandReplay;
  step: HandReplayStep;
  accountId: string;
  useOriginalDeal: boolean;
}) {
  const hands = useOriginalDeal ? replay.originalDeal : step.hands;
  return (
    <section className={styles.handsState} aria-labelledby="replay-hands-title">
      <div className={styles.sectionHeading}>
        <h4 id="replay-hands-title">
          {useOriginalDeal ? "原始发牌（进贡前）" : "各座位手牌"}
        </h4>
        <span>
          {hands.reduce((total, hand) => total + hand.length, 0)} 张牌
        </span>
      </div>
      <ol className={styles.seats}>
        {replay.summary.playerIds.map((playerId, seatIndex) => {
          const hand = hands[seatIndex] ?? [];
          const finishPosition = step.finishPositions[seatIndex];
          return (
            <li className={styles.seat} key={`${playerId}-${seatIndex}`}>
              <div className={styles.seatHeading}>
                <h5>
                  第{seatIndex + 1}号位{playerId === accountId ? " · 本人" : ""}
                </h5>
                <span>{hand.length} 张</span>
              </div>
              <p>
                {finishPosition === null || finishPosition === undefined
                  ? step.result?.caughtPlayerIds.includes(playerId)
                    ? "被捉"
                    : "未完牌"
                  : `第${finishPosition}名`}
              </p>
              <CardList
                cards={hand}
                label={`第${seatIndex + 1}号位手牌`}
                testId="replay-card"
              />
            </li>
          );
        })}
      </ol>
    </section>
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
          <p className={styles.eyebrow}>完成牌局 · 只读回放</p>
          <h2 id="replay-viewer-title">查看一手牌的回放</h2>
          <p>输入同牌挑战码，按步骤回看原始发牌和每次行动。</p>
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
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
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
              {replay.summary.challengeCode !== undefined && (
                <div>
                  <dt>挑战码</dt>
                  <dd>{replay.summary.challengeCode}</dd>
                </div>
              )}
            </dl>
          </header>

          <RulesSummary replay={replay} />
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

          <ActionList step={step} />
          <TableState step={step} trumpRank={replay.summary.trumpRank} />
          <HandsState
            replay={replay}
            step={step}
            accountId={accountId}
            useOriginalDeal={stepIndex === 0}
          />
          {step.result !== undefined && (
            <h4 className={styles.result}>
              本局结果：{resultLabel(step.result)}
            </h4>
          )}
        </section>
      )}
    </section>
  );
}

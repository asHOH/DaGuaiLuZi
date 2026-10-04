import { useEffect, useRef, useState } from "react";
import {
  HandHistoryResponseEnvelopeSchema,
  type CompletedHandSummary,
} from "@dglz/protocol";

import { ApiError, api } from "./api";
import {
  ACTIVITY_LABELS,
  completionLabel,
  resultLabel,
  RULE_VALUES,
} from "./game-display";

import styles from "./HandHistory.module.css";
import controls from "./controls.module.css";

type HandHistoryProps = {
  accountId: string;
  onOpen: (hand: CompletedHandSummary) => void;
  onFailure: (reason: unknown) => void;
};

function ownFinishLabel(hand: CompletedHandSummary, accountId: string): string {
  const seatIndex = hand.playerIds.indexOf(accountId);
  if (seatIndex < 0) return "未记录";
  const position = hand.finishPositions[seatIndex];
  if (position !== null && position !== undefined) return `第${position}名`;
  return hand.result.caughtPlayerIds.includes(accountId) ? "被捉" : "未完牌";
}

function historyError(reason: unknown): string {
  const code = reason instanceof ApiError ? reason.code : "internal-error";
  return (
    {
      "not-found": "找不到已完成的牌局历史。",
      forbidden: "你无权查看这份牌局历史。",
      "unsupported-persisted-event":
        "部分牌局历史暂时无法读取，牌局版本可能已不再支持。",
      "rate-limited": "操作太频繁，请稍后再试。",
    }[code] ?? "牌局历史暂时无法加载，请重试。"
  );
}

function HandRow({
  hand,
  accountId,
  onOpen,
}: {
  hand: CompletedHandSummary;
  accountId: string;
  onOpen: (hand: CompletedHandSummary) => void;
}) {
  return (
    <li className={styles.item} data-testid="history-hand">
      <div className={styles.itemHeading}>
        <div>
          <p className={styles.eyebrow}>{ACTIVITY_LABELS[hand.activity]}</p>
          <h3>第 {hand.handNumber} 局</h3>
        </div>
        <time dateTime={new Date(hand.completedAt).toISOString()}>
          {completionLabel(hand.completedAt)}
        </time>
      </div>
      <dl className={styles.details}>
        <div>
          <dt>规则组</dt>
          <dd>
            {RULE_VALUES[hand.rulesConfiguration.rulesetId] ??
              hand.rulesConfiguration.rulesetId}
          </dd>
        </div>
        <div>
          <dt>结果</dt>
          <dd>{resultLabel(hand.result)}</dd>
        </div>
        <div>
          <dt>等级</dt>
          <dd>
            一队 {hand.teamLevels[0]} · 二队 {hand.teamLevels[1]}
          </dd>
        </div>
        <div>
          <dt>本人名次</dt>
          <dd>{ownFinishLabel(hand, accountId)}</dd>
        </div>
      </dl>
      <button
        className={`${controls.primary} ${styles.openButton}`}
        type="button"
        onClick={() => onOpen(hand)}
      >
        查看回放
      </button>
    </li>
  );
}

export function HandHistory({
  accountId,
  onOpen,
  onFailure,
}: HandHistoryProps) {
  const [hands, setHands] = useState<CompletedHandSummary[] | undefined>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);

  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  async function load() {
    const generation = ++request.current;
    setBusy(true);
    setError("");
    setHands(undefined);
    try {
      const response = await api("/history", HandHistoryResponseEnvelopeSchema);
      if (generation === request.current) setHands(response.data.hands);
    } catch (reason) {
      if (generation !== request.current) return;
      if (
        reason instanceof ApiError &&
        (reason.code === "unauthorized" || reason.code === "reload-required")
      ) {
        onFailure(reason);
        return;
      }
      setError(historyError(reason));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className={styles.history} aria-labelledby="history-title">
      <div className={styles.heading}>
        <div>
          <h2 id="history-title">已完成牌局</h2>
        </div>
        {busy && (
          <p className={styles.status} role="status">
            正在加载历史…
          </p>
        )}
      </div>
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}
      {!busy && !error && hands?.length === 0 && (
        <p className={styles.empty}>还没有完成的牌局。</p>
      )}
      {!busy && !error && hands !== undefined && hands.length > 0 && (
        <ol className={styles.list}>
          {hands.map((hand) => (
            <HandRow
              key={`${hand.roomId}:${hand.handStartSequence}`}
              hand={hand}
              accountId={accountId}
              onOpen={onOpen}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

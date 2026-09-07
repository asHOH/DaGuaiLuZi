import { useState } from "react";
import type { RoomCommandPayload, RoomViewData } from "@dglz/protocol";

import { errorMessage } from "./api";
import { PLAY_FORM_LABELS, selectionFeedback } from "./play-feedback";

import styles from "./RoomTable.module.css";

type RoomTableProps = {
  room: RoomViewData;
  accountId: string;
  locked: boolean;
  pending: boolean;
  onCommand: (payload: RoomCommandPayload) => void;
};

const POSITION_NAMES = ["一", "二", "三", "四", "五", "六"];

const SUITS: Record<string, { name: string; symbol: string }> = {
  S: { name: "黑桃", symbol: "♠" },
  H: { name: "红桃", symbol: "♥" },
  D: { name: "方块", symbol: "♦" },
  C: { name: "梅花", symbol: "♣" },
};

const RULE_LABELS: Record<string, string> = {
  rulesetId: "规则组",
  jokerPairComparison: "王牌对子比较",
  wildcardRank: "万能牌取值",
  finishingWildcardInterpretation: "出完手牌时的万能牌",
  flushTieBreaking: "同花比较",
  nextHandLeader: "下局领牌",
  tributeCardSelection: "进贡选牌",
  returnCardSelection: "还牌选牌",
  tributeRecipientPairing: "进贡配对",
  matchEnding: "比赛结束",
};

const RULE_VALUES: Record<string, string> = {
  "dglz-6p-3d-v1": "六人三副牌",
  "dglz-4p-2d-v1": "四人两副牌",
  "two-small-and-mixed-are-equal": "两张小王与混合王同级",
  "two-small-jokers-win": "两张小王胜出",
  "weakest-rank": "最弱点数",
  "strongest-rank": "最强点数",
  normal: "正常解释",
  "weakest-form-and-rank": "按最小牌型与牌点",
  "highest-card-only": "只比最大牌",
  "descending-ranks": "逐张比较",
  "first-finisher": "头游",
  "highest-tribute": "进贡最大者",
  "fair-random": "公平随机",
  "giver-choice": "进贡方选择",
  "recipient-choice": "收贡方选择",
  "giver-choice-from-candidates": "进贡方从候选中选择",
  "finish-position-by-tribute-rank": "按进贡牌点对应名次",
  "adjacent-first-automatic": "相邻优先自动配对",
  "no-failure-limit-at-5": "到 5 级不设失败上限",
  "three-failure-limit-at-5": "到 5 级三次失败结束",
};

function positionLabel(seatIndex: number): string {
  return `${POSITION_NAMES[seatIndex] ?? seatIndex + 1}号位`;
}

function memberSeatIndex(
  view: RoomViewData["view"],
  playerId: string,
): number | undefined {
  return view.seats.find((seat) => seat.playerId === playerId)?.seatIndex;
}

function cardLabel(code: string): {
  display: string;
  aria: string;
  tone: "red" | "black" | "joker";
} {
  const [face, copy] = code.split("#");
  const copyLabel = copy === undefined ? "" : `，第${copy}张`;

  if (face === "SMALL" || face === "BIG") {
    const joker = face === "SMALL" ? "小王" : "大王";
    return { display: joker, aria: `${joker}${copyLabel}`, tone: "joker" };
  }

  const suit = face?.slice(-1);
  const rank = face?.slice(0, -1) ?? "?";
  const suitInfo = suit === undefined ? undefined : SUITS[suit];
  if (suitInfo === undefined) {
    return { display: code, aria: `未知牌${copyLabel}`, tone: "black" };
  }

  return {
    display: `${rank}${suitInfo.symbol}`,
    aria: `${suitInfo.name}${rank}${copyLabel}`,
    tone: suit === "H" || suit === "D" ? "red" : "black",
  };
}

function memberDisplay(
  view: RoomViewData["view"],
  playerId: string,
  accountId: string,
): string {
  if (playerId === accountId) return "本人";
  if (playerId === view.ownerId) return "房主";
  const seatIndex = memberSeatIndex(view, playerId);
  return seatIndex === undefined ? "已加入" : positionLabel(seatIndex);
}

function rulesConfiguration(view: RoomViewData["view"]) {
  return Object.entries(view.rulesConfiguration).map(([key, value]) => (
    <div className={styles.ruleRow} key={key}>
      <dt>{RULE_LABELS[key] ?? key}</dt>
      <dd>{RULE_VALUES[value] ?? value}</dd>
    </div>
  ));
}

function SeatCard({
  accountId,
  locked,
  pending,
  seat,
  view,
  onCommand,
}: {
  accountId: string;
  locked: boolean;
  pending: boolean;
  seat: RoomViewData["view"]["seats"][number];
  view: RoomViewData["view"];
  onCommand: (payload: RoomCommandPayload) => void;
}) {
  const occupant = seat.playerId;
  const isCurrentAccount = occupant === accountId;
  const isTeamOne = seat.seatIndex % 2 === 0;
  const actionsDisabled = locked || pending;

  return (
    <li className={`${styles.seatCard} ${occupant ? styles.seatOccupied : ""}`}>
      <div className={styles.seatTopline}>
        <span className={styles.seatPosition}>
          {positionLabel(seat.seatIndex)}
        </span>
        <span className={isTeamOne ? styles.teamOne : styles.teamTwo}>
          {isTeamOne ? "一队" : "二队"}
        </span>
      </div>
      <div className={styles.seatOccupant}>
        {occupant ? (
          <>
            <span className={styles.occupantMark} aria-hidden="true">
              {isCurrentAccount ? "我" : occupant === view.ownerId ? "主" : "●"}
            </span>
            <span>
              {isCurrentAccount
                ? "本人"
                : occupant === view.ownerId
                  ? "房主"
                  : "已入座"}
            </span>
          </>
        ) : (
          <span className={styles.seatOpen}>空位</span>
        )}
      </div>
      {!occupant && (
        <button
          className={styles.seatButton}
          type="button"
          disabled={actionsDisabled}
          onClick={() =>
            onCommand({ type: "AssignSeat", seatIndex: seat.seatIndex })
          }
        >
          选择此座
        </button>
      )}
      {isCurrentAccount && (
        <span className={styles.currentSeatHint}>你的座位</span>
      )}
    </li>
  );
}

function RulesDetails({ view }: { view: RoomViewData["view"] }) {
  return (
    <details className={styles.rulesDetails}>
      <summary>
        <span>牌局规则</span>
        <span className={styles.summaryMeta}>
          {RULE_VALUES[view.rulesConfiguration.rulesetId] ??
            view.rulesConfiguration.rulesetId}
        </span>
      </summary>
      <div className={styles.rulesBody}>
        <div className={styles.policyLine}>
          <span className={styles.policyKey}>座位方式</span>
          <strong>
            {view.seatingPolicy === "fixed" ? "固定座位" : "随机座位"}
          </strong>
          {view.seatingPolicyLocked && (
            <span className={styles.lockPill}>已锁定</span>
          )}
        </div>
        <dl className={styles.ruleList}>{rulesConfiguration(view)}</dl>
      </div>
    </details>
  );
}

function LobbyView({
  accountId,
  locked,
  pending,
  view,
  onCommand,
}: {
  accountId: string;
  locked: boolean;
  pending: boolean;
  view: Extract<RoomViewData["view"], { lifecycle: "LOBBY" }>;
  onCommand: (payload: RoomCommandPayload) => void;
}) {
  const currentMember = view.members.find(
    (member) => member.playerId === accountId,
  );
  const currentSeat = memberSeatIndex(view, accountId);
  const actionsDisabled = locked || pending;
  const requiredSeatCount = view.seats.length;

  return (
    <div className={styles.lobbyLayout}>
      <section className={styles.lobbyMain} aria-labelledby="lobby-title">
        {view.matchSummary !== undefined && (
          <section className={styles.result} aria-label="比赛结果">
            <h3>
              {view.matchSummary.outcome === "completed"
                ? "比赛结束"
                : "比赛已终止"}
            </h3>
            <p>
              {view.matchSummary.outcome === "completed" &&
                `${view.matchSummary.winningTeam === 0 ? "一队" : "二队"}获胜 · `}
              已完成 {view.matchSummary.completedHandCount} 局 · 一队等级{" "}
              {view.matchSummary.teamLevels[0]} · 二队等级{" "}
              {view.matchSummary.teamLevels[1]}
            </p>
          </section>
        )}
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>房间大厅</p>
            <h2 id="lobby-title">等人开局</h2>
          </div>
          <span className={styles.seatCount}>
            {view.members.length} / {requiredSeatCount} 位成员
          </span>
        </div>

        <ol className={styles.seatGrid} aria-label="房间座位">
          {view.seats.map((seat) => (
            <SeatCard
              accountId={accountId}
              key={seat.seatIndex}
              locked={locked}
              pending={pending}
              seat={seat}
              view={view}
              onCommand={onCommand}
            />
          ))}
        </ol>

        <div className={styles.lobbyActions}>
          {view.ownerId === accountId &&
            view.selectedActivity === undefined && (
              <button
                className={styles.primaryButton}
                type="button"
                disabled={actionsDisabled}
                onClick={() => onCommand({ type: "SelectMatch" })}
              >
                选择比赛
              </button>
            )}
          {view.ownerId === accountId && view.selectedActivity === "match" && (
            <span className={styles.selectionNotice}>
              已选择比赛，等大家准备
            </span>
          )}
          {currentSeat !== undefined && currentMember !== undefined && (
            <button
              className={
                currentMember.ready
                  ? styles.secondaryButton
                  : styles.readyButton
              }
              type="button"
              disabled={actionsDisabled}
              onClick={() =>
                onCommand({ type: "SetReadiness", ready: !currentMember.ready })
              }
            >
              {currentMember.ready ? "取消准备" : "准备就绪"}
            </button>
          )}
          {currentSeat === undefined && (
            <span className={styles.actionHint}>
              先选择一个座位，再准备开局
            </span>
          )}
        </div>
      </section>

      <aside className={styles.lobbyAside} aria-label="房间状态">
        <section
          className={styles.readinessPanel}
          aria-labelledby="readiness-title"
        >
          <div className={styles.panelHeading}>
            <h3 id="readiness-title">成员状态</h3>
            <span>
              {view.members.filter((member) => member.ready).length} 人已准备
            </span>
          </div>
          <ul className={styles.memberList}>
            {view.members
              .slice()
              .sort((first, second) => first.joinOrder - second.joinOrder)
              .map((member) => {
                const seatIndex = memberSeatIndex(view, member.playerId);
                return (
                  <li className={styles.memberRow} key={member.playerId}>
                    <span className={styles.memberName}>
                      <span className={styles.memberDot} aria-hidden="true" />
                      {memberDisplay(view, member.playerId, accountId)}
                    </span>
                    <span className={styles.memberSeat}>
                      {seatIndex === undefined
                        ? "待选座"
                        : positionLabel(seatIndex)}
                    </span>
                    <span
                      className={
                        member.ready ? styles.readyState : styles.waitingState
                      }
                    >
                      {member.ready ? "已准备" : "未准备"}
                    </span>
                  </li>
                );
              })}
          </ul>
        </section>
        <RulesDetails view={view} />
      </aside>
    </div>
  );
}

function ActiveView({
  view,
  accountId,
  locked,
  pending,
  onCommand,
}: {
  view: Extract<RoomViewData["view"], { lifecycle: "ACTIVE" }>;
  accountId: string;
  locked: boolean;
  pending: boolean;
  onCommand: (payload: RoomCommandPayload) => void;
}) {
  const handKey = view.hand.join(",");
  const [selection, setSelection] = useState({
    handKey,
    cards: [] as typeof view.hand,
  });
  // A committed hand change or settlement invalidates selection; socket updates alone do not.
  const selected =
    selection.handKey === handKey && view.handResult === undefined
      ? selection.cards
      : [];
  const canSelect =
    !locked &&
    !pending &&
    view.handResult === undefined &&
    view.setupStage === "play";
  const canAct = canSelect && view.currentActor === accountId;
  const feedback =
    selected.length === 0 ? undefined : selectionFeedback(view, selected);
  const currentActorSeat = view.seats.find(
    (seat) => seat.playerId === view.currentActor,
  )?.seatIndex;

  return (
    <div className={styles.activeLayout}>
      <section className={styles.tableStage} aria-labelledby="table-title">
        <div className={styles.tableHeading}>
          <div>
            <p className={styles.eyebrow}>
              牌局 · 第{" "}
              {view.handNumber ??
                view.completedHandCount +
                  (view.handResult === undefined ? 1 : 0)}{" "}
              局
            </p>
            <h2 id="table-title">
              {view.handResult === undefined ? "轮流出牌" : "本局已结算"}
            </h2>
          </div>
          <div className={styles.trumpBadge}>
            <span>当前级牌</span>
            <strong>{view.trumpRank}</strong>
          </div>
        </div>

        <ol className={styles.tableSeats} aria-label="牌桌座位">
          {view.seats.map((seat) => {
            const isActor = seat.seatIndex === currentActorSeat;
            const isCurrent = seat.playerId === accountId;
            return (
              <li
                className={`${styles.tableSeat} ${isActor ? styles.tableSeatActor : ""}`}
                key={seat.seatIndex}
              >
                <span className={styles.tableSeatPosition}>
                  {positionLabel(seat.seatIndex)}
                </span>
                <span className={styles.tableSeatTeam}>
                  {seat.seatIndex % 2 === 0 ? "一队" : "二队"}
                </span>
                <span className={styles.tableSeatName}>
                  {isCurrent ? "本人" : seat.playerId ? "已入座" : "空位"}
                  {view.finishPositions[seat.seatIndex] != null
                    ? ` · 第${view.finishPositions[seat.seatIndex]}名`
                    : ` · ${view.handSizes[seat.seatIndex] ?? 0}张`}
                </span>
                {isActor && <span className={styles.actorTag}>当前行动</span>}
              </li>
            );
          })}
        </ol>

        <div className={styles.currentPlay} aria-label="当前出牌">
          {view.unbeatenPlay === undefined ? (
            <p>
              {view.handResult === undefined ? "新一轮领牌" : "本局出牌结束"}
            </p>
          ) : (
            <>
              <p>
                {positionLabel(view.unbeatenPlay.seatIndex)}出牌 ·{" "}
                {PLAY_FORM_LABELS[view.unbeatenPlay.form]}
              </p>
              <ul className={styles.playCards}>
                {view.unbeatenPlay.cards.map((code) => {
                  const card = cardLabel(code);
                  return (
                    <li
                      key={code}
                      className={`${styles.card} ${card.tone === "red" ? styles.cardRed : card.tone === "joker" ? styles.cardJoker : styles.cardBlack}`}
                      aria-label={card.aria}
                    >
                      {card.display}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className={styles.tableMeta}>
          <span>
            一队等级 <strong>{view.teamLevels[0]}</strong>
          </span>
          <span>
            二队等级 <strong>{view.teamLevels[1]}</strong>
          </span>
          <span>
            当前行动{" "}
            <strong>
              {currentActorSeat === undefined
                ? "等待中"
                : positionLabel(currentActorSeat)}
            </strong>
          </span>
        </div>

        {view.handResult !== undefined && (
          <section className={styles.result} aria-label="本局结果">
            <h3>本局结束</h3>
            <p>
              {view.handResult.outcome === "draw"
                ? "本局平局"
                : `${view.handResult.winningTeam === 0 ? "一队" : "二队"}获胜`}
            </p>
            <p>
              下局庄队：{view.handResult.nextDealerTeam === 0 ? "一队" : "二队"}
              {view.handResult.caughtPlayerIds.length > 0 &&
                ` · 被捉：${view.handResult.caughtPlayerIds.map((id) => positionLabel(memberSeatIndex(view, id)!)).join("、")}`}
            </p>
          </section>
        )}
      </section>

      <section className={styles.handPanel} aria-labelledby="hand-title">
        <div className={styles.handHeading}>
          <div>
            <p className={styles.eyebrow}>只对你可见</p>
            <h2 id="hand-title">你的手牌</h2>
          </div>
          <span className={styles.handCount}>{view.hand.length} 张</span>
        </div>
        <ul
          className={styles.hand}
          aria-label={`${accountId === view.currentActor ? "当前行动，" : ""}你的手牌`}
        >
          {view.hand.map((code) => {
            const card = cardLabel(code);
            const cardClass =
              card.tone === "red"
                ? styles.cardRed
                : card.tone === "joker"
                  ? styles.cardJoker
                  : styles.cardBlack;
            return (
              <li key={code}>
                <button
                  type="button"
                  className={`${styles.card} ${cardClass} ${selected.includes(code) ? styles.cardSelected : ""}`}
                  data-card={code}
                  data-testid="hand-card"
                  aria-label={card.aria}
                  aria-pressed={selected.includes(code)}
                  disabled={!canSelect}
                  onClick={() =>
                    setSelection({
                      handKey,
                      cards: selected.includes(code)
                        ? selected.filter((card) => card !== code)
                        : [...selected, code],
                    })
                  }
                >
                  <span aria-hidden="true">{card.display}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {view.handResult === undefined && (
          <>
            <p className={styles.handNote} aria-live="polite">
              {feedback === undefined
                ? "点选手牌，也可用 Tab 切换、空格选择。"
                : feedback.ok
                  ? `已选 ${selected.length} 张 · ${PLAY_FORM_LABELS[feedback.play.form]} · ${feedback.play.rank === "BIG" ? "大王" : feedback.play.rank === "SMALL" ? "小王" : feedback.play.rank}`
                  : errorMessage("domain-rejected", feedback.reason)}
            </p>
            <div className={styles.playActions}>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!canAct || feedback?.ok !== true}
                onClick={() => onCommand({ type: "Play", cards: selected })}
              >
                出牌
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={!canAct || view.unbeatenPlay === undefined}
                onClick={() => onCommand({ type: "Pass" })}
              >
                不出
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={!canSelect || selected.length === 0}
                onClick={() => setSelection({ handKey, cards: [] })}
              >
                清空选择
              </button>
              <span className={styles.handNote}>
                {locked
                  ? "正在同步牌局…"
                  : pending
                    ? "正在提交…"
                    : view.currentActor === accountId
                      ? "轮到你了"
                      : "等待其他玩家出牌"}
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function RoomTable({
  room,
  accountId,
  locked,
  pending,
  onCommand,
}: RoomTableProps) {
  const lifecycleLabel =
    room.view.lifecycle === "LOBBY" ? "大厅" : "牌局进行中";

  return (
    <section className={styles.roomTable}>
      <header className={styles.roomHeader}>
        <span className={styles.lifecycle} data-testid="room-lifecycle">
          {lifecycleLabel}
        </span>
      </header>

      {room.view.lifecycle === "LOBBY" ? (
        <LobbyView
          accountId={accountId}
          locked={locked}
          pending={pending}
          view={room.view}
          onCommand={onCommand}
        />
      ) : (
        <ActiveView
          key={`${room.view.roomId}:${accountId}:${room.view.handNumber ?? room.view.completedHandCount + (room.view.handResult === undefined ? 1 : 0)}`}
          accountId={accountId}
          view={room.view}
          locked={locked}
          pending={pending}
          onCommand={onCommand}
        />
      )}
    </section>
  );
}

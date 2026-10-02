import { useState, type ReactNode } from "react";
import {
  RulesConfigurationSchema,
  SeatingPolicySchema,
  rulesConfigurationPreset,
  type RoomCommandPayload,
  type RoomViewData,
} from "@dglz/protocol";

import { PLAY_FORM_LABELS, selectionFeedback } from "./play-feedback";
import { ChallengeEntry, ChallengeShare } from "./ChallengeControls";
import { cardLabel, groupCards } from "./card-display";
import { RULE_LABELS, RULE_VALUES } from "./game-display";
import { SuitIcon } from "./SuitIcon";

import styles from "./RoomTable.module.css";

type RoomTableProps = {
  room: RoomViewData;
  accountId: string;
  locked: boolean;
  pending: boolean;
  onCommand: (payload: RoomCommandPayload) => void;
  onFailure?: ((reason: unknown) => void) | undefined;
  accountStatus?: ReactNode;
};

const POSITION_NAMES = ["一", "二", "三", "四", "五", "六"];

function positionLabel(seatIndex: number): string {
  return `${POSITION_NAMES[seatIndex] ?? seatIndex + 1}号位`;
}

function memberSeatIndex(
  view: RoomViewData["view"],
  playerId: string,
): number | undefined {
  return view.seats.find((seat) => seat.playerId === playerId)?.seatIndex;
}

function CardFace({ code }: { code: string }) {
  const card = cardLabel(code);
  return (
    <span
      className={styles.cardFace}
      data-red={card.red}
      data-joker={card.tone === "joker"}
      aria-hidden="true"
    >
      <span className={styles.cardCorner}>
        <span className={styles.cardRank}>{card.rank}</span>
        {card.suit !== undefined && (
          <span className={styles.cardSuit}>
            <SuitIcon suit={card.suit} />
          </span>
        )}
      </span>
      {card.suit !== undefined && (
        <span className={styles.cardPip}>
          <SuitIcon suit={card.suit} />
        </span>
      )}
    </span>
  );
}

function rulesConfiguration(
  configuration: RoomViewData["view"]["rulesConfiguration"],
) {
  return Object.entries(configuration)
    .filter(([key]) => key !== "rulesetId")
    .map(([key, value]) => (
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
  const ready = view.members.find(
    (member) => member.playerId === occupant,
  )?.ready;

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
            <span>
              {isCurrentAccount
                ? occupant === view.ownerId
                  ? "本人 · 房主"
                  : "本人"
                : occupant === view.ownerId
                  ? "房主"
                  : "已入座"}
            </span>
            <span className={ready ? styles.readyState : styles.waitingState}>
              {ready ? "已准备" : "未准备"}
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
        <>
          <button
            className={styles.seatButton}
            type="button"
            disabled={actionsDisabled}
            onClick={() => onCommand({ type: "RemoveSeat" })}
          >
            离座
          </button>
          <span className={styles.currentSeatHint}>离座将取消准备</span>
        </>
      )}
    </li>
  );
}

function RulesDetails({
  view,
  disabled,
  onCommand,
}: {
  view: RoomViewData["view"];
  disabled: boolean;
  onCommand?: RoomTableProps["onCommand"];
}) {
  const { rulesetId: _rulesetId, ...ruleFields } =
    RulesConfigurationSchema.options.find(
      (schema) =>
        schema.shape.rulesetId.value === view.rulesConfiguration.rulesetId,
    )!.shape;
  const configuration =
    view.selectedActivity === "challenge" &&
    "effectiveRulesConfiguration" in view
      ? (view.effectiveRulesConfiguration ?? view.rulesConfiguration)
      : view.rulesConfiguration;
  return (
    <details className={styles.rulesDetails}>
      <summary>
        <span>牌局规则</span>
        <span className={styles.summaryMeta}>
          {RULE_VALUES[configuration.rulesetId] ?? configuration.rulesetId}
        </span>
      </summary>
      <div className={styles.rulesBody}>
        {onCommand !== undefined && !view.seatingPolicyLocked ? (
          <label className={styles.ruleField}>
            座位安排
            <select
              aria-label="座位安排"
              value={view.seatingPolicy}
              disabled={disabled}
              onChange={(event) =>
                onCommand({
                  type: "ReplaceSeatingPolicy",
                  seatingPolicy: SeatingPolicySchema.parse(event.target.value),
                })
              }
            >
              <option value="fixed">固定座位</option>
              <option value="randomized">开局随机分配</option>
            </select>
          </label>
        ) : (
          <div className={styles.policyLine}>
            <span className={styles.policyKey}>座位方式</span>
            <strong>
              {view.seatingPolicy === "fixed" ? "固定座位" : "随机座位"}
            </strong>
            {view.seatingPolicyLocked && (
              <span className={styles.lockPill}>已锁定</span>
            )}
          </div>
        )}
        {onCommand === undefined ||
        view.matchRulesConfigurationLocked ||
        view.selectedActivity === "challenge" ? (
          <dl className={styles.ruleList}>
            {rulesConfiguration(configuration)}
          </dl>
        ) : (
          <fieldset className={styles.ruleEditor} disabled={disabled}>
            <legend>设置牌局规则</legend>
            <div className={styles.playActions}>
              {(["省心", "自主"] as const).map((preset) => {
                const configuration = rulesConfigurationPreset(
                  view.rulesConfiguration.rulesetId,
                  preset,
                );
                return (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    key={preset}
                    disabled={Object.entries(configuration).every(
                      ([key, value]) =>
                        value ===
                        view.rulesConfiguration[
                          key as keyof typeof view.rulesConfiguration
                        ],
                    )}
                    onClick={() =>
                      onCommand({
                        type: "ReplaceMatchRulesConfiguration",
                        rulesConfiguration: configuration,
                      })
                    }
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            {Object.entries(ruleFields).map(([key, schema]) => (
              <label className={styles.ruleField} key={key}>
                {RULE_LABELS[key]}
                <select
                  value={
                    view.rulesConfiguration[
                      key as keyof typeof view.rulesConfiguration
                    ]
                  }
                  onChange={(event) =>
                    onCommand({
                      type: "ReplaceMatchRulesConfiguration",
                      rulesConfiguration: RulesConfigurationSchema.parse({
                        ...view.rulesConfiguration,
                        [key]: event.target.value,
                      }),
                    })
                  }
                >
                  {schema.options.map((option) => (
                    <option key={option} value={option}>
                      {RULE_VALUES[option]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
        )}
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
  onFailure,
}: {
  accountId: string;
  locked: boolean;
  pending: boolean;
  view: Extract<RoomViewData["view"], { lifecycle: "LOBBY" }>;
  onCommand: (payload: RoomCommandPayload) => void;
  onFailure: RoomTableProps["onFailure"];
}) {
  const currentMember = view.members.find(
    (member) => member.playerId === accountId,
  );
  const currentSeat = memberSeatIndex(view, accountId);
  const actionsDisabled = locked || pending;
  const requiredSeatCount = view.seats.length;
  const unseatedMembers = view.members.filter(
    (member) => memberSeatIndex(view, member.playerId) === undefined,
  );

  return (
    <div className={styles.lobbyLayout}>
      <section className={styles.lobbyMain} aria-labelledby="lobby-title">
        {view.challengeSummary !== undefined && (
          <section className={styles.result} aria-label="同牌挑战结果">
            <h3>同牌挑战已完成</h3>
            <p>
              {view.challengeSummary.result.outcome === "draw"
                ? "本局平局"
                : `${view.challengeSummary.result.winningTeam === 0 ? "一队" : "二队"}获胜`}
            </p>
            {view.challengeSummary.handStartSequence !== undefined && (
              <ChallengeShare
                key={view.challengeSummary.handStartSequence}
                roomId={view.roomId}
                handStartSequence={view.challengeSummary.handStartSequence}
                disabled={actionsDisabled}
                onFailure={onFailure}
              />
            )}
          </section>
        )}
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
          <h2 id="lobby-title">等人开局</h2>
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
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={actionsDisabled}
            onClick={() => onCommand({ type: "LeaveRoom" })}
          >
            {view.members.length === 1 ? "退出并关闭房间" : "退出房间"}
          </button>
          {view.ownerId === accountId && view.selectedActivity !== "match" && (
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
          {view.selectedActivity === "challenge" && (
            <span className={styles.selectionNotice}>
              已选择同牌挑战 · 只打一局
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
        {view.selectedActivity === "challenge" &&
          view.teamLevels !== undefined && (
            <p>
              一队等级 {view.teamLevels[0]} · 二队等级 {view.teamLevels[1]} ·
              当前级牌 {view.trumpRank}
            </p>
          )}
        {view.ownerId === accountId && (
          <ChallengeEntry
            disabled={actionsDisabled}
            onCommand={onCommand}
            onFailure={onFailure}
          />
        )}
      </section>

      <aside className={styles.lobbyAside} aria-label="房间状态">
        {unseatedMembers.length > 0 && (
          <section
            className={styles.readinessPanel}
            aria-labelledby="readiness-title"
          >
            <div className={styles.panelHeading}>
              <h3 id="readiness-title">待入座</h3>
            </div>
            <ul className={styles.memberList}>
              {unseatedMembers
                .slice()
                .sort((first, second) => first.joinOrder - second.joinOrder)
                .map((member) => {
                  return (
                    <li className={styles.memberRow} key={member.playerId}>
                      <span className={styles.memberName}>
                        {member.playerId === accountId
                          ? member.playerId === view.ownerId
                            ? "本人 · 房主"
                            : "本人"
                          : member.playerId === view.ownerId
                            ? "房主"
                            : "已加入"}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </section>
        )}
        <RulesDetails
          view={view}
          disabled={actionsDisabled}
          {...(view.ownerId === accountId ? { onCommand } : {})}
        />
        <div className={styles.rulesBody}>
          <p className={styles.actionHint}>
            {view.members.length === 1
              ? "退出后房间关闭，已完成的牌局记录仍可查看。"
              : view.ownerId === accountId
                ? "退出后，房主由最早加入的其余成员接任。"
                : "退出后将腾出座位，并取消你的准备状态。"}
          </p>
        </div>
      </aside>
    </div>
  );
}

function PreviousHand({
  summary,
  roomId,
  disabled,
  onFailure,
}: {
  summary: NonNullable<RoomViewData["view"]["lastHandResult"]>;
  roomId: string;
  disabled: boolean;
  onFailure: RoomTableProps["onFailure"];
}) {
  const [open, setOpen] = useState(true);
  return (
    <section
      className={`${styles.result} ${styles.previousHand}`}
      aria-label="上一局结果"
    >
      <button
        type="button"
        className={styles.secondaryButton}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? "收起上一局结果" : "上一局结果"}
      </button>
      {open && (
        <>
          <h3>第 {summary.handNumber} 局</h3>
          <p>
            {summary.result.outcome === "draw"
              ? "本局平局"
              : `${summary.result.winningTeam === 0 ? "一队" : "二队"}获胜`}{" "}
            · 一队等级 {summary.teamLevels[0]} · 二队等级{" "}
            {summary.teamLevels[1]}
          </p>
          <p>
            {summary.seats
              .map(
                (seat) =>
                  `${positionLabel(seat.seatIndex)}：${summary.finishPositions[seat.seatIndex] == null ? (seat.playerId !== undefined && summary.result.caughtPlayerIds.includes(seat.playerId) ? "被捉" : "未完牌") : `第${summary.finishPositions[seat.seatIndex]}名`}`,
              )
              .join(" · ")}
          </p>
          {summary.handStartSequence !== undefined && (
            <ChallengeShare
              key={summary.handStartSequence}
              roomId={roomId}
              handStartSequence={summary.handStartSequence}
              disabled={disabled}
              onFailure={onFailure}
            />
          )}
        </>
      )}
    </section>
  );
}

type ActivePlayerView = Extract<RoomViewData["view"], { lifecycle: "ACTIVE" }>;

function TieChoice({
  view,
  accountId,
  disabled,
  onCommand,
}: {
  view: ActivePlayerView;
  accountId: string;
  disabled: boolean;
  onCommand: RoomTableProps["onCommand"];
}) {
  const [candidate, setCandidate] = useState("");
  const submitted = view.tieSubmittedPlayerIds?.includes(accountId);
  const canVote = view.pendingPlayerIds.includes(accountId);
  return (
    <>
      <h3>
        {view.tieKind === "recipient-pairing" ? "选择接贡方" : "选择首家"} · 第{" "}
        {view.tieRound} 轮
      </h3>
      {submitted ? (
        <p role="status">
          已提交，等待其他玩家（你的选择：
          {view.tieOwnBallot == null
            ? "放弃"
            : positionLabel(memberSeatIndex(view, view.tieOwnBallot)!)}
          ）
        </p>
      ) : canVote ? (
        <div className={styles.playActions}>
          <label>
            {view.tieKind === "recipient-pairing" ? "配对选择" : "首家选择"}
            <select
              disabled={disabled}
              value={candidate}
              onChange={(event) => setCandidate(event.target.value)}
            >
              <option value="">放弃</option>
              {view.tieCandidateIds?.map((id) => (
                <option key={id} value={id}>
                  {positionLabel(memberSeatIndex(view, id)!)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={disabled}
            onClick={() => {
              if (view.tieKind !== undefined && view.tieRound !== undefined)
                onCommand({
                  type: "SubmitTieChoiceBallot",
                  tieKind: view.tieKind,
                  round: view.tieRound,
                  candidateId: candidate || null,
                });
            }}
          >
            提交选择
          </button>
          <p>本轮提交后不可更改；所有人提交后公开。最多三轮。</p>
        </div>
      ) : (
        <p>等待其他玩家选择</p>
      )}
    </>
  );
}

function handSetup(view: ActivePlayerView, accountId: string) {
  const pendingActor = view.pendingPlayerIds[0];
  const ownSetupTurn = view.pendingPlayerIds.includes(accountId);
  const offer =
    view.setupStage === "return-card-selection"
      ? view.returnCandidates.find(
          (candidate) => candidate.giverId === pendingActor,
        )
      : undefined;
  const transfer =
    view.setupStage === "return-card-selection"
      ? view.tributeTransfers.find(
          (candidate) => candidate.recipientId === pendingActor,
        )
      : undefined;
  const configuration =
    view.selectedActivity === "challenge"
      ? view.effectiveRulesConfiguration
      : view.rulesConfiguration;
  const candidateCount =
    transfer !== undefined &&
    configuration.rulesetId === "dglz-6p-3d-v1" &&
    configuration.returnCardSelection === "giver-choice-from-candidates"
      ? transfer.rank === "BIG"
        ? 3
        : transfer.rank === "SMALL"
          ? 2
          : 0
      : 0;
  const tributeSelection =
    view.setupStage === "tribute-selection" && ownSetupTurn;
  const returnSelection =
    view.setupStage === "return-card-selection" &&
    ownSetupTurn &&
    offer === undefined;
  return {
    ownSetupTurn,
    offer,
    transfer,
    candidateCount,
    tributeSelection,
    returnSelection,
  };
}

function SetupChoices({
  view,
  accountId,
  disabled,
  setup,
  selected,
  onSelect,
  onCommand,
}: {
  view: ActivePlayerView;
  accountId: string;
  disabled: boolean;
  setup: ReturnType<typeof handSetup>;
  selected: ActivePlayerView["hand"];
  onSelect: (cards: ActivePlayerView["hand"]) => void;
  onCommand: RoomTableProps["onCommand"];
}) {
  const {
    ownSetupTurn,
    offer,
    transfer,
    candidateCount,
    tributeSelection,
    returnSelection,
  } = setup;
  return (
    <>
      {view.setupStage !== "play" && view.handResult === undefined && (
        <section className={styles.setupChoices} aria-label="开局选择">
          {view.tieKind !== undefined ? (
            <TieChoice
              key={`${view.tieKind}:${view.tieRound}:${view.tieCandidateIds?.join(",")}`}
              view={view}
              accountId={accountId}
              disabled={disabled}
              onCommand={onCommand}
            />
          ) : tributeSelection ? (
            <>
              <h3>选择进贡牌</h3>
              <p>请选择一张可进贡的最高牌。</p>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={disabled || selected.length !== 1}
                onClick={() =>
                  onCommand({ type: "SelectTributeCard", card: selected[0]! })
                }
              >
                确认进贡
              </button>
            </>
          ) : returnSelection ? (
            <>
              <h3>{candidateCount > 0 ? "提供还牌候选" : "选择还牌"}</h3>
              {transfer !== undefined && (
                <p>
                  收到{positionLabel(transfer.giverSeat)}的贡牌：
                  {cardLabel(transfer.card).display}
                </p>
              )}
              <p>
                {candidateCount > 0
                  ? `请选择 ${candidateCount} 张不同点数的手牌，由进贡方选回一张。`
                  : "请选择一张手牌还给进贡方，也可归还收到的贡牌。"}
              </p>
              <p>已选 {selected.length} 张</p>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={
                  disabled ||
                  (candidateCount > 0
                    ? selected.length !== candidateCount ||
                      new Set(
                        selected.map((code) =>
                          code.split("#")[0]!.replace(/[SHDC]$/, ""),
                        ),
                      ).size !== candidateCount
                    : selected.length !== 1)
                }
                onClick={() =>
                  onCommand(
                    candidateCount > 0
                      ? {
                          type: "OfferReturnCandidates",
                          candidateCards: selected,
                        }
                      : { type: "SelectReturnCard", card: selected[0]! },
                  )
                }
              >
                {candidateCount > 0 ? "提交还牌候选" : "确认还牌"}
              </button>
            </>
          ) : ownSetupTurn && offer !== undefined ? (
            <>
              <h3>从候选中选择还牌</h3>
              <p>
                {positionLabel(offer.recipientSeat)}
                已提供候选牌，点选一张并确认收回。
              </p>
              <ul className={styles.candidateCards}>
                {offer.candidateCards.map((code) => {
                  const card = cardLabel(code);
                  return (
                    <li key={code}>
                      <button
                        type="button"
                        data-testid="return-candidate"
                        data-card={code}
                        aria-label={card.aria}
                        aria-pressed={selected.includes(code)}
                        className={`${styles.card} ${selected.includes(code) ? styles.cardSelected : ""}`}
                        disabled={disabled}
                        onClick={() => onSelect([code])}
                      >
                        <CardFace code={code} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={disabled || selected.length !== 1}
                onClick={() =>
                  onCommand({ type: "SelectReturnCard", card: selected[0]! })
                }
              >
                确认还牌
              </button>
            </>
          ) : (
            <p role="status">
              {(view.setupStage === "tribute-selection" &&
                view.lastHandResult?.result.caughtPlayerIds.includes(
                  accountId,
                )) ||
              offer?.recipientId === accountId
                ? "已提交，等待其他玩家"
                : "等待其他玩家完成开局选择"}
            </p>
          )}
        </section>
      )}
    </>
  );
}

function HandControls({
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
  const setup = handSetup(view, accountId);
  const { offer, transfer, candidateCount, tributeSelection, returnSelection } =
    setup;
  const handKey = `${view.hand.join(",")}:${view.setupStage}:${view.pendingPlayerIds.includes(accountId)}:${offer?.tributeCard ?? transfer?.card ?? ""}`;
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
    (view.setupStage === "play" || tributeSelection || returnSelection);
  const isOwnTurn =
    view.handResult === undefined &&
    view.setupStage === "play" &&
    view.currentActor === accountId;
  const canAct = canSelect && isOwnTurn;
  const feedback =
    selected.length === 0 || view.setupStage !== "play"
      ? undefined
      : selectionFeedback(view, selected);
  const ownSeat = memberSeatIndex(view, accountId) ?? 0;
  const handGroups = groupCards(view.hand, view.trumpRank);
  return (
    <section
      className={styles.handPanel}
      aria-label="你的手牌"
      data-own-turn={isOwnTurn}
      data-selection-state={
        feedback?.ok
          ? "playable"
          : feedback?.reason === "response-not-stronger"
            ? "beaten"
            : "incomplete"
      }
      aria-description={isOwnTurn ? "轮到你出牌" : undefined}
    >
      <div className={styles.handToolbar}>
        <span
          className={styles.handCount}
          aria-live="polite"
          aria-atomic="true"
        >
          <span data-testid="remaining-count">
            {view.handSizes[ownSeat] ?? 0} 张
          </span>
          {view.finishPositions[ownSeat] != null &&
            ` · 第${view.finishPositions[ownSeat]}名`}
        </span>
        {view.handResult === undefined && view.setupStage === "play" && (
          <div className={styles.playActions}>
            {isOwnTurn && (
              <>
                <button
                  type="button"
                  className={`${styles.primaryButton} ${styles.playButton}`}
                  disabled={!canAct || feedback?.ok !== true}
                  onClick={() => onCommand({ type: "Play", cards: selected })}
                >
                  出牌
                </button>
                {view.unbeatenPlay !== undefined && (
                  <button
                    type="button"
                    className={`${styles.primaryButton} ${styles.passButton}`}
                    disabled={!canAct}
                    onClick={() => onCommand({ type: "Pass" })}
                  >
                    不出
                  </button>
                )}
              </>
            )}
            {selected.length > 0 && (
              <span className={styles.clearSelection}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={!canSelect}
                  onClick={() => setSelection({ handKey, cards: [] })}
                >
                  清空选择
                </button>
              </span>
            )}
          </div>
        )}
      </div>
      {view.handResult === undefined && view.setupStage === "play" && (
        <p className={styles.handNote} aria-live="polite">
          {selected.length === 5 && feedback?.ok
            ? PLAY_FORM_LABELS[feedback.play.form]
            : null}
        </p>
      )}
      <div className={styles.handScroll}>
        <ul className={styles.hand} aria-label="你的手牌">
          {handGroups.map((group) => (
            <li key={group.rank} data-rank={group.rank}>
              <ul className={styles.rankGroup}>
                {group.cards.map((code) => {
                  const card = cardLabel(code);
                  return (
                    <li key={code}>
                      <button
                        type="button"
                        className={`${styles.card} ${selected.includes(code) ? styles.cardSelected : ""}`}
                        data-card={code}
                        data-testid="hand-card"
                        aria-label={card.aria}
                        aria-pressed={selected.includes(code)}
                        disabled={
                          !canSelect ||
                          (tributeSelection &&
                            !view.eligibleTributeCards.includes(code))
                        }
                        onClick={() =>
                          setSelection({
                            handKey,
                            cards: selected.includes(code)
                              ? selected.filter((card) => card !== code)
                              : view.setupStage !== "play" &&
                                  candidateCount === 0
                                ? [code]
                                : [...selected, code],
                          })
                        }
                      >
                        <CardFace code={code} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
      <SetupChoices
        view={view}
        accountId={accountId}
        disabled={locked || pending}
        setup={setup}
        selected={selected}
        onSelect={(cards) => setSelection({ handKey, cards })}
        onCommand={onCommand}
      />
      {view.tieResolvedRounds !== undefined &&
        view.tieResolvedRounds.length > 0 && (
          <details>
            <summary>已公开的选择结果</summary>
            {view.tieResolvedRounds.map((round, index) => (
              <div key={index}>
                <p>
                  {round.tieKind === "recipient-pairing"
                    ? "进贡配对"
                    : "首家选择"}{" "}
                  · 第 {round.round} 轮
                  {round.fallback ? " · 已使用三轮后规则" : ""}
                </p>
                <p>
                  {round.ballots
                    .map(
                      (ballot) =>
                        `${positionLabel(memberSeatIndex(view, ballot.voterId)!)}：${ballot.candidateId === null ? "放弃" : positionLabel(memberSeatIndex(view, ballot.candidateId)!)}`,
                    )
                    .join(" · ")}
                </p>
                {round.committedPairs.map((pair) => (
                  <p key={pair.giverId}>
                    {positionLabel(pair.giverSeat)} →{" "}
                    {positionLabel(pair.recipientSeat)}
                  </p>
                ))}
                {round.selectedLeaderId !== undefined && (
                  <p>
                    首家：
                    {positionLabel(
                      memberSeatIndex(view, round.selectedLeaderId)!,
                    )}
                  </p>
                )}
              </div>
            ))}
          </details>
        )}
    </section>
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
  const currentActorSeat = view.seats.find(
    (seat) => seat.playerId === view.currentActor,
  )?.seatIndex;
  const ownSeat = memberSeatIndex(view, accountId) ?? 0;
  return (
    <div className={styles.activeLayout}>
      <section className={styles.tableStage} aria-label="牌桌">
        <ol
          className={styles.tableSeats}
          data-player-count={view.seats.length}
          aria-label="牌桌座位"
        >
          {view.seats.map((seat) => {
            const isActor = seat.seatIndex === currentActorSeat;
            const isCurrent = seat.playerId === accountId;
            const play = view.latestPlays.find(
              (play) => play.seatIndex === seat.seatIndex,
            );
            const isUnbeaten =
              play !== undefined &&
              view.unbeatenPlay?.seatIndex === seat.seatIndex;
            const count = view.handSizes[seat.seatIndex] ?? 0;
            const passed =
              seat.playerId !== undefined &&
              view.passedPlayerIds.includes(seat.playerId);
            return (
              <li
                className={`${styles.tableSeat} ${isActor ? styles.tableSeatActor : ""}`}
                key={seat.seatIndex}
                data-seat={seat.seatIndex}
                data-position={
                  (seat.seatIndex - ownSeat + view.seats.length) %
                  view.seats.length
                }
                data-self={isCurrent}
                data-team={seat.seatIndex % 2}
                aria-current={isActor ? "true" : undefined}
                aria-label={`${positionLabel(seat.seatIndex)}，${seat.seatIndex % 2 === 0 ? "一队" : "二队"}`}
              >
                {!isCurrent && (
                  <div className={styles.seatIdentity}>
                    <span
                      className={styles.avatar}
                      data-testid="player-avatar"
                      aria-hidden="true"
                    >
                      {POSITION_NAMES[seat.seatIndex]}
                    </span>
                    <div className={styles.seatInfo}>
                      <span
                        className={styles.tableSeatName}
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {view.finishPositions[seat.seatIndex] != null &&
                          `第${view.finishPositions[seat.seatIndex]}名`}
                        {count <= 10 && (
                          <span data-testid="remaining-count">{count} 张</span>
                        )}
                      </span>
                    </div>
                  </div>
                )}
                <div className={styles.seatPlay}>
                  {play !== undefined && (
                    <div
                      className={styles.playedHand}
                      data-testid="played-hand"
                      data-unbeaten={isUnbeaten}
                      aria-current={isUnbeaten ? "true" : undefined}
                      aria-label={`${positionLabel(seat.seatIndex)}出牌`}
                    >
                      <ul className={styles.playCards}>
                        {groupCards(play.cards, view.trumpRank)
                          .flatMap((group) => group.cards)
                          .map((code) => (
                            <li
                              key={code}
                              aria-label={cardLabel(code).aria}
                              data-card={code}
                            >
                              <CardFace code={code} />
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                  {passed && <span className={styles.passTag}>不出</span>}
                </div>
              </li>
            );
          })}
        </ol>

        {view.unbeatenPlay === undefined && view.handResult === undefined && (
          <p className={styles.tablePrompt}>
            {view.setupStage === "play" ? "新一轮领牌" : "等待开局选择"}
          </p>
        )}

        {view.handResult !== undefined && (
          <section className={styles.result} aria-label="本局结果">
            <h3>本局结束</h3>
            <p>等待所有玩家上线后开始下一局。</p>
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

      <HandControls
        view={view}
        accountId={accountId}
        locked={locked}
        pending={pending}
        onCommand={onCommand}
      />
    </div>
  );
}

export function RoomTable({
  room,
  accountId,
  locked,
  pending,
  onCommand,
  onFailure,
  accountStatus,
}: RoomTableProps) {
  const view = room.view;
  const lifecycleLabel = {
    LOBBY: "大厅",
    ACTIVE: "牌局进行中",
    INTERRUPTED: "房间已中断",
    ARCHIVED: "房间已归档",
  }[room.view.lifecycle];

  return (
    <section
      className={`${styles.roomTable} ${room.view.lifecycle === "ACTIVE" ? styles.roomActive : ""}`}
    >
      <header className={styles.roomHeader}>
        {view.lifecycle === "ACTIVE" && (
          <div className={styles.tableHeading}>
            <h2 id="table-title">
              {view.selectedActivity === "challenge" ? "同牌挑战 · " : ""}第
              {view.handNumber ??
                (view.completedHandCount ?? 0) +
                  (view.handResult === undefined ? 1 : 0)}
              局
            </h2>
            <div className={styles.trumpBadge}>
              <span aria-hidden="true">· 级牌</span>
              <strong
                role="img"
                data-team={view.dealerTeam}
                aria-label={`${view.dealerTeam === 0 ? "一队" : "二队"}，当前级牌 ${view.trumpRank}`}
              >
                {view.trumpRank}
              </strong>
              <span aria-hidden="true">:</span>
              <b
                role="img"
                data-team={1 - view.dealerTeam}
                aria-label={`${view.dealerTeam === 0 ? "二队" : "一队"}等级 ${view.teamLevels[1 - view.dealerTeam]}`}
              >
                {view.teamLevels[1 - view.dealerTeam]}
              </b>
            </div>
          </div>
        )}
        {view.lifecycle === "ACTIVE" && accountStatus}
        {room.view.lifecycle === "ACTIVE" &&
          room.view.ownerId === accountId && (
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={locked || pending}
              onClick={() =>
                onCommand({
                  type:
                    room.view.selectedActivity === "challenge"
                      ? "AbortChallengeHand"
                      : "AbortMatch",
                })
              }
            >
              {room.view.selectedActivity === "challenge"
                ? "终止同牌挑战"
                : "终止比赛"}
            </button>
          )}
        <span className={styles.lifecycle} data-testid="room-lifecycle">
          {lifecycleLabel}
        </span>
      </header>

      {room.view.lastHandResult !== undefined && (
        <PreviousHand
          key={`${room.view.roomId}:${accountId}:${room.view.lastHandResult.handNumber}:${room.view.lastHandResult.seats.map((seat) => seat.playerId).join(",")}`}
          summary={room.view.lastHandResult}
          roomId={room.view.roomId}
          disabled={locked || pending}
          onFailure={onFailure}
        />
      )}

      {room.view.lifecycle === "LOBBY" ? (
        <LobbyView
          accountId={accountId}
          locked={locked}
          pending={pending}
          view={room.view}
          onCommand={onCommand}
          onFailure={onFailure}
        />
      ) : room.view.lifecycle === "ACTIVE" ? (
        <ActiveView
          key={`${room.view.roomId}:${accountId}:${room.view.handNumber ?? (room.view.completedHandCount ?? 0) + (room.view.handResult === undefined ? 1 : 0)}`}
          accountId={accountId}
          view={room.view}
          locked={locked}
          pending={pending}
          onCommand={onCommand}
        />
      ) : (
        <section className={styles.lobbyMain} aria-label="房间恢复">
          <p>
            {room.view.lifecycle === "INTERRUPTED"
              ? "当前牌局无法恢复。房主可以归档房间，或沿用比赛规则另开一桌。"
              : "此房间已关闭，无法继续游戏。"}
          </p>
          <p>
            新房间仅沿用比赛规则，其他玩家需重新加入、入座并准备。原房间与牌局记录保留；不兼容的回放可能无法查看。
          </p>
          <RulesDetails view={room.view} disabled />
          {room.view.lifecycle === "INTERRUPTED" &&
            room.view.ownerId === accountId && (
              <div className={styles.lobbyActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={locked || pending}
                  onClick={() => onCommand({ type: "ReplaceInterruptedRoom" })}
                >
                  沿用规则开新房间
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={locked || pending}
                  onClick={() => onCommand({ type: "ArchiveRoom" })}
                >
                  归档房间
                </button>
              </div>
            )}
        </section>
      )}
    </section>
  );
}

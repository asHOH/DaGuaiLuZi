import { type ReactNode } from "react";
import { type CardInstanceCode, type TrumpRank } from "@dglz/game-rules";
import { type HandReplayStep } from "@dglz/protocol";
import { cardLabel, groupCards, sortPlayedCards } from "./card-display";
import { SuitIcon } from "./SuitIcon";
import styles from "./RoomTable.module.css";

export const POSITION_NAMES = ["一", "二", "三", "四", "五", "六"];

export function positionLabel(seatIndex: number) {
  return `${POSITION_NAMES[seatIndex] ?? seatIndex + 1}号位`;
}

export function CardFace({ code }: { code: string }) {
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

export function HandCards({
  cards,
  trumpRank,
  label,
  testId,
  renderCard,
}: {
  cards: readonly CardInstanceCode[];
  trumpRank: TrumpRank;
  label: string;
  testId?: string;
  renderCard?: (code: CardInstanceCode) => ReactNode;
}) {
  return (
    <div className={styles.handScroll}>
      <ul className={styles.hand} aria-label={label}>
        {groupCards(cards, trumpRank).map((group) => (
          <li key={group.rank} data-rank={group.rank}>
            <ul className={styles.rankGroup}>
              {group.cards.map((code) => (
                <li key={code}>
                  {renderCard ? (
                    renderCard(code)
                  ) : (
                    <span
                      className={styles.card}
                      data-card={code}
                      data-testid={testId}
                      role="img"
                      aria-label={cardLabel(code).aria}
                    >
                      <CardFace code={code} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PlayedCards({
  cards,
  trumpRank,
  play,
}: {
  cards: readonly CardInstanceCode[];
  trumpRank: TrumpRank;
  play?: Pick<
    HandReplayStep["latestPlays"][number],
    "form" | "rank" | "representedFaces"
  >;
}) {
  const ordered = play
    ? sortPlayedCards(cards, trumpRank, play)
    : groupCards(cards, trumpRank).flatMap((group) => group.cards);
  return (
    <ul className={styles.playCards}>
      {ordered.map((code) => (
        <li key={code} aria-label={cardLabel(code).aria} data-card={code}>
          <CardFace code={code} />
        </li>
      ))}
    </ul>
  );
}

export function TableHeading({
  title,
  trumpRank,
  dealerTeam,
  teamLevels,
}: {
  title: string;
  trumpRank: TrumpRank;
  dealerTeam: 0 | 1;
  teamLevels: HandReplayStep["teamLevels"];
}) {
  return (
    <div className={styles.tableHeading}>
      <h2>{title}</h2>
      <div className={styles.trumpBadge}>
        <span aria-hidden="true">· 级牌</span>
        <strong
          role="img"
          data-team={dealerTeam}
          aria-label={`${dealerTeam === 0 ? "一队" : "二队"}，当前级牌 ${trumpRank}`}
        >
          {trumpRank}
        </strong>
        <span aria-hidden="true">:</span>
        <b
          role="img"
          data-team={1 - dealerTeam}
          aria-label={`${dealerTeam === 0 ? "二队" : "一队"}等级 ${teamLevels[1 - dealerTeam]}`}
        >
          {teamLevels[1 - dealerTeam]}
        </b>
      </div>
    </div>
  );
}

export function TableSurface({
  perspectiveSeat,
  currentActorSeat,
  handSizes,
  finishPositions,
  latestPlays,
  unbeatenSeat,
  passedSeatIndices,
  trumpRank,
  result,
  children,
}: {
  perspectiveSeat: number;
  currentActorSeat: number | undefined;
  handSizes: readonly number[];
  finishPositions: readonly (number | null | undefined)[];
  latestPlays: readonly Pick<
    HandReplayStep["latestPlays"][number],
    "seatIndex" | "cards" | "form" | "rank" | "representedFaces"
  >[];
  unbeatenSeat: number | undefined;
  passedSeatIndices: readonly number[];
  trumpRank: TrumpRank;
  result?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.activeLayout}>
      <section className={styles.tableStage} aria-label="牌桌">
        <ol
          className={styles.tableSeats}
          data-player-count={handSizes.length}
          aria-label="牌桌座位"
        >
          {handSizes.map((count, seatIndex) => {
            const isActor = seatIndex === currentActorSeat;
            const isCurrent = seatIndex === perspectiveSeat;
            const play = latestPlays.find(
              (play) => play.seatIndex === seatIndex,
            );
            const isUnbeaten = play !== undefined && unbeatenSeat === seatIndex;
            return (
              <li
                className={`${styles.tableSeat} ${isActor ? styles.tableSeatActor : ""}`}
                key={seatIndex}
                data-seat={seatIndex}
                data-position={
                  (seatIndex - perspectiveSeat + handSizes.length) %
                  handSizes.length
                }
                data-self={isCurrent}
                data-team={seatIndex % 2}
                aria-current={isActor ? "true" : undefined}
                aria-label={`${positionLabel(seatIndex)}，${seatIndex % 2 === 0 ? "一队" : "二队"}`}
              >
                {!isCurrent && (
                  <div className={styles.seatIdentity}>
                    <span
                      className={styles.avatar}
                      data-testid="player-avatar"
                      aria-hidden="true"
                    >
                      {POSITION_NAMES[seatIndex]}
                    </span>
                    <div className={styles.seatInfo}>
                      <span
                        className={styles.tableSeatName}
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {finishPositions[seatIndex] != null &&
                          `第${finishPositions[seatIndex]}名`}
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
                      aria-label={`${positionLabel(seatIndex)}出牌`}
                    >
                      <PlayedCards
                        cards={play.cards}
                        trumpRank={trumpRank}
                        play={play}
                      />
                    </div>
                  )}
                  {passedSeatIndices.includes(seatIndex) && (
                    <span className={styles.passTag}>不出</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {result}
      </section>
      {children}
    </div>
  );
}

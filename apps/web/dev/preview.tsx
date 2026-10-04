import { useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { AppHeader } from "../src/AppHeader";
import { LoginPage, PasswordPage } from "../src/AccountPages";
import { ChallengeEntry, ChallengeShare } from "../src/ChallengeControls";
import { ConnectionStatus } from "../src/ConnectionStatus";
import { HandHistory } from "../src/HandHistory";
import { ReplayViewer } from "../src/ReplayViewer";
import { RoomEntry } from "../src/RoomEntry";
import { RoomTable } from "../src/RoomTable";
import { type RoomState } from "../src/room-connection";
import { type ReplaySource } from "../src/replay-links";
import { ApiError, errorMessage } from "../src/api";
import styles from "../src/shell.module.css";
import "../src/controls.module.css";
import { installPreviewApi } from "./preview-api";
import {
  PREVIEW_ACCOUNT,
  PREVIEW_CODE,
  PREVIEW_ROOM,
  previewFixtures,
  readSelection,
  type ScreenId,
} from "./preview-scenarios";

const selection = readSelection(location.search);
const fixtures = previewFixtures(selection);
installPreviewApi(selection, fixtures);
function notify() {
  window.parent.postMessage(
    { type: "dglz-preview-action", message: "操作已记录，预览场景保持不变。" },
    location.origin,
  );
}
function navigate(screen: ScreenId, state: string) {
  window.parent.postMessage(
    { type: "dglz-preview-navigate", screen, state },
    location.origin,
  );
}
const submit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  notify();
};

function Preview() {
  const { screen, state, connection } = selection;
  const roomState: RoomState = {
    room: fixtures.room,
    connected: connection !== "offline",
    synced: connection !== "syncing",
    pending: connection === "pending",
    uncertain: connection === "uncertain",
    error: connection === "error" ? "操作失败，请重试。" : "",
  };
  const [error, setError] = useState(
    screen === "account" && state === "error"
      ? "用户名或密码不正确。"
      : screen === "account" && state === "password-error"
        ? "当前密码不正确。"
        : screen === "home" && state === "error"
          ? "请输入完整的房间码或邀请链接。"
          : "",
  );
  const [source, setSource] = useState<ReplaySource | undefined>(
    screen === "replay"
      ? { roomId: PREVIEW_ROOM, handStartSequence: 12 }
      : undefined,
  );
  const fail = (reason: unknown) =>
    setError(
      errorMessage(reason instanceof ApiError ? reason.code : "internal-error"),
    );
  const active = screen === "table";
  const anonymous = screen === "account" && !state.startsWith("password");
  const path =
    screen === "account" && !anonymous
      ? "/account"
      : screen === "history" || screen === "replay"
        ? "/history"
        : "/";
  return (
    <div
      className={`${styles.shell} ${active ? styles.gameShell : ""}`}
      data-preview={`${screen}/${state}/${selection.players}`}
    >
      {!active && (
        <AppHeader
          username={anonymous ? undefined : "预览玩家"}
          showNavigation
          path={path}
          busy={state === "busy"}
          connectionStatus={<ConnectionStatus state={roomState} />}
          onNavigate={(target) =>
            target === "/history"
              ? navigate("history", "filled")
              : target === "/account"
                ? navigate("account", "password")
                : navigate("home", "default")
          }
          onLogout={() => navigate("account", "login")}
        />
      )}
      <main>
        {error && (
          <div className={styles.notice} role="alert">
            {error}
          </div>
        )}
        {screen === "account" &&
          (anonymous ? (
            <LoginPage
              initialMode={state === "register" ? "register" : "login"}
              busy={state === "busy"}
              canRetry={state === "error"}
              onSubmit={submit}
              onRestore={async () => notify()}
              onModeChange={() => setError("")}
            />
          ) : (
            <PasswordPage
              username="预览玩家"
              busy={false}
              onSubmit={submit}
              onBack={() => navigate("home", "default")}
            />
          ))}
        {screen === "home" && (
          <RoomEntry
            busy={state === "busy"}
            onCreate={submit}
            onJoin={(event) => {
              event.preventDefault();
              notify();
            }}
          />
        )}
        {(screen === "lobby" || screen === "table") && (
          <>
            {!active && (
              <div className={styles.roomToolbar}>
                <div className={styles.roomBar}>
                  <button onClick={() => navigate("home", "default")}>
                    返回开桌
                  </button>
                  <details className={styles.invite}>
                    <summary>邀请好友</summary>
                    <label>
                      邀请链接
                      <input
                        readOnly
                        value={`${location.origin}/rooms/${PREVIEW_ROOM}`}
                      />
                    </label>
                  </details>
                </div>
                <ConnectionStatus state={roomState} />
              </div>
            )}
            {roomState.error && (
              <div className={styles.notice} role="alert">
                {roomState.error}
                <button onClick={notify}>重新同步</button>
              </div>
            )}
            {roomState.uncertain && <button onClick={notify}>重试操作</button>}
            <RoomTable
              room={fixtures.room}
              accountId={PREVIEW_ACCOUNT}
              locked={
                !roomState.connected || !roomState.synced || roomState.uncertain
              }
              pending={roomState.pending}
              onCommand={notify}
              onFailure={fail}
              accountStatus={
                <div className={styles.account}>
                  <span className={styles.gameAccountName}>预览玩家</span>
                  <ConnectionStatus state={roomState} />
                </div>
              }
            />
          </>
        )}
        {(screen === "history" || screen === "replay") && (
          <section className={styles.home}>
            <button onClick={() => navigate("home", "default")}>
              返回开桌
            </button>
            <h1>牌局记录</h1>
            <ReplayViewer
              key={JSON.stringify(source)}
              accountId={PREVIEW_ACCOUNT}
              initialSource={source}
              invalidLink={false}
              disabled={false}
              onSourceChange={() => {}}
              onFailure={fail}
              onChallenge={async () => notify()}
            />
            <HandHistory
              accountId={PREVIEW_ACCOUNT}
              onFailure={fail}
              onOpen={(hand) =>
                setSource({
                  roomId: hand.roomId,
                  handStartSequence: hand.handStartSequence,
                })
              }
            />
          </section>
        )}
        {screen === "challenge" && (
          <section className={styles.home}>
            <h1>同牌挑战</h1>
            {state === "lookup" || state === "error" ? (
              <ChallengeEntry
                disabled={false}
                onCommand={notify}
                onFailure={fail}
              />
            ) : (
              <ChallengeShare
                roomId={PREVIEW_ROOM}
                handStartSequence={12}
                initialCode={PREVIEW_CODE}
                disabled={false}
                onFailure={fail}
                onChallenge={async () => notify()}
              />
            )}
          </section>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);

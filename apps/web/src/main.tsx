import { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  LoginResponseEnvelopeSchema,
  LogoutResponseEnvelopeSchema,
  RoomIdSchema,
  RoomResponseEnvelopeSchema,
  type RulesetId,
  type SeatingPolicy,
} from "@dglz/protocol";
import { api, ApiError, errorMessage } from "./api";
import { createRoomConnection, initialRoomState } from "./room-connection";
import { ReplayViewer } from "./ReplayViewer";
import { HandHistory } from "./HandHistory";
import { replayHash, replaySource, type ReplaySource } from "./replay-links";
import { RoomTable } from "./RoomTable";
import { LoginPage, PasswordPage } from "./AccountPages";
import { RoomEntry } from "./RoomEntry";
import { ConnectionStatus } from "./ConnectionStatus";
import styles from "./shell.module.css";

type Account = { accountId: string; username: string };

function roomFromLocation(): string {
  return location.pathname.startsWith("/rooms/")
    ? location.pathname.slice(7)
    : "";
}

function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadRequired, setReloadRequired] = useState(false);
  const [roomId, setRoomId] = useState(roomFromLocation);
  const [route, setRoute] = useState(() => ({
    path: location.pathname,
    hash: location.hash,
    revision: 0,
  }));
  const [roomState, setRoomState] = useState(initialRoomState);
  const [connectionKey, setConnectionKey] = useState(0);
  const connection = useRef<ReturnType<typeof createRoomConnection> | null>(
    null,
  );
  const operation = useRef(0);
  const currentAccount = useRef(account);
  currentAccount.current = account;
  const accountChannel = useRef<BroadcastChannel | null>(null);

  function clearAccount() {
    operation.current++;
    connection.current?.close();
    setRoomState(initialRoomState);
    setAccount(null);
  }

  function invalidatePasswordAccount(accountId: string, message: string) {
    accountChannel.current?.postMessage(accountId);
    // A response can arrive after navigation or a login as another account.
    if (currentAccount.current?.accountId !== accountId) return;
    clearAccount();
    setError("");
    setNotice(message);
  }

  function fail(reason: unknown) {
    const code = reason instanceof ApiError ? reason.code : "internal-error";
    setError(errorMessage(code));
    if (code === "reload-required" || code === "unauthorized") {
      clearAccount();
      setReloadRequired(code === "reload-required");
    }
  }
  async function restore() {
    const generation = ++operation.current;
    setBooting(true);
    setError("");
    try {
      const result = await api("/session", LoginResponseEnvelopeSchema);
      if (generation === operation.current) setAccount(result.data);
    } catch (reason) {
      if (
        generation === operation.current &&
        !(reason instanceof ApiError && reason.code === "unauthorized")
      )
        fail(reason);
    } finally {
      setBooting(false);
    }
  }
  useEffect(() => {
    void restore();
  }, []);
  useEffect(() => {
    const channel = new BroadcastChannel("dglz-password-change");
    accountChannel.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (
        typeof event.data === "string" &&
        event.data === currentAccount.current?.accountId
      ) {
        clearAccount();
        setError("");
        setNotice("其他页面已提交密码修改，请重新登录确认账户状态。");
      }
    };
    return () => {
      channel.close();
      accountChannel.current = null;
    };
  }, []);
  useEffect(() => {
    const onPop = () => {
      operation.current++;
      connection.current?.close();
      setConnectionKey((value) => value + 1);
      setRoomState(initialRoomState);
      setRoomId(roomFromLocation());
      setRoute((previous) => ({
        path: location.pathname,
        hash: location.hash,
        revision: previous.revision + 1,
      }));
      setError("");
      setNotice("");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    setRoomState(initialRoomState);
    if (
      account === null ||
      roomId === "" ||
      !RoomIdSchema.safeParse(roomId).success
    )
      return;
    const next = createRoomConnection(
      roomId,
      account.accountId,
      setRoomState,
      (code) => fail(new ApiError(code)),
      () => navigatePath("/", true),
      (replacementRoomId) => navigatePath(`/rooms/${replacementRoomId}`, true),
    );
    connection.current = next;
    return () => {
      next.close();
      connection.current = null;
    };
  }, [account, roomId, connectionKey]);

  function navigatePath(path: string, replace = false) {
    operation.current++;
    connection.current?.close();
    setRoomState(initialRoomState);
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
    setRoomId(roomFromLocation());
    setRoute((previous) => ({
      path: location.pathname,
      hash: location.hash,
      revision: previous.revision + 1,
    }));
    setError("");
    setNotice("");
  }
  function navigate(id: string) {
    navigatePath(id === "" ? "/" : `/rooms/${id}`);
  }
  function openReplay(source: ReplaySource) {
    navigatePath(`/history${replayHash(source)}`);
  }
  async function createChallenge(code: string, rulesetId: RulesetId) {
    const generation = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const response = await api("/rooms", RoomResponseEnvelopeSchema, {
        rulesetId,
        seatingPolicy: "fixed",
      });
      if (generation === operation.current)
        navigatePath(`/rooms/${response.data.view.roomId}#challenge=${code}`);
    } catch (reason) {
      if (generation === operation.current) fail(reason);
    } finally {
      setBusy(false);
    }
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const generation = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const response = await api("/login", LoginResponseEnvelopeSchema, {
        username: data.get("username"),
        password: data.get("password"),
      });
      if (generation === operation.current) {
        setAccount(response.data);
        setNotice("");
      }
    } catch (reason) {
      if (generation === operation.current) fail(reason);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    ++operation.current;
    connection.current?.close();
    setRoomState(initialRoomState);
    setBusy(true);
    setError("");
    try {
      await api("/logout", LogoutResponseEnvelopeSchema, {});
      setAccount(null);
    } catch (reason) {
      fail(reason);
      setConnectionKey((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (account === null || busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const confirmation = form.elements.namedItem(
      "confirmPassword",
    ) as HTMLInputElement;
    if (data.get("newPassword") !== data.get("confirmPassword")) {
      confirmation.setCustomValidity("两次输入的新密码不一致。");
      confirmation.reportValidity();
      return;
    }
    const accountId = account.accountId;
    const generation = ++operation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/account/password", LogoutResponseEnvelopeSchema, {
        accountId,
        currentPassword: data.get("currentPassword"),
        newPassword: data.get("newPassword"),
      });
      form.reset();
      invalidatePasswordAccount(
        accountId,
        "密码已修改，所有设备已退出登录。请使用新密码登录。",
      );
    } catch (reason) {
      if (!(reason instanceof ApiError)) {
        invalidatePasswordAccount(
          accountId,
          "未能确认修改结果，请重新登录；若新密码无效，请使用原密码。",
        );
        return;
      }
      if (generation !== operation.current) return;
      if (reason.code === "invalid-credentials") setError("当前密码不正确。");
      else fail(reason);
    } finally {
      setBusy(false);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const generation = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const response = await api("/rooms", RoomResponseEnvelopeSchema, {
        rulesetId: data.get("ruleset") as RulesetId,
        seatingPolicy: data.get("seating") as SeatingPolicy,
      });
      if (generation === operation.current) navigate(response.data.view.roomId);
    } catch (reason) {
      if (generation === operation.current) fail(reason);
    } finally {
      setBusy(false);
    }
  }
  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("room");
    const input = typeof value === "string" ? value.trim() : "";
    let id = input;
    try {
      id = new URL(input).pathname.replace(/^\/rooms\//, "");
    } catch {
      /* A plain Room ID is also accepted. */
    }
    if (!RoomIdSchema.safeParse(id).success) {
      setError("请输入完整的房间码或邀请链接。");
      return;
    }
    navigate(id);
  }
  const validRoom = RoomIdSchema.safeParse(roomId).success;
  const activeGame = validRoom && roomState.room?.view.lifecycle === "ACTIVE";
  const showNavigation =
    !activeGame &&
    (!validRoom || roomState.room !== null || roomState.error !== "");
  return (
    <div className={`${styles.shell} ${activeGame ? styles.gameShell : ""}`}>
      {!activeGame && (
        <header className={styles.header}>
          {!showNavigation ? (
            <span className={styles.brand}>大怪路子</span>
          ) : (
            <a
              className={styles.brand}
              href="/"
              onClick={(event) => {
                event.preventDefault();
                navigate("");
              }}
            >
              大怪路子
            </a>
          )}
          {account && (
            <div className={styles.account}>
              <span>{account.username}</span>
              {!showNavigation ? (
                <ConnectionStatus state={roomState} />
              ) : (
                <>
                  {route.path !== "/account" && (
                    <a
                      href="/account"
                      onClick={(event) => {
                        event.preventDefault();
                        navigatePath("/account");
                      }}
                    >
                      修改密码
                    </a>
                  )}
                  {route.path !== "/history" && (
                    <a
                      href="/history"
                      onClick={(event) => {
                        event.preventDefault();
                        navigatePath("/history");
                      }}
                    >
                      牌局记录
                    </a>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => {
                      void logout();
                    }}
                  >
                    退出登录
                  </button>
                </>
              )}
            </div>
          )}
        </header>
      )}
      <main>
        {notice && (
          <p className={styles.connection} role="status">
            {notice}
          </p>
        )}
        {(error || reloadRequired) && (
          <div className={styles.notice} role="alert">
            {error}
            {reloadRequired && (
              <button onClick={() => location.reload()}>刷新页面</button>
            )}
          </div>
        )}
        {booting ? (
          <p role="status">正在恢复登录…</p>
        ) : reloadRequired ? null : account === null ? (
          <LoginPage
            key="login"
            busy={busy}
            canRetry={error !== ""}
            onSubmit={login}
            onRestore={restore}
          />
        ) : route.path === "/account" ? (
          <PasswordPage
            key={account.accountId}
            username={account.username}
            busy={busy}
            onSubmit={submitPassword}
            onBack={() => navigate("")}
          />
        ) : route.path === "/history" ? (
          <section className={styles.home}>
            <button onClick={() => navigate("")}>返回开桌</button>
            <h1>牌局记录</h1>
            <ReplayViewer
              key={`${account.accountId}:${route.revision}`}
              accountId={account.accountId}
              initialSource={replaySource(route.hash)}
              invalidLink={
                route.hash !== "" && replaySource(route.hash) === undefined
              }
              onFailure={fail}
              onSourceChange={(source) => {
                history.replaceState(
                  null,
                  "",
                  `/history${source === undefined ? "" : replayHash(source)}`,
                );
                setRoute((previous) => ({ ...previous, hash: location.hash }));
              }}
              onChallenge={createChallenge}
              disabled={busy}
            />
            <HandHistory
              key={account.accountId}
              accountId={account.accountId}
              onOpen={openReplay}
              onFailure={fail}
            />
          </section>
        ) : roomId === "" ? (
          <RoomEntry busy={busy} onCreate={create} onJoin={join} />
        ) : !validRoom ? (
          <section className={styles.panel}>
            <h2>房间码不正确</h2>
            <button onClick={() => navigate("")}>返回开桌</button>
          </section>
        ) : (
          <>
            {showNavigation && (
              <div className={styles.roomToolbar}>
                <div className={styles.roomBar}>
                  <button onClick={() => navigate("")}>返回开桌</button>
                  <details className={styles.invite}>
                    <summary>邀请好友</summary>
                    <label>
                      邀请链接
                      <input
                        readOnly
                        aria-label="邀请链接"
                        value={`${location.origin}/rooms/${roomId}`}
                        onFocus={(event) => event.target.select()}
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
                <button
                  disabled={roomState.pending}
                  onClick={() => connection.current?.retry()}
                >
                  {roomState.uncertain ? "重试操作" : "重新同步"}
                </button>
              </div>
            )}
            {roomState.uncertain && !roomState.error && (
              <button
                disabled={!roomState.connected || roomState.pending}
                onClick={() => connection.current?.retry()}
              >
                重试操作
              </button>
            )}
            {roomState.room && (
              <RoomTable
                key={`${account.accountId}:${roomId}`}
                room={roomState.room}
                accountId={account.accountId}
                accountStatus={
                  <div className={styles.account}>
                    <span className={styles.gameAccountName}>
                      {account.username}
                    </span>
                    <ConnectionStatus state={roomState} />
                  </div>
                }
                locked={
                  !roomState.synced ||
                  !roomState.connected ||
                  roomState.uncertain ||
                  busy
                }
                pending={roomState.pending}
                onCommand={(payload) => connection.current?.send(payload)}
                onFailure={fail}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

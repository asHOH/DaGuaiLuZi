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
import { RoomTable } from "./RoomTable";
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
  const [reloadRequired, setReloadRequired] = useState(false);
  const [roomId, setRoomId] = useState(roomFromLocation);
  const [roomState, setRoomState] = useState(initialRoomState);
  const [connectionKey, setConnectionKey] = useState(0);
  const connection = useRef<ReturnType<typeof createRoomConnection> | null>(
    null,
  );
  const operation = useRef(0);

  function fail(reason: unknown) {
    const code = reason instanceof ApiError ? reason.code : "internal-error";
    setError(errorMessage(code));
    if (code === "reload-required" || code === "unauthorized") {
      operation.current++;
      connection.current?.close();
      setRoomState(initialRoomState);
      setAccount(null);
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
    const onPop = () => {
      connection.current?.close();
      setRoomState(initialRoomState);
      setRoomId(roomFromLocation());
      setError("");
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
    );
    connection.current = next;
    return () => {
      next.close();
      connection.current = null;
    };
  }, [account, roomId, connectionKey]);

  function navigate(id: string) {
    connection.current?.close();
    setRoomState(initialRoomState);
    history.pushState(null, "", id === "" ? "/" : `/rooms/${id}`);
    setRoomId(id);
    setError("");
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
      if (generation === operation.current) setAccount(response.data);
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
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a
          className={styles.brand}
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate("");
          }}
        >
          大怪路子<span>好友牌局</span>
        </a>
        {account && (
          <div className={styles.account}>
            <span>{account.username}</span>
            <button
              disabled={busy}
              onClick={() => {
                void logout();
              }}
            >
              退出登录
            </button>
          </div>
        )}
      </header>
      <main>
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
          <section className={styles.welcome}>
            <div className={styles.intro}>
              <p className={styles.eyebrow}>一桌好友 · 一手好牌</p>
              <h1>
                坐下来，
                <br />
                打几手。
              </h1>
              <p>
                四人或六人，邀好友入座。
                <br />
                熟悉的大怪路子，现在随时开桌。
              </p>
              <div className={styles.motif} aria-hidden="true">
                <span>♠</span>
                <span>♥</span>
                <span>♣</span>
              </div>
            </div>
            <form
              className={styles.panel}
              onSubmit={(event) => {
                void login(event);
              }}
            >
              <h2>登录入座</h2>
              <p>使用管理员为你开通的账号。</p>
              <label>
                用户名
                <input
                  name="username"
                  autoComplete="username"
                  required
                  maxLength={64}
                />
              </label>
              <label>
                密码
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={1024}
                />
              </label>
              <button className={styles.primary} disabled={busy}>
                登录
              </button>
              {error && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void restore();
                  }}
                >
                  重试恢复登录
                </button>
              )}
            </form>
          </section>
        ) : roomId === "" ? (
          <section className={styles.home}>
            <div>
              <p className={styles.eyebrow}>好友到齐，就开局</p>
              <h1>今晚，怎么打？</h1>
              <p>
                新房间使用「省心」规则。入座并准备后，所有人在线即可自动开局。
              </p>
            </div>
            <div className={styles.forms}>
              <form
                className={styles.panel}
                onSubmit={(event) => {
                  void create(event);
                }}
              >
                <h2>开一桌</h2>
                <label>
                  人数
                  <select name="ruleset" defaultValue="dglz-6p-3d-v1">
                    <option value="dglz-6p-3d-v1">六人 · 三副牌</option>
                    <option value="dglz-4p-2d-v1">四人 · 两副牌</option>
                  </select>
                </label>
                <label>
                  座位安排
                  <select name="seating">
                    <option value="fixed">固定座位</option>
                    <option value="randomized">开局随机分配</option>
                  </select>
                </label>
                <button className={styles.primary} disabled={busy}>
                  创建房间
                </button>
              </form>
              <form className={styles.panel} onSubmit={join}>
                <h2>赴个约</h2>
                <p>粘贴好友发来的房间码或邀请链接。</p>
                <label>
                  房间码或链接
                  <input name="room" required autoComplete="off" />
                </label>
                <button disabled={busy}>加入房间</button>
              </form>
            </div>
          </section>
        ) : !validRoom ? (
          <section className={styles.panel}>
            <h2>房间码不正确</h2>
            <button onClick={() => navigate("")}>返回开桌</button>
          </section>
        ) : (
          <>
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
            <div className={styles.connection} role="status">
              {!roomState.synced || !roomState.connected
                ? "正在同步牌局…"
                : roomState.pending
                  ? "正在提交…"
                  : roomState.uncertain
                    ? "等待确认操作结果"
                    : "已连接 · 牌局已同步"}
            </div>
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
                room={roomState.room}
                accountId={account.accountId}
                locked={
                  !roomState.synced ||
                  !roomState.connected ||
                  roomState.uncertain ||
                  busy
                }
                pending={roomState.pending}
                onCommand={(payload) => connection.current?.send(payload)}
              />
            )}
          </>
        )}
      </main>
      <footer className={styles.footer}>
        好友相聚，慢慢打。<span>当前支持入座、开局与重连</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

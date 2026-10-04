import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CONNECTIONS,
  SCREENS,
  VIEWPORTS,
  readSelection,
  selectionSearch,
  statesFor,
  type PreviewSelection,
} from "./preview-scenarios";
import styles from "./gallery.module.css";

function Gallery() {
  const [selection, setSelection] = useState(() =>
    readSelection(location.search),
  );
  const [reset, setReset] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [message, setMessage] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const screen = SCREENS.find((item) => item.id === selection.screen)!;
  const viewport = VIEWPORTS.find((item) => item.id === selection.viewport)!;
  function update(patch: Partial<PreviewSelection>) {
    setSelection((previous) =>
      readSelection(selectionSearch({ ...previous, ...patch })),
    );
    setMessage("");
  }
  useEffect(() => {
    history.replaceState(null, "", `?${selectionSearch(selection)}`);
  }, [selection]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null || !("type" in data))
        return;
      if (
        data.type === "dglz-preview-action" &&
        "message" in data &&
        typeof data.message === "string"
      )
        setMessage(data.message);
      if (
        data.type === "dglz-preview-navigate" &&
        "screen" in data &&
        "state" in data
      ) {
        const target = SCREENS.find((item) => item.id === data.screen);
        if (target !== undefined && typeof data.state === "string")
          update({ screen: target.id, state: data.state });
      }
    };
    const restore = () => setSelection(readSelection(location.search));
    window.addEventListener("message", receive);
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener("popstate", restore);
    };
  }, []);
  async function play() {
    setLaunching(true);
    setMessage("正在打开试玩牌桌…");
    try {
      const launch = (
        window as unknown as { dglzOpenPlayable?: () => Promise<void> }
      ).dglzOpenPlayable;
      if (launch === undefined) throw new Error("missing-launcher");
      await launch();
      setMessage("试玩牌桌已打开，可从试玩控制栏返回预览库。");
    } catch {
      setMessage("试玩牌桌未能打开，请重新运行 pnpm play。");
    } finally {
      setLaunching(false);
    }
  }
  return (
    <div className={styles.gallery}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>大怪路子 · 本地工具</p>
          <h1>界面预览库</h1>
        </div>
        <button
          className={styles.play}
          onClick={() => void play()}
          disabled={launching}
        >
          {launching ? "正在打开…" : "打开试玩牌桌"}
        </button>
      </header>
      <div className={styles.layout}>
        <aside className={styles.controls} aria-label="预览控制">
          <label>
            页面
            <select
              value={selection.screen}
              onChange={(event) =>
                update({
                  screen: event.target.value as PreviewSelection["screen"],
                  state: "",
                })
              }
            >
              {SCREENS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            场景
            <select
              value={selection.state}
              onChange={(event) => update({ state: event.target.value })}
            >
              {statesFor(screen.id, selection.players).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            人数
            <select
              value={selection.players}
              onChange={(event) =>
                update({ players: Number(event.target.value) === 6 ? 6 : 4 })
              }
            >
              <option value="4">四人 · 两副牌</option>
              <option value="6">六人 · 三副牌</option>
            </select>
          </label>
          <label>
            视口
            <select
              value={selection.viewport}
              onChange={(event) =>
                update({
                  viewport: event.target.value as PreviewSelection["viewport"],
                })
              }
            >
              {VIEWPORTS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {(selection.screen === "table" || selection.screen === "lobby") && (
            <label>
              连接状态
              <select
                value={selection.connection}
                onChange={(event) =>
                  update({
                    connection: event.target
                      .value as PreviewSelection["connection"],
                  })
                }
              >
                {CONNECTIONS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            onClick={() => {
              setReset((value) => value + 1);
              setMessage("场景已重置。");
            }}
          >
            重置场景
          </button>
          <p className={styles.help}>
            固定示例，可选牌、切换视角和播放回放。提交操作保持场景不变；完整对局请打开试玩牌桌。
          </p>
          {selection.screen === "challenge" && (
            <p className={styles.help}>
              示例挑战码：<code>abcdef123456</code>
            </p>
          )}
          <p role="status" className={styles.message}>
            {message}
          </p>
        </aside>
        <section className={styles.canvas} aria-label="预览画布">
          <div className={styles.caption}>
            <strong>
              {screen.label} ·{" "}
              {screen.states.find((item) => item[0] === selection.state)?.[1]}
            </strong>
            <span>{viewport.label}</span>
          </div>
          <div className={styles.scroll}>
            <iframe
              ref={frame}
              title="界面预览"
              className={styles.frame}
              style={{
                width: viewport.width ?? "100%",
                height: viewport.height,
              }}
              src={`./preview.html?${selectionSearch({ ...selection, viewport: "fit" })}&reset=${reset}`}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Gallery />);

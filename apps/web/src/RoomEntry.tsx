import type { FormEvent } from "react";
import controls from "./controls.module.css";
import styles from "./shell.module.css";

export function RoomEntry({
  busy,
  onCreate,
  onJoin,
}: {
  busy: boolean;
  onCreate: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onJoin: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className={styles.home}>
      <div className={styles.forms}>
        <form
          className={styles.panel}
          onSubmit={(event) => {
            void onCreate(event);
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
          <button className={controls.primary} disabled={busy}>
            创建房间
          </button>
        </form>
        <form className={styles.panel} onSubmit={onJoin}>
          <h2>赴个约</h2>
          <label>
            房间码或链接
            <input name="room" required autoComplete="off" />
          </label>
          <button disabled={busy}>加入房间</button>
        </form>
      </div>
    </section>
  );
}

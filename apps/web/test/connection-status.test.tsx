import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ConnectionStatus } from "../src/ConnectionStatus";
import { initialRoomState, type RoomState } from "../src/room-connection";

it.each<[Partial<RoomState>, string, string]>([
  [{}, "ready", "已连接 · 牌局已同步"],
  [{ connected: false, pending: true }, "offline", "连接已断开，正在重连…"],
  [{ synced: false }, "syncing", "正在同步牌局…"],
  [{ pending: true }, "pending", "正在提交…"],
  [{ uncertain: true, synced: false }, "uncertain", "等待确认操作结果"],
  [{ error: "操作失败" }, "error", "操作失败，请查看提示"],
])("announces the connection state for %j", (changes, status, label) => {
  const markup = renderToStaticMarkup(
    <ConnectionStatus
      state={{ ...initialRoomState, connected: true, synced: true, ...changes }}
    />,
  );
  expect(markup).toContain(`data-state="${status}"`);
  expect(markup).toContain(`title="${label}"`);
  expect(markup).toContain(`>${label}</span>`);
  expect(markup).toContain('role="status"');
  expect(markup).toContain("<svg");
  expect(markup).toContain('aria-hidden="true"');
});

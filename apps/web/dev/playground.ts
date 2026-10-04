import assert from "node:assert/strict";
import { type Browser } from "@playwright/test";
import { RoomResponseEnvelopeSchema } from "@dglz/protocol";
import {
  automaticCommand,
  loginProtocol,
  protocolHeaders,
  ProtocolClient,
  startServer,
} from "../e2e/support";

type Controls = {
  paused: boolean;
  playerCount: number;
  message: string;
  roomUrl?: string;
};

export async function openPlayground(
  browser: Browser,
  onGallery?: () => Promise<void>,
) {
  const server = await startServer();
  const clients: ProtocolClient[] = [];
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  let roomId = "";
  let playerCount = 4;
  let paused = false;
  let closed = false;
  let closing: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<unknown> = Promise.resolve();

  // Serialize reset, manual steps and automatic steps so they cannot act on an old Room.
  function serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  }

  async function close() {
    if (closing !== undefined) return closing;
    closed = true;
    clearTimeout(timer);
    closing = (async () => {
      await pending;
      for (const client of clients) client.close();
      await context.close();
      await server.close();
    })();
    return closing;
  }

  try {
    const sessions = await Promise.all(
      server.accounts
        .slice(0, 6)
        .map((account) => loginProtocol(server.url, account)),
    );
    const owner = sessions[0]!;
    const separator = owner.cookie.indexOf("=");
    await context.addCookies([
      {
        name: owner.cookie.slice(0, separator),
        value: owner.cookie.slice(separator + 1),
        url: server.url,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    async function reset(count: number): Promise<string> {
      assert(count === 4 || count === 6, "invalid-player-count");
      for (const client of clients) client.close();
      clients.length = 0;
      playerCount = count;
      const response = await fetch(`${server.url}/api/rooms`, {
        method: "POST",
        headers: {
          ...protocolHeaders(),
          cookie: owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          rulesetId: count === 4 ? "dglz-4p-2d-v1" : "dglz-6p-3d-v1",
          seatingPolicy: "fixed",
        }),
      });
      assert(response.ok, `HTTP ${response.status}`);
      roomId = RoomResponseEnvelopeSchema.parse(await response.json()).data.view
        .roomId;
      for (const [seatIndex, session] of sessions.slice(0, count).entries()) {
        const client = new ProtocolClient(
          server.url,
          session.cookie,
          seatIndex === 0 ? roomId : undefined,
        );
        clients.push(client);
        await client.connect();
        if (seatIndex !== 0) await client.join(roomId);
        await client.command(server.url, roomId, {
          type: "AssignSeat",
          seatIndex,
        });
      }
      const human = clients[0]!;
      await human.command(server.url, roomId, { type: "SelectMatch" });
      for (const client of clients.slice(1)) {
        await client.command(server.url, roomId, {
          type: "SetReadiness",
          ready: true,
        });
      }
      await human.command(server.url, roomId, {
        type: "SetReadiness",
        ready: true,
      });
      // Only the actual browser keeps the human connected after bootstrap.
      human.close();
      return `${server.url}/rooms/${roomId}`;
    }

    async function step(): Promise<boolean> {
      const latest = clients
        .slice(1)
        .map((client) => client.snapshot(roomId))
        .filter((view) => view !== undefined)
        .sort((left, right) => right.revision - left.revision)[0];
      if (latest?.view.lifecycle !== "ACTIVE") return false;
      const actors =
        latest.view.setupStage === "play"
          ? [latest.view.currentActor]
          : latest.view.pendingPlayerIds;
      for (let index = 1; index < clients.length; index += 1) {
        if (!actors.includes(sessions[index]!.accountId)) continue;
        const client = clients[index]!;
        const own = await client.synchronizedView(roomId, latest.revision);
        const command = automaticCommand(own.view, sessions[index]!.accountId);
        if (command === undefined) continue;
        await client.command(server.url, roomId, command);
        return true;
      }
      return false;
    }

    await page.exposeFunction(
      "dglzPlayControl",
      (action: string, count?: number) =>
        serialize(async (): Promise<Controls> => {
          assert(!closed, "playground-closed");
          let message = "轮到你时，其他玩家会等待。";
          let roomUrl: string | undefined;
          try {
            switch (action) {
              case "status":
                break;
              case "gallery":
                await onGallery?.();
                break;
              case "toggle":
                paused = !paused;
                break;
              case "step":
                paused = true;
                message = (await step())
                  ? "已执行一步。"
                  : "等待你操作，或本局已结束。";
                break;
              case "reset":
                paused = true;
                roomUrl = await reset(count!);
                message = "已重新开始，自动操作已暂停。";
                break;
              default:
                throw new Error("invalid-playground-action");
            }
          } catch (error) {
            paused = true;
            console.error("试玩操作失败：", error);
            message = "操作失败，已暂停；请重新开始。";
          }
          return {
            paused,
            playerCount,
            message,
            ...(roomUrl === undefined ? {} : { roomUrl }),
          };
        }),
    );

    // Injected only into this launcher-owned browser, never into the shipped application.
    await page.addInitScript((withGallery: boolean) => {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          const host = document.createElement("aside");
          host.id = "dglz-play-controls";
          const root = host.attachShadow({ mode: "open" });
          root.innerHTML = `
          <style>
            :host { display:block; position:sticky; top:0; z-index:1000; }
            section { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:10px 16px; background:#fff6d9; color:#292515; border-bottom:1px solid #bfa761; font:14px system-ui,sans-serif; }
            button,select { min-height:36px; font:inherit; }
            button { cursor:pointer; }
            button:focus-visible,select:focus-visible { outline:3px solid #126659; outline-offset:2px; }
          </style>
          <section aria-label="本地试玩控制">
            <strong>本地试玩</strong>
            <label>试玩人数 <select><option value="4">四人</option><option value="6">六人</option></select></label>
            <button data-action="toggle">暂停自动操作</button>
            <button data-action="step">执行下一步</button>
            <button data-action="reset">重新开始</button>
            ${withGallery ? '<button data-action="gallery">返回预览库</button>' : ""}
            <span role="status" aria-live="polite"></span>
          </section>`;
          document.body.prepend(host);
          const buttons = [...root.querySelectorAll("button")];
          const select = root.querySelector("select")!;
          const status = root.querySelector("[role=status]")!;
          function render(state: Controls) {
            buttons[0]!.textContent = state.paused
              ? "继续自动操作"
              : "暂停自动操作";
            select.value = String(state.playerCount);
            status.textContent = state.message;
          }
          async function control(action: string) {
            for (const button of buttons) button.disabled = true;
            select.disabled = true;
            try {
              const state = await (
                window as unknown as {
                  dglzPlayControl: (
                    action: string,
                    count: number,
                  ) => Promise<Controls>;
                }
              ).dglzPlayControl(action, Number(select.value));
              render(state);
              if (state.roomUrl !== undefined) location.assign(state.roomUrl);
            } catch {
              status.textContent = "试玩连接已关闭，请重新运行试玩命令。";
            } finally {
              for (const button of buttons) button.disabled = false;
              select.disabled = false;
            }
          }
          for (const button of buttons) {
            button.addEventListener("click", () => {
              void control(button.dataset.action!);
            });
          }
          window.addEventListener("dglz-play-error", () =>
            render({
              paused: true,
              playerCount: Number(select.value),
              message: "自动操作失败，已暂停；请重新开始。",
            }),
          );
          void control("status");
        },
        { once: true },
      );
    }, onGallery !== undefined);

    await page.goto(await reset(4));
    await page.getByTestId("hand-card").first().waitFor();
    function schedule() {
      if (closed) return;
      timer = setTimeout(() => {
        void serialize(async () => {
          if (!paused && !closed) await step();
        })
          .catch(async (error: unknown) => {
            paused = true;
            console.error("自动操作失败：", error);
            await page
              .evaluate(() =>
                window.dispatchEvent(new Event("dglz-play-error")),
              )
              .catch(() => {});
          })
          .finally(schedule);
      }, 700);
    }
    schedule();
    return { page, close };
  } catch (error) {
    await close();
    throw error;
  }
}

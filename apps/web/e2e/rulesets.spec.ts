import { createServer } from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expect,
  test as base,
  type Browser,
  type Page,
} from "@playwright/test";
import { io, type Socket } from "socket.io-client";
import {
  LoginResponseEnvelopeSchema,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  RoomCommandAckSchema,
  RoomResponseEnvelopeSchema,
  SOCKET_ROOM_COMMAND_EVENT,
  type RoomCommandAck,
  type RoomCommandPayload,
  type RoomViewData,
} from "@dglz/protocol";

import { createApp } from "../../server/dist/app.js";
import { provisionAccount } from "../../server/dist/auth.js";
import { openDatabase } from "../../server/dist/db/index.js";

const PASSWORD = "correct horse battery staple";
const ACCOUNTS = ["alice", "bob", "charlie", "diana", "eve", "frank"] as const;

type Account = { accountId: string; username: string; password: string };
type App = Awaited<ReturnType<typeof createApp>>;

type TestServer = {
  app: App;
  url: string;
  accounts: Account[];
};

async function reservePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
  });
  const address = reservation.address();
  if (address === null || typeof address === "string") {
    throw new Error("missing-test-port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) =>
      error === undefined ? resolve() : reject(error),
    );
  });
  return port;
}

async function startServer(): Promise<
  TestServer & { close: () => Promise<void> }
> {
  const directory = await mkdtemp(join(tmpdir(), "dglz-web-e2e-"));
  const dbPath = join(directory, "server.sqlite");
  const database = openDatabase(dbPath);
  const accounts: Account[] = [];
  try {
    for (const username of ACCOUNTS) {
      const account = await provisionAccount(database, {
        username,
        password: PASSWORD,
      });
      accounts.push({ ...account, password: PASSWORD });
    }
  } finally {
    database.close();
  }

  const port = await reservePort();
  const app = await createApp({
    allowedOrigin: `http://127.0.0.1:${port}`,
    dbPath,
    secureCookies: false,
    webRoot: fileURLToPath(new URL("../dist/", import.meta.url)),
  });
  await app.listen({ host: "127.0.0.1", port });
  const url = `http://127.0.0.1:${port}`;
  return {
    app,
    url,
    accounts,
    close: async () => {
      await app.close();
      await rm(directory, {
        force: true,
        maxRetries: 3,
        recursive: true,
        retryDelay: 100,
      });
    },
  };
}

const test = base.extend<{
  testServer: TestServer & { close: () => Promise<void> };
}>({
  testServer: async ({ browser }, use) => {
    void browser;
    const server = await startServer();
    try {
      await use(server);
    } finally {
      await server.close();
    }
  },
});

function protocolHeaders(): Record<string, string> {
  return { [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION) };
}

async function loginProtocol(
  url: string,
  account: Account,
): Promise<{ accountId: string; cookie: string }> {
  const response = await fetch(`${url}/api/login`, {
    body: JSON.stringify({
      username: account.username,
      password: account.password,
    }),
    headers: { ...protocolHeaders(), "content-type": "application/json" },
    method: "POST",
  });
  expect(response.ok).toBe(true);
  const envelope = LoginResponseEnvelopeSchema.parse(await response.json());
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookie = headers.getSetCookie?.()[0] ?? headers.get("set-cookie");
  const cookie = setCookie?.split(";", 1)[0];
  if (cookie === undefined) throw new Error("missing-session-cookie");
  return { accountId: envelope.data.accountId, cookie };
}

async function readRoom(
  url: string,
  roomId: string,
  cookie: string,
): Promise<RoomViewData> {
  const response = await fetch(`${url}/api/rooms/${roomId}`, {
    headers: { ...protocolHeaders(), cookie },
  });
  expect(response.ok).toBe(true);
  return RoomResponseEnvelopeSchema.parse(await response.json()).data;
}

class ProtocolClient {
  public staleJoinRetries = 0;
  private readonly socket: Socket;

  public constructor(
    private readonly url: string,
    private readonly cookie: string,
  ) {
    this.socket = io(url, {
      autoConnect: false,
      auth: { protocolVersion: PROTOCOL_VERSION },
      extraHeaders: { cookie },
      transports: ["websocket"],
    });
  }

  public async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        this.socket.off("connect_error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        this.socket.off("connect", onConnect);
        reject(error);
      };
      this.socket.once("connect", onConnect);
      this.socket.once("connect_error", onError);
      this.socket.connect();
    });
  }

  private emit(
    roomId: string,
    expectedRevision: number,
    payload: RoomCommandPayload,
  ): Promise<RoomCommandAck> {
    return new Promise((resolve, reject) => {
      this.socket.timeout(5_000).emit(
        SOCKET_ROOM_COMMAND_EVENT,
        {
          protocolVersion: PROTOCOL_VERSION,
          commandId: crypto.randomUUID(),
          expectedRevision,
          payload,
          roomId,
        },
        (error: Error | null, raw: unknown) => {
          if (error !== null) {
            reject(error);
            return;
          }
          const parsed = RoomCommandAckSchema.safeParse(raw);
          if (!parsed.success) {
            reject(new Error("invalid-command-ack"));
            return;
          }
          resolve(parsed.data);
        },
      );
    });
  }

  public async join(roomId: string): Promise<RoomViewData> {
    let expectedRevision = 1;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await this.emit(roomId, expectedRevision, {
        type: "JoinRoom",
      });
      if (result.ok) return result.data;
      if (
        result.error.code === "stale-revision" &&
        result.error.currentRevision !== undefined
      ) {
        this.staleJoinRetries += 1;
        expectedRevision = result.error.currentRevision;
        continue;
      }
      throw new Error(`join-failed:${result.error.code}`);
    }
    throw new Error("join-retry-limit");
  }

  public async command(
    url: string,
    roomId: string,
    payload: RoomCommandPayload,
  ): Promise<RoomViewData> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = await readRoom(url, roomId, this.cookie);
      const result = await this.emit(roomId, current.revision, payload);
      if (result.ok) return result.data;
      if (result.error.code === "stale-revision") continue;
      throw new Error(`command-failed:${result.error.code}`);
    }
    throw new Error("command-retry-limit");
  }

  public close(): void {
    this.socket.close();
  }
}

async function loginUi(
  page: Page,
  url: string,
  account: Account,
  destination = `${url}/`,
): Promise<void> {
  await page.goto(destination);
  await page.getByLabel("用户名").fill(account.username);
  await page.getByLabel("密码").fill(account.password);
  await page.getByRole("button", { name: "登录" }).click();
  if (destination === `${url}/`) {
    await expect(
      page.getByRole("heading", { name: "今晚，怎么打？" }),
    ).toBeVisible();
  }
}

async function createRoom(
  page: Page,
  url: string,
  rulesetId: string,
): Promise<string> {
  await page.getByLabel("人数").selectOption(rulesetId);
  await page
    .getByLabel("座位安排")
    .selectOption(rulesetId === "dglz-6p-3d-v1" ? "randomized" : "fixed");
  await page.getByRole("button", { name: "创建房间" }).click();
  await expect(page.getByTestId("room-lifecycle")).toHaveText("大厅");
  expect(page.url()).toContain("/rooms/");
  expect(new URL(page.url()).origin).toBe(url);
  return page.url();
}

async function chooseFirstSeat(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "选择此座" }).first();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByText("你的座位")).toBeVisible();
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

async function runHappyPath(
  browser: Browser,
  server: TestServer,
  rulesetId: "dglz-4p-2d-v1" | "dglz-6p-3d-v1",
  playerCount: 4 | 6,
): Promise<void> {
  const ownerContext = await browser.newContext({
    viewport: { height: 900, width: 1280 },
  });
  const joinerContext = await browser.newContext({
    viewport: { height: 900, width: 1280 },
  });
  const ownerPage = await ownerContext.newPage();
  const joinerPage = await joinerContext.newPage();
  const clients: ProtocolClient[] = [];
  try {
    const owner = server.accounts[0];
    const joiner = server.accounts[1];
    if (owner === undefined || joiner === undefined)
      throw new Error("missing-test-accounts");

    await loginUi(ownerPage, server.url, owner);
    const inviteUrl = await createRoom(ownerPage, server.url, rulesetId);
    await chooseFirstSeat(ownerPage);
    const roomId = new URL(inviteUrl).pathname.slice("/rooms/".length);

    await ownerPage.reload();
    await expect(ownerPage.getByTestId("room-lifecycle")).toHaveText("大厅");
    await expect(ownerPage.getByText("你的座位")).toBeVisible();

    await ownerContext.setOffline(true);
    await expect(ownerPage.getByRole("status")).toContainText("正在同步牌局…");
    await expect(
      ownerPage.getByRole("button", { name: "选择比赛" }),
    ).toBeDisabled();
    await expect(
      ownerPage.getByRole("button", { name: "准备就绪" }),
    ).toBeDisabled();
    await ownerContext.setOffline(false);
    await expect(
      ownerPage.getByRole("button", { name: "选择比赛" }),
    ).toBeEnabled();

    expect(await joinerContext.cookies()).toHaveLength(0);
    await loginUi(joinerPage, server.url, joiner, inviteUrl);
    await expect(joinerPage.getByTestId("room-lifecycle")).toHaveText("大厅");
    await chooseFirstSeat(joinerPage);

    for (const account of server.accounts.slice(2, playerCount)) {
      const session = await loginProtocol(server.url, account);
      const client = new ProtocolClient(server.url, session.cookie);
      await client.connect();
      clients.push(client);
    }
    await Promise.all(clients.map((client) => client.join(roomId)));
    expect(clients.some((client) => client.staleJoinRetries > 0)).toBe(true);

    await expect(
      ownerPage.getByText(`${playerCount} / ${playerCount} 位成员`),
    ).toBeVisible();
    await expect(
      ownerPage.getByRole("button", { name: "选择比赛" }),
    ).toBeEnabled();
    await ownerPage.getByRole("button", { name: "选择比赛" }).click();
    await expect(ownerPage.getByText("已选择比赛，等大家准备")).toBeVisible();

    for (const [index, client] of clients.entries()) {
      await client.command(server.url, roomId, {
        type: "AssignSeat",
        seatIndex: index + 2,
      });
    }

    await expect(
      ownerPage.getByRole("button", { name: "准备就绪" }),
    ).toBeEnabled();
    await ownerPage.getByRole("button", { name: "准备就绪" }).click();
    await expect(
      ownerPage.getByRole("button", { name: "取消准备" }),
    ).toBeVisible();
    await ownerPage.reload();
    await expect(
      ownerPage.getByRole("button", { name: "取消准备" }),
    ).toBeEnabled();
    await expect(ownerPage.getByText("已选择比赛，等大家准备")).toBeVisible();
    await expect(
      joinerPage.getByRole("button", { name: "准备就绪" }),
    ).toBeEnabled();
    await joinerPage.getByRole("button", { name: "准备就绪" }).click();
    for (const client of clients) {
      await client.command(server.url, roomId, {
        type: "SetReadiness",
        ready: true,
      });
    }

    await expect(ownerPage.getByTestId("room-lifecycle")).toHaveText(
      "牌局进行中",
    );
    await expect(joinerPage.getByTestId("room-lifecycle")).toHaveText(
      "牌局进行中",
    );
    await expect(ownerPage.getByTestId("hand-card")).toHaveCount(27);
    await expect(joinerPage.getByTestId("hand-card")).toHaveCount(27);

    const ownerCards = await ownerPage
      .getByTestId("hand-card")
      .evaluateAll((cards) =>
        cards.map((card) => card.getAttribute("data-card")),
      );
    const joinerCards = await joinerPage
      .getByTestId("hand-card")
      .evaluateAll((cards) =>
        cards.map((card) => card.getAttribute("data-card")),
      );
    expect(
      ownerCards.some((card) => card !== null && joinerCards.includes(card)),
    ).toBe(false);

    await ownerPage.reload();
    await expect(ownerPage.getByTestId("room-lifecycle")).toHaveText(
      "牌局进行中",
    );
    await expect(ownerPage.getByTestId("hand-card")).toHaveCount(27);
    const reloadedCards = await ownerPage
      .getByTestId("hand-card")
      .evaluateAll((cards) =>
        cards.map((card) => card.getAttribute("data-card")),
      );
    expect(reloadedCards).toEqual(ownerCards);

    await ownerContext.setOffline(true);
    await expect(ownerPage.getByRole("status")).toContainText("正在同步牌局…");
    await ownerContext.setOffline(false);
    await expect(ownerPage.getByRole("status")).toHaveText(
      "已连接 · 牌局已同步",
    );

    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await expect(ownerPage.getByTestId("hand-card").first()).toBeInViewport();
    await expect(ownerPage.getByTestId("hand-card").last()).toBeVisible();
    await assertNoHorizontalOverflow(ownerPage);
    await mkdir("output/playwright", { recursive: true });
    await ownerPage.screenshot({
      path: `output/playwright/${rulesetId}-mobile.png`,
      fullPage: true,
    });
    await ownerPage.setViewportSize({ width: 1280, height: 900 });
    await assertNoHorizontalOverflow(ownerPage);
    await ownerPage.screenshot({
      path: `output/playwright/${rulesetId}-desktop.png`,
      fullPage: true,
    });
    await ownerPage.getByRole("button", { name: "退出登录" }).click();
    await expect(
      ownerPage.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(ownerPage.getByTestId("hand-card")).toHaveCount(0);
    await ownerPage.getByLabel("用户名").fill(joiner.username);
    await ownerPage.getByLabel("密码").fill(joiner.password);
    await ownerPage.getByRole("button", { name: "登录", exact: true }).click();
    await expect(ownerPage.getByTestId("hand-card")).toHaveCount(27);
    expect(
      await ownerPage
        .getByTestId("hand-card")
        .evaluateAll((cards) =>
          cards.map((card) => card.getAttribute("data-card")),
        ),
    ).toEqual(joinerCards);
  } finally {
    for (const client of clients) client.close();
    await Promise.all([ownerContext.close(), joinerContext.close()]);
  }
}

test("四人规则集可从创建走到首手并重连", async ({ browser, testServer }) => {
  await runHappyPath(browser, testServer, "dglz-4p-2d-v1", 4);
});

test("六人规则集可从创建走到首手并重连", async ({ browser, testServer }) => {
  await runHappyPath(browser, testServer, "dglz-6p-3d-v1", 6);
});

test("另一标签页切换账号后，重连清除原账号状态", async ({
  browser,
  testServer,
}) => {
  const context = await browser.newContext();
  try {
    const first = await context.newPage();
    const second = await context.newPage();
    await loginUi(first, testServer.url, testServer.accounts[0]!);
    const invite = await createRoom(first, testServer.url, "dglz-4p-2d-v1");
    await second.goto(invite);
    await expect(second.getByTestId("room-lifecycle")).toHaveText("大厅");
    await second.getByRole("button", { name: "退出登录" }).click();
    await second.getByLabel("用户名").fill("bob");
    await second.getByLabel("密码").fill(PASSWORD);
    await second.getByRole("button", { name: "登录", exact: true }).click();
    await expect(second.getByTestId("room-lifecycle")).toHaveText("大厅");
    await context.setOffline(true);
    await context.setOffline(false);
    await expect(
      first.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(first.getByTestId("room-lifecycle")).toHaveCount(0);
    await expect(first.getByRole("button", { name: "选择此座" })).toHaveCount(
      0,
    );
    expect(first.url()).toBe(invite);
    await first.getByRole("button", { name: "重试恢复登录" }).click();
    await expect(first.getByTestId("room-lifecycle")).toHaveText("大厅");
    await expect(first.locator("header").first()).toContainText("bob");
    await chooseFirstSeat(first);
    await expect(second.getByText("你的座位")).toBeVisible();
  } finally {
    await context.close();
  }
});

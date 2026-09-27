import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { decodeCardInstance } from "@dglz/game-rules";
import { io, type Socket } from "socket.io-client";
import {
  errorEnvelope,
  LoginResponseEnvelopeSchema,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  rulesConfigurationPreset,
  RoomCommandAckSchema,
  RoomResponseEnvelopeSchema,
  RoomViewSyncEnvelopeSchema,
  SOCKET_ROOM_COMMAND_EVENT,
  SOCKET_ROOM_VIEW_EVENT,
  type RoomCommandAck,
  type RoomCommandPayload,
  type RoomViewData,
} from "@dglz/protocol";

import { createApp } from "../../server/dist/app.js";
import { provisionAccount } from "../../server/dist/auth.js";
import { openDatabase } from "../../server/dist/db/index.js";

const PASSWORD = "correct horse battery staple";
const ACCOUNTS = [
  "alice",
  "bob",
  "charlie",
  "diana",
  "eve",
  "frank",
  "grace",
] as const;

type Account = { accountId: string; username: string; password: string };
type App = Awaited<ReturnType<typeof createApp>>;

type TestServer = {
  app: App;
  url: string;
  accounts: Account[];
  restart: (whileStopped?: () => Promise<void>) => Promise<void>;
  interruptRoom: (roomId: string) => Promise<void>;
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
  const options = {
    allowedOrigin: `http://127.0.0.1:${port}`,
    dbPath,
    secureCookies: false,
    webRoot: fileURLToPath(new URL("../dist/", import.meta.url)),
  };
  let app = await createApp(options);
  await app.listen({ host: "127.0.0.1", port });
  const url = `http://127.0.0.1:${port}`;
  async function stop() {
    // Simulated shutdown drops browser preconnects; app.close still cleans up sockets and SQLite.
    app.server.close();
    app.server.closeAllConnections();
    await app.close();
  }
  async function restart(whileStopped?: () => Promise<void>) {
    await stop();
    await whileStopped?.();
    app = await createApp(options);
    await app.listen({ host: "127.0.0.1", port });
  }
  return {
    get app() {
      return app;
    },
    url,
    accounts,
    restart,
    async interruptRoom(roomId: string) {
      const damaged = openDatabase(dbPath);
      try {
        damaged.sqlite
          .prepare(
            "UPDATE room_events SET event_schema_version = 999 WHERE room_id = ? AND sequence = (SELECT MAX(sequence) FROM room_events WHERE room_id = ?)",
          )
          .run(roomId, roomId);
      } finally {
        damaged.close();
      }
      await restart();
    },
    close: async () => {
      await stop();
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
    test
      .info()
      .annotations.push({ type: "browser", description: browser.version() });
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
  private latest: RoomViewData | undefined;

  public constructor(
    private readonly url: string,
    private readonly cookie: string,
    roomId?: string,
  ) {
    this.socket = io(url, {
      autoConnect: false,
      auth: {
        protocolVersion: PROTOCOL_VERSION,
        ...(roomId === undefined ? {} : { roomId }),
      },
      extraHeaders: { cookie },
      transports: ["websocket"],
    });
    this.socket.on(SOCKET_ROOM_VIEW_EVENT, (raw: unknown) => {
      const parsed = RoomViewSyncEnvelopeSchema.safeParse(raw);
      if (
        parsed.success &&
        (this.latest === undefined ||
          parsed.data.data.revision >= this.latest.revision)
      ) {
        this.latest = parsed.data.data;
      }
    });
  }

  public async connect(): Promise<void> {
    if (this.socket.connected) return;
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
      if (result.ok) {
        if ("left" in result.data) throw new Error("unexpected-departure");
        this.latest = result.data;
        this.socket.auth = { protocolVersion: PROTOCOL_VERSION, roomId };
        return result.data;
      }
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
      const current =
        this.latest?.view.roomId === roomId
          ? this.latest
          : await readRoom(url, roomId, this.cookie);
      const result = await this.emit(roomId, current.revision, payload);
      if (result.ok) {
        if ("left" in result.data) throw new Error("unexpected-departure");
        this.latest = result.data;
        return result.data;
      }
      if (result.error.code === "stale-revision") {
        this.latest = undefined;
        continue;
      }
      throw new Error(`command-failed:${result.error.code}`);
    }
    throw new Error("command-retry-limit");
  }

  public snapshot(roomId: string): RoomViewData | undefined {
    return this.latest?.view.roomId === roomId ? this.latest : undefined;
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
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("button", { name: "离座", exact: true }),
  ).toBeVisible();
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

async function captureScreenshot(page: Page, name: string): Promise<void> {
  const path = test.info().outputPath(name);
  await page.screenshot({ path, fullPage: true });
  await test.info().attach(name, { path, contentType: "image/png" });
}

async function copyAndCheck(
  page: Page,
  button: string,
  value: string,
): Promise<void> {
  const canRead = page.context().browser()?.browserType().name() === "chromium";
  if (canRead)
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已复制" }),
  ).toHaveText("已复制，可分享给好友。");
  if (canRead)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      value,
    );
}

type ActiveRoomView = Extract<RoomViewData["view"], { lifecycle: "ACTIVE" }>;

function activeView(room: RoomViewData): ActiveRoomView {
  if (room.view.lifecycle !== "ACTIVE") throw new Error("room-not-active");
  return room.view;
}

async function contextCookie(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies();
  const cookie = cookies
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  if (cookie === "") throw new Error("missing-browser-cookie");
  return cookie;
}

async function playAndSettle(
  ownerPage: Page,
  joinerPage: Page,
  ownerContext: BrowserContext,
  url: string,
  roomId: string,
  owner: Account,
  joiner: Account,
  protocolClients: Map<string, ProtocolClient>,
  protocolCookies: Map<string, string>,
  protocolSockets: ProtocolClient[],
  screenshotPrefix: string,
  accounts: Account[],
): Promise<void> {
  const ownerCookie = await contextCookie(ownerContext);
  let latestRoom = await readRoom(url, roomId, ownerCookie);
  let browserPlayed = false;
  let browserPassed = false;
  let browserPlayCount = 0;
  let keyboardUsed = false;
  let touchUsed = false;
  let browserSocketsReady = false;
  let browserProtocolReady = false;
  let playScreenshotCaptured = false;

  async function connectBrowserPlayers(): Promise<void> {
    if (browserSocketsReady) return;
    for (const account of [owner, joiner]) {
      const { cookie } = await loginProtocol(url, account);
      const client = new ProtocolClient(url, cookie, roomId);
      await client.connect();
      protocolClients.set(account.accountId, client);
      protocolCookies.set(account.accountId, cookie);
      protocolSockets.push(client);
    }
    browserSocketsReady = true;
  }

  async function promoteBrowserPlayers(): Promise<void> {
    if (
      browserProtocolReady ||
      !browserSocketsReady ||
      !browserPlayed ||
      !browserPassed ||
      browserPlayCount < 2 ||
      !keyboardUsed ||
      !touchUsed
    )
      return;
    browserProtocolReady = true;
  }

  for (let move = 0; move < 2_000; move += 1) {
    const room = latestRoom;
    const view = activeView(room);
    if (view.completedHandCount === 1) {
      expect(browserPlayed).toBe(true);
      expect(browserPassed).toBe(true);
      expect(keyboardUsed).toBe(true);
      expect(touchUsed).toBe(true);
      expect(view.handNumber).toBe(2);
      expect(view.lastHandResult?.handNumber).toBe(1);
      for (const page of [ownerPage, joinerPage]) {
        await expect(
          page.getByRole("region", { name: "上一局结果" }),
        ).toBeVisible();
        await assertNoHorizontalOverflow(page);
      }
      await completeSetup(
        ownerPage,
        url,
        roomId,
        latestRoom,
        accounts,
        protocolClients,
        protocolCookies,
        screenshotPrefix,
      );
      return;
    }

    const actor = view.currentActor;
    if (actor === undefined) throw new Error("missing-current-actor");
    const isBrowserActor =
      actor === owner.accountId || actor === joiner.accountId;
    const routePassToProtocol =
      isBrowserActor && browserSocketsReady && view.unbeatenPlay !== undefined;
    const browserPage = browserProtocolReady
      ? undefined
      : routePassToProtocol
        ? undefined
        : actor === owner.accountId
          ? ownerPage
          : actor === joiner.accountId
            ? joinerPage
            : undefined;

    if (browserPage !== undefined) {
      const cards = browserPage.getByTestId("hand-card");
      await expect(cards).not.toHaveCount(0);
      if (view.unbeatenPlay !== undefined) {
        const pass = browserPage.getByRole("button", {
          exact: true,
          name: "不出",
        });
        await expect(pass).toBeEnabled();
        await pass.click();
        browserPassed = true;
      } else {
        const card = cards.first();
        const before = await cards.count();
        await card.focus();
        if (!keyboardUsed) {
          await browserPage.emulateMedia({ reducedMotion: "reduce" });
          await expect(card).toHaveCSS("transition-duration", "0s");
          await expect(card).toHaveCSS("animation-name", "none");
          await card.press("Enter");
          await browserPage.emulateMedia({ reducedMotion: "no-preference" });
          keyboardUsed = true;
        } else if (!touchUsed) {
          await card.tap();
          touchUsed = true;
        } else {
          await card.click();
        }
        await expect(card).toHaveAttribute("aria-pressed", "true");
        await expect(cards).toHaveCount(before);
        if (!playScreenshotCaptured) {
          await captureScreenshot(
            browserPage,
            `${screenshotPrefix}-active-play.png`,
          );
          playScreenshotCaptured = true;
        }
        const play = browserPage.getByRole("button", {
          exact: true,
          name: "出牌",
        });
        await expect(play).toBeEnabled();
        await play.click();
        browserPlayed = true;
        browserPlayCount += 1;
        await expect(cards).toHaveCount(before - 1);
      }
      await expect
        .poll(async () => (await readRoom(url, roomId, ownerCookie)).revision)
        .toBeGreaterThan(room.revision);
      latestRoom = await readRoom(url, roomId, ownerCookie);
      if (browserPassed) await connectBrowserPlayers();
      await promoteBrowserPlayers();
      continue;
    }

    const client = protocolClients.get(actor);
    const cookie = protocolCookies.get(actor);
    if (client === undefined || cookie === undefined) {
      throw new Error(`missing-protocol-client:${actor}`);
    }
    if (view.unbeatenPlay !== undefined) {
      latestRoom = await client.command(url, roomId, { type: "Pass" });
    } else {
      const actorView = activeView(
        client.snapshot(roomId) ?? (await readRoom(url, roomId, cookie)),
      );
      const card = actorView.hand[0];
      if (card === undefined) throw new Error(`empty-actor-hand:${actor}`);
      latestRoom = await client.command(url, roomId, {
        type: "Play",
        cards: [card],
      });
    }
  }
  throw new Error("hand-settlement-timeout");
}

async function completeSetup(
  page: Page,
  url: string,
  roomId: string,
  settled: RoomViewData,
  accounts: Account[],
  clients: Map<string, ProtocolClient>,
  cookies: Map<string, string>,
  screenshotPrefix: string,
): Promise<void> {
  let current = settled;
  let browserSubmitted = false;
  for (let choice = 0; choice < 40; choice += 1) {
    const view = activeView(current);
    const actor =
      view.setupStage === "play" ? view.currentActor : view.pendingPlayerIds[0];
    if (actor === undefined) throw new Error("missing-setup-actor");
    const client = clients.get(actor);
    const cookie = cookies.get(actor);
    if (client === undefined || cookie === undefined)
      throw new Error("missing-setup-client");
    const own = activeView(await readRoom(url, roomId, cookie));
    if (own.setupStage === "play") {
      expect(browserSubmitted).toBe(true);
      const card = own.hand.find((code) => {
        const decoded = decodeCardInstance(code);
        return decoded.ok && decoded.card.face.rank !== "BIG";
      });
      if (card === undefined) throw new Error("missing-next-hand-card");
      const played = activeView(
        await client.command(url, roomId, { type: "Play", cards: [card] }),
      );
      expect(played.handNumber).toBe(2);
      expect(played.unbeatenPlay?.playerId).toBe(actor);
      expect(played.lastHandResult).toEqual(view.lastHandResult);
      await expect(page.getByRole("region", { name: "开局选择" })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("region", { name: "上一局结果" }),
      ).toBeVisible();
      return;
    }

    let payload: RoomCommandPayload;
    let button: string;
    let selectedCards: typeof own.hand = [];
    let candidateCards = false;
    if (own.tieKind !== undefined && own.tieRound !== undefined) {
      payload = {
        type: "SubmitTieChoiceBallot",
        tieKind: own.tieKind,
        round: own.tieRound,
        candidateId: null,
      };
      button = "提交选择";
    } else if (own.setupStage === "tribute-selection") {
      const card = own.eligibleTributeCards[0];
      if (card === undefined) throw new Error("missing-eligible-tribute");
      selectedCards = [card];
      payload = { type: "SelectTributeCard", card };
      button = "确认进贡";
    } else {
      const offer = own.returnCandidates.find(
        (entry) => entry.giverId === actor,
      );
      const transfer = own.tributeTransfers.find(
        (entry) => entry.recipientId === actor,
      );
      const tribute =
        transfer === undefined ? undefined : decodeCardInstance(transfer.card);
      if (offer !== undefined) {
        const card = offer.candidateCards[0];
        if (card === undefined) throw new Error("missing-return-candidate");
        payload = { type: "SelectReturnCard", card };
        selectedCards = [card];
        candidateCards = true;
        button = "确认还牌";
      } else if (
        own.rulesConfiguration.rulesetId === "dglz-6p-3d-v1" &&
        own.rulesConfiguration.returnCardSelection ===
          "giver-choice-from-candidates" &&
        tribute?.ok &&
        tribute.card.face.kind === "joker"
      ) {
        const count = tribute.card.face.rank === "SMALL" ? 2 : 3;
        const ranks = new Set<string>();
        selectedCards = own.hand
          .filter((code) => {
            const decoded = decodeCardInstance(code);
            if (!decoded.ok || ranks.has(decoded.card.face.rank)) return false;
            ranks.add(decoded.card.face.rank);
            return true;
          })
          .slice(0, count);
        expect(selectedCards).toHaveLength(count);
        payload = {
          type: "OfferReturnCandidates",
          candidateCards: selectedCards,
        };
        button = "提交还牌候选";
      } else {
        const card = own.hand[0];
        if (card === undefined) throw new Error("missing-return-card");
        selectedCards = [card];
        payload = { type: "SelectReturnCard", card };
        button = "确认还牌";
      }
    }

    if (!browserSubmitted) {
      const account = accounts.find((entry) => entry.accountId === actor);
      if (account === undefined) throw new Error("missing-setup-account");
      await page.getByRole("button", { name: "退出登录" }).click();
      await expect(
        page.getByRole("button", { name: "登录", exact: true }),
      ).toBeVisible();
      await loginUi(page, url, account, `${url}/rooms/${roomId}`);
      await expect(
        page.getByRole("region", { name: "开局选择" }),
      ).toBeVisible();
      const setupAbort = page.getByRole("button", {
        name: "终止比赛",
        exact: true,
      });
      if (actor === own.ownerId) await expect(setupAbort).toBeEnabled();
      else await expect(setupAbort).toHaveCount(0);
      const summary = page.getByRole("region", { name: "上一局结果" });
      await expect(summary.getByRole("heading")).toContainText("第 1 局");
      const summaryText = await summary.innerText();
      await page.reload();
      await expect(
        page.getByRole("region", { name: "开局选择" }),
      ).toBeVisible();
      await expect(summary).toHaveText(summaryText, { useInnerText: true });
      const reloaded = activeView(
        await readRoom(url, roomId, await contextCookie(page.context())),
      );
      expect(reloaded.setupStage).toBe(own.setupStage);
      expect(reloaded.pendingPlayerIds).toEqual(own.pendingPlayerIds);
      expect(reloaded.hand).toEqual(own.hand);
      expect(reloaded.lastHandResult).toEqual(own.lastHandResult);
      await page.getByRole("button", { name: "收起上一局结果" }).click();
      await expect(summary.getByRole("heading")).toHaveCount(0);
      for (const card of selectedCards) {
        await page
          .locator(
            `[data-testid="${candidateCards ? "return-candidate" : "hand-card"}"][data-card="${card}"]`,
          )
          .click();
      }
      if (own.tieKind !== undefined) {
        await page
          .getByLabel(
            own.tieKind === "recipient-pairing" ? "配对选择" : "首家选择",
          )
          .selectOption("");
      }
      await expect(
        page.getByRole("button", { name: button, exact: true }),
      ).toBeEnabled();
      await assertNoHorizontalOverflow(page);
      await captureScreenshot(page, `${screenshotPrefix}-setup.png`);
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect
        .poll(async () => (await readRoom(url, roomId, cookie)).revision)
        .toBeGreaterThan(current.revision);
      current = await readRoom(url, roomId, cookie);
      browserSubmitted = true;
    } else {
      current = await client.command(url, roomId, payload);
    }
  }
  throw new Error("next-hand-setup-timeout");
}

async function runHappyPath(
  browser: Browser,
  server: TestServer,
  rulesetId: "dglz-4p-2d-v1" | "dglz-6p-3d-v1",
  playerCount: 4 | 6,
): Promise<void> {
  const ownerContext = await browser.newContext({
    hasTouch: true,
  });
  const joinerContext = await browser.newContext({
    hasTouch: true,
  });
  const ownerPage = await ownerContext.newPage();
  const joinerPage = await joinerContext.newPage();
  const clients: ProtocolClient[] = [];
  const protocolClients = new Map<string, ProtocolClient>();
  const protocolCookies = new Map<string, string>();
  try {
    const owner = server.accounts[0];
    const joiner = server.accounts[1];
    if (owner === undefined || joiner === undefined)
      throw new Error("missing-test-accounts");

    await loginUi(ownerPage, server.url, owner);
    // Closing a sole-member lobby is distinct from navigating away.
    const closedInvite = await createRoom(ownerPage, server.url, rulesetId);
    await ownerPage
      .getByRole("button", { name: "退出并关闭房间", exact: true })
      .click();
    await expect(
      ownerPage.getByRole("heading", { name: "今晚，怎么打？" }),
    ).toBeVisible();
    await ownerPage.goto(closedInvite);
    await expect(ownerPage.getByRole("alert")).toContainText(
      "房间已开局或关闭",
    );
    await ownerPage
      .getByRole("button", { name: "返回开桌", exact: true })
      .click();
    const inviteUrl = await createRoom(ownerPage, server.url, rulesetId);
    await chooseFirstSeat(ownerPage);
    const roomId = new URL(inviteUrl).pathname.slice("/rooms/".length);
    const preset = playerCount === 4 ? "省心" : "自主";
    await ownerPage.getByText("牌局规则", { exact: true }).click();
    await expect(
      ownerPage.getByRole("button", { name: "省心", exact: true }),
    ).toBeDisabled();
    if (preset === "省心") {
      await ownerPage
        .getByRole("button", { name: "自主", exact: true })
        .click();
      await expect(
        ownerPage.getByRole("button", { name: "自主", exact: true }),
      ).toBeDisabled();
    }
    await ownerPage.getByRole("button", { name: preset, exact: true }).click();
    const ownerCookie = await contextCookie(ownerContext);
    const seating = ownerPage.getByLabel("座位安排", { exact: true });
    const originalPolicy = playerCount === 4 ? "fixed" : "randomized";
    await seating.selectOption(
      originalPolicy === "fixed" ? "randomized" : "fixed",
    );
    await expect
      .poll(
        async () =>
          (await readRoom(server.url, roomId, ownerCookie)).view.seatingPolicy,
      )
      .toBe(originalPolicy === "fixed" ? "randomized" : "fixed");
    await expect(seating).toBeEnabled();
    await seating.selectOption(originalPolicy);
    await expect
      .poll(
        async () =>
          (await readRoom(server.url, roomId, ownerCookie)).view.seatingPolicy,
      )
      .toBe(originalPolicy);
    await expect
      .poll(
        async () =>
          (await readRoom(server.url, roomId, ownerCookie)).view
            .rulesConfiguration,
      )
      .toEqual(rulesConfigurationPreset(rulesetId, preset));

    await ownerPage.reload();
    await expect(ownerPage.getByTestId("room-lifecycle")).toHaveText("大厅");
    await expect(
      ownerPage.getByRole("button", { name: "离座", exact: true }),
    ).toBeVisible();

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
    await expect(
      joinerPage.getByLabel("座位安排", { exact: true }),
    ).toHaveCount(0);
    const otherOwnerTab = await ownerContext.newPage();
    await otherOwnerTab.goto(inviteUrl);
    await expect(otherOwnerTab.getByTestId("room-lifecycle")).toHaveText(
      "大厅",
    );
    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(ownerPage);
    await captureScreenshot(
      ownerPage,
      `${rulesetId}-lobby-controls-mobile.png`,
    );
    const leave = ownerPage.getByRole("button", {
      name: "退出房间",
      exact: true,
    });
    await leave.focus();
    await leave.press("Enter");
    for (const page of [ownerPage, otherOwnerTab])
      await expect(
        page.getByRole("heading", { name: "今晚，怎么打？" }),
      ).toBeVisible();
    await otherOwnerTab.close();
    await expect(
      joinerPage.getByLabel("座位安排", { exact: true }),
    ).toBeEnabled();
    await expect(
      joinerPage.getByRole("button", { name: "退出并关闭房间", exact: true }),
    ).toBeVisible();
    await ownerPage.goto(inviteUrl);
    await chooseFirstSeat(ownerPage);
    await joinerPage
      .getByRole("button", { name: "退出房间", exact: true })
      .click();
    await expect(
      joinerPage.getByRole("heading", { name: "今晚，怎么打？" }),
    ).toBeVisible();
    await expect(
      ownerPage.getByLabel("座位安排", { exact: true }),
    ).toBeEnabled();
    await joinerPage.goto(inviteUrl);
    await chooseFirstSeat(joinerPage);
    await ownerPage.setViewportSize({ width: 1280, height: 900 });
    await captureScreenshot(
      ownerPage,
      `${rulesetId}-lobby-controls-desktop.png`,
    );

    for (const account of server.accounts.slice(2, playerCount)) {
      const session = await loginProtocol(server.url, account);
      const client = new ProtocolClient(server.url, session.cookie);
      await client.connect();
      clients.push(client);
      protocolClients.set(session.accountId, client);
      protocolCookies.set(session.accountId, session.cookie);
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
      joinerPage.getByText("1 人已准备", { exact: true }),
    ).toBeVisible();
    await expect(
      joinerPage.getByRole("button", { name: "准备就绪" }),
    ).toBeEnabled();
    await joinerPage.getByRole("button", { name: "准备就绪" }).click();
    await expect(
      joinerPage.getByRole("button", { name: "取消准备" }),
    ).toBeVisible();
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

    await server.restart(async () => {
      for (const page of [ownerPage, joinerPage]) {
        await expect(page.getByRole("status")).toContainText("正在同步牌局…");
        await expect(
          page.getByRole("button", { name: "出牌", exact: true }),
        ).toBeDisabled();
      }
    });
    await Promise.all(clients.map((client) => client.connect()));
    for (const [page, cards] of [
      [ownerPage, ownerCards],
      [joinerPage, joinerCards],
    ] as const) {
      await expect(page.getByRole("status")).toHaveText("已连接 · 牌局已同步");
      await expect(page.getByTestId("hand-card")).toHaveCount(27);
      expect(
        await page
          .getByTestId("hand-card")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-card")),
          ),
      ).toEqual(cards);
    }

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

    await captureScreenshot(ownerPage, `${rulesetId}-mobile.png`);
    await ownerPage.setViewportSize({ width: 1280, height: 900 });
    await assertNoHorizontalOverflow(ownerPage);
    await captureScreenshot(ownerPage, `${rulesetId}-desktop.png`);
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

    await ownerPage.getByRole("button", { name: "退出登录" }).click();
    await expect(
      ownerPage.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await loginUi(ownerPage, server.url, owner, inviteUrl);
    await expect(ownerPage.getByTestId("room-lifecycle")).toHaveText(
      "牌局进行中",
    );
    await expect(ownerPage.getByTestId("hand-card")).toHaveCount(27);
    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await playAndSettle(
      ownerPage,
      joinerPage,
      ownerContext,
      server.url,
      roomId,
      owner,
      joiner,
      protocolClients,
      protocolCookies,
      clients,
      rulesetId,
      server.accounts,
    );
    // Setup may have signed this page into another player's account.
    await ownerPage.getByRole("button", { name: "退出登录" }).click();
    await expect(
      ownerPage.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await loginUi(ownerPage, server.url, owner, inviteUrl);
    const currentCookie = await contextCookie(ownerContext);
    const beforeAbort = activeView(
      await readRoom(server.url, roomId, currentCookie),
    );
    await ownerPage.getByRole("button", { name: "生成同牌挑战码" }).click();
    const codeField = ownerPage.getByLabel("本局同牌挑战码", { exact: true });
    await expect(codeField).toHaveValue(/^[0-9a-f]{12}$/);
    const challengeCode = await codeField.inputValue();
    await expect(
      ownerPage.getByRole("button", { name: "复制同牌挑战码" }),
    ).toBeEnabled();
    if (playerCount === 4) {
      await copyAndCheck(ownerPage, "复制同牌挑战码", challengeCode);
      await ownerPage.evaluate(() => {
        Object.defineProperty(navigator.clipboard, "writeText", {
          configurable: true,
          value: () =>
            Promise.reject(new DOMException("Denied", "NotAllowedError")),
        });
      });
      await ownerPage.getByRole("button", { name: "复制同牌挑战码" }).click();
      await expect(
        ownerPage.getByRole("status").filter({ hasText: "未能自动复制" }),
      ).toHaveText("未能自动复制，请选中挑战码或回放链接后手动复制。");
      await codeField.focus();
      expect(
        await codeField.evaluate((input: HTMLInputElement) =>
          input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
        ),
      ).toBe(challengeCode);
    }
    await expect(
      joinerPage.getByRole("button", { name: "终止比赛", exact: true }),
    ).toHaveCount(0);
    const abort = ownerPage.getByRole("button", {
      name: "终止比赛",
      exact: true,
    });
    await expect(abort).toBeEnabled();
    await ownerPage.getByTestId("hand-card").first().click();
    await expect(ownerPage.getByTestId("hand-card").first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await ownerContext.setOffline(true);
    await expect(abort).toBeDisabled();
    await ownerContext.setOffline(false);
    await expect(abort).toBeEnabled();
    await abort.focus();
    await abort.press("Enter");
    for (const page of [ownerPage, joinerPage]) {
      await expect(page.getByTestId("room-lifecycle")).toHaveText("大厅");
      await expect(page.getByLabel("座位安排", { exact: true })).toHaveCount(0);
      await expect(page.getByTestId("hand-card")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "终止比赛", exact: true }),
      ).toHaveCount(0);
      const summary = page.getByRole("region", {
        name: "比赛结果",
        exact: true,
      });
      await expect(summary).toContainText("比赛已终止");
      await expect(summary).toContainText("已完成 1 局");
      await expect(summary).not.toContainText("获胜");
    }
    const ended = await readRoom(server.url, roomId, currentCookie);
    expect(ended.view.lifecycle).toBe("LOBBY");
    if (ended.view.lifecycle !== "LOBBY") throw new Error("abort-not-in-lobby");
    expect(ended.view.matchSummary).toEqual({
      outcome: "aborted",
      completedHandCount: 1,
      teamLevels: beforeAbort.teamLevels,
    });
    expect(ended.view.lastHandResult).toEqual(beforeAbort.lastHandResult);
    expect(ended.view.members.every((member) => !member.ready)).toBe(true);
    expect(ended.view.selectedActivity).toBeUndefined();
    await ownerPage.reload();
    await expect(
      ownerPage.getByRole("region", { name: "比赛结果", exact: true }),
    ).toContainText("比赛已终止");
    expect(await readRoom(server.url, roomId, currentCookie)).toEqual(ended);
    await assertNoHorizontalOverflow(ownerPage);
    await captureScreenshot(ownerPage, `${rulesetId}-aborted-lobby.png`);
    await ownerPage.getByRole("button", { name: "选择比赛" }).click();
    await expect(ownerPage.getByText("已选择比赛，等大家准备")).toBeVisible();
    await ownerPage.getByRole("button", { name: "准备就绪" }).click();
    await expect(
      ownerPage.getByRole("button", { name: "取消准备" }),
    ).toBeVisible();
    for (const [accountId, client] of protocolClients) {
      if (accountId === owner.accountId) continue;
      await client.command(server.url, roomId, {
        type: "SetReadiness",
        ready: true,
      });
    }
    for (const page of [ownerPage, joinerPage]) {
      await expect(page.getByTestId("room-lifecycle")).toHaveText("牌局进行中");
      await expect(page.getByTestId("hand-card")).toHaveCount(27);
      await expect(
        page.locator('[data-testid="hand-card"][aria-pressed="true"]'),
      ).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "比赛结果", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "上一局结果", exact: true }),
      ).toHaveCount(0);
    }
    const restarted = activeView(
      await readRoom(server.url, roomId, currentCookie),
    );
    expect(restarted.handNumber).toBe(1);
    expect(restarted.completedHandCount).toBe(0);
    expect(restarted.lastHandResult).toBeUndefined();
    expect(restarted.teamLevels).toEqual(["2", "2"]);
    expect(restarted.matchRulesConfigurationLocked).toBe(true);
    expect(restarted.seatingPolicyLocked).toBe(true);
    expect(restarted.rulesConfiguration).toEqual(
      beforeAbort.rulesConfiguration,
    );
    expect(restarted.seatingPolicy).toBe(beforeAbort.seatingPolicy);
    await ownerPage
      .getByRole("button", { name: "终止比赛", exact: true })
      .click();
    await expect(ownerPage.getByTestId("room-lifecycle")).toHaveText("大厅");
    if (playerCount === 4) {
      await ownerPage
        .getByLabel("同牌挑战码", { exact: true })
        .fill("bad-code");
      await ownerPage
        .getByRole("button", { name: "查看牌局", exact: true })
        .click();
      await expect(ownerPage.getByRole("alert")).toHaveText(
        "请输入完整的 12 位同牌挑战码。",
      );
      await ownerPage
        .getByLabel("同牌挑战码", { exact: true })
        .fill("f".repeat(12));
      await ownerPage
        .getByRole("button", { name: "查看牌局", exact: true })
        .click();
      await expect(ownerPage.getByRole("alert")).toHaveText(
        "找不到可用的同牌挑战，请检查挑战码或本局是否已完成。",
      );
      await ownerPage.route(
        "**/api/challenges/lookup",
        async (route) => {
          const [response] = await Promise.all([
            route.fetch(),
            ownerPage
              .getByLabel("同牌挑战码", { exact: true })
              .fill("changed-code"),
          ]);
          await route.fulfill({ response });
        },
        { times: 1 },
      );
      await ownerPage
        .getByLabel("同牌挑战码", { exact: true })
        .fill(challengeCode);
      const [delayedResponse] = await Promise.all([
        ownerPage.waitForResponse("**/api/challenges/lookup", {
          timeout: 15_000,
        }),
        ownerPage
          .getByRole("button", { name: "查看牌局", exact: true })
          .click(),
      ]);
      expect(delayedResponse.status()).toBe(200);
      expect(await delayedResponse.finished()).toBeNull();
      await ownerPage.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(
        ownerPage.getByRole("button", { name: "查看牌局", exact: true }),
      ).toBeEnabled();
      await expect(
        ownerPage.getByRole("button", { name: "使用此牌局", exact: true }),
      ).toHaveCount(0);
    }
    await ownerPage
      .getByLabel("同牌挑战码", { exact: true })
      .fill(challengeCode);
    await ownerPage
      .getByRole("button", { name: "查看牌局", exact: true })
      .click();
    await ownerPage
      .getByRole("button", { name: "使用此牌局", exact: true })
      .click();
    for (const page of [ownerPage, joinerPage]) {
      await expect(
        page.getByText("已选择同牌挑战", { exact: false }),
      ).toBeVisible();
      await expect(page.getByTestId("hand-card")).toHaveCount(0);
    }
    const selected = await readRoom(server.url, roomId, currentCookie);
    expect(selected.view.selectedActivity).toBe("challenge");
    if (selected.view.lifecycle !== "LOBBY")
      throw new Error("challenge-selection-not-in-lobby");
    expect(selected.view.effectiveRulesConfiguration).toEqual(
      beforeAbort.rulesConfiguration,
    );
    await ownerPage.reload();
    await expect(
      ownerPage.getByText("已选择同牌挑战", { exact: false }),
    ).toBeVisible();
    for (const width of [390, 1280]) {
      await ownerPage.setViewportSize({ width, height: 900 });
      await assertNoHorizontalOverflow(ownerPage);
      await captureScreenshot(
        ownerPage,
        `${rulesetId}-challenge-lobby-${width}.png`,
      );
    }
    await ownerPage
      .getByRole("button", { name: "准备就绪", exact: true })
      .click();
    await expect(
      ownerPage.getByRole("button", { name: "取消准备" }),
    ).toBeVisible();
    for (const [accountId, client] of protocolClients) {
      if (accountId !== owner.accountId)
        await client.command(server.url, roomId, {
          type: "SetReadiness",
          ready: true,
        });
    }
    await expect(ownerPage.getByTestId("hand-card")).toHaveCount(27);
    const challengeStart = activeView(
      await readRoom(server.url, roomId, currentCookie),
    );
    expect(challengeStart.selectedActivity).toBe("challenge");
    expect(challengeStart.completedHandCount).toBeUndefined();
    expect(challengeStart.setupStage).toBe("play");
    const challengeCards = await ownerPage
      .getByTestId("hand-card")
      .evaluateAll((cards) =>
        cards.map((card) => card.getAttribute("data-card")),
      );
    const otherChallengeCards = await joinerPage
      .getByTestId("hand-card")
      .evaluateAll((cards) =>
        cards.map((card) => card.getAttribute("data-card")),
      );
    expect(
      challengeCards.some((card) => otherChallengeCards.includes(card)),
    ).toBe(false);
    await ownerPage.reload();
    await expect(ownerPage.getByTestId("hand-card")).toHaveCount(27);
    expect(
      await ownerPage
        .getByTestId("hand-card")
        .evaluateAll((cards) =>
          cards.map((card) => card.getAttribute("data-card")),
        ),
    ).toEqual(challengeCards);
    await expect(
      joinerPage.getByRole("button", { name: "终止同牌挑战", exact: true }),
    ).toHaveCount(0);
    for (const width of [390, 1280]) {
      await ownerPage.setViewportSize({ width, height: 900 });
      await assertNoHorizontalOverflow(ownerPage);
      await captureScreenshot(
        ownerPage,
        `${rulesetId}-challenge-active-${width}.png`,
      );
    }
    let challengeRoom = await readRoom(server.url, roomId, currentCookie);
    for (
      let move = 0;
      move < 2_000 && challengeRoom.view.lifecycle === "ACTIVE";
      move += 1
    ) {
      const actor = challengeRoom.view.currentActor;
      if (actor === undefined) throw new Error("missing-challenge-actor");
      const client = protocolClients.get(actor)!;
      if (challengeRoom.view.unbeatenPlay !== undefined) {
        challengeRoom = await client.command(server.url, roomId, {
          type: "Pass",
        });
      } else {
        await expect
          .poll(() => client.snapshot(roomId)?.revision, {
            intervals: [5, 10, 20],
          })
          .toBeGreaterThanOrEqual(challengeRoom.revision);
        const own = activeView(client.snapshot(roomId)!);
        challengeRoom = await client.command(server.url, roomId, {
          type: "Play",
          cards: [own.hand[0]!],
        });
      }
    }
    expect(challengeRoom.view.lifecycle).toBe("LOBBY");
    if (challengeRoom.view.lifecycle !== "LOBBY")
      throw new Error("challenge-completion-timeout");
    expect(challengeRoom.view.challengeSummary?.outcome).toBe("completed");
    expect(challengeRoom.view.selectedActivity).toBeUndefined();
    for (const page of [ownerPage, joinerPage]) {
      await expect(
        page.getByRole("region", { name: "同牌挑战结果", exact: true }),
      ).toContainText("同牌挑战已完成");
      await expect(page.getByTestId("hand-card")).toHaveCount(0);
    }
    await ownerPage.reload();
    await expect(
      ownerPage.getByRole("region", { name: "同牌挑战结果", exact: true }),
    ).toContainText("同牌挑战已完成");
    if (playerCount === 4) {
      for (const operation of ["lookup", "generate"] as const) {
        for (const code of ["unauthorized", "reload-required"] as const) {
          await test.step(`${operation}: ${code} clears the Room and allows recovery`, async () => {
            const endpoint =
              operation === "lookup"
                ? "**/api/challenges/lookup"
                : `**/api/rooms/${roomId}/challenges`;
            await ownerPage.route(
              endpoint,
              (route) =>
                route.fulfill({
                  status: code === "unauthorized" ? 401 : 409,
                  json: errorEnvelope(code),
                }),
              { times: 1 },
            );
            if (operation === "lookup") {
              await ownerPage
                .getByLabel("同牌挑战码", { exact: true })
                .fill(challengeCode);
              await ownerPage
                .getByRole("button", { name: "查看牌局", exact: true })
                .click();
            } else {
              await ownerPage
                .getByRole("button", { name: "生成同牌挑战码" })
                .click();
            }
            await expect(ownerPage.getByRole("alert")).toContainText(
              code === "unauthorized"
                ? "登录已失效，请重新登录。"
                : "版本已更新，请刷新页面。",
            );
            await expect(ownerPage.getByTestId("room-lifecycle")).toHaveCount(
              0,
            );
            await expect(
              ownerPage.getByRole("region", {
                name: "同牌挑战结果",
                exact: true,
              }),
            ).toHaveCount(0);
            await expect(
              ownerPage.getByRole("button", { name: "退出登录", exact: true }),
            ).toHaveCount(0);
            if (code === "unauthorized") {
              await expect(
                ownerPage.getByRole("button", { name: "登录", exact: true }),
              ).toBeVisible();
              // The injected failure leaves the real session valid; exercise session recovery.
              await ownerPage
                .getByRole("button", { name: "重试恢复登录", exact: true })
                .click();
            } else {
              await ownerPage
                .getByRole("button", { name: "刷新页面", exact: true })
                .click();
            }
            await expect(
              ownerPage.getByRole("region", {
                name: "同牌挑战结果",
                exact: true,
              }),
            ).toContainText("同牌挑战已完成");
            await expect(ownerPage.getByRole("alert")).toHaveCount(0);
          });
        }
      }
    }
    await ownerPage.getByRole("button", { name: "生成同牌挑战码" }).click();
    await expect(codeField).toHaveValue(/^[0-9a-f]{12}$/);
    const completedChallengeCode = await codeField.inputValue();
    await ownerPage.reload();
    await ownerPage.getByRole("button", { name: "生成同牌挑战码" }).click();
    await expect(codeField).toHaveValue(completedChallengeCode);
    for (const width of [390, 1280]) {
      await ownerPage.setViewportSize({ width, height: 900 });
      await assertNoHorizontalOverflow(ownerPage);
      await captureScreenshot(
        ownerPage,
        `${rulesetId}-challenge-result-${width}.png`,
      );
    }
    await ownerPage
      .getByLabel("同牌挑战码", { exact: true })
      .fill(challengeCode);
    await ownerPage
      .getByRole("button", { name: "查看牌局", exact: true })
      .click();
    await ownerPage
      .getByRole("button", { name: "使用此牌局", exact: true })
      .click();
    await ownerPage
      .getByRole("button", { name: "选择比赛", exact: true })
      .click();
    await expect(ownerPage.getByText("已选择比赛，等大家准备")).toBeVisible();
    await ownerPage
      .getByLabel("同牌挑战码", { exact: true })
      .fill(challengeCode);
    await ownerPage
      .getByRole("button", { name: "查看牌局", exact: true })
      .click();
    await ownerPage
      .getByRole("button", { name: "使用此牌局", exact: true })
      .click();
    await ownerPage
      .getByRole("button", { name: "准备就绪", exact: true })
      .click();
    await expect(
      ownerPage.getByRole("button", { name: "取消准备" }),
    ).toBeVisible();
    for (const [accountId, client] of protocolClients) {
      if (accountId !== owner.accountId)
        await client.command(server.url, roomId, {
          type: "SetReadiness",
          ready: true,
        });
    }
    await expect(ownerPage.getByTestId("hand-card")).toHaveCount(27);
    await ownerPage
      .getByRole("button", { name: "终止同牌挑战", exact: true })
      .click();
    for (const page of [ownerPage, joinerPage]) {
      await expect(page.getByTestId("room-lifecycle")).toHaveText("大厅");
      await expect(page.getByTestId("hand-card")).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "同牌挑战结果", exact: true }),
      ).toHaveCount(0);
    }
    // Same-Room fragment navigation must reconnect after closing the old socket.
    await ownerPage.evaluate(() => {
      location.hash = "room-navigation-check";
    });
    await expect(ownerPage.getByRole("status")).toHaveText(
      "已连接 · 牌局已同步",
    );
    await expect(
      ownerPage.getByRole("button", { name: "选择比赛", exact: true }),
    ).toBeEnabled();
    await ownerPage.goBack();
    await expect(ownerPage.getByRole("status")).toHaveText(
      "已连接 · 牌局已同步",
    );
    await expect(
      ownerPage.getByRole("button", { name: "选择比赛", exact: true }),
    ).toBeEnabled();
    // Replay is a separate read-only view; each browser owns its own position.
    for (const page of [ownerPage, joinerPage]) {
      await page.getByRole("link", { name: "牌局记录", exact: true }).click();
      await expect(page.getByTestId("history-hand")).toHaveCount(2);
      if (page === ownerPage) {
        await page
          .getByTestId("history-hand")
          .last()
          .getByRole("button", { name: "查看回放", exact: true })
          .click();
        await expect(page).toHaveURL(/\/history#hand=/);
      } else {
        await page
          .getByLabel("回放挑战码", { exact: true })
          .fill(challengeCode);
        await page
          .getByRole("region", { name: "查看一手牌的回放", exact: true })
          .getByRole("button", { name: "查看回放", exact: true })
          .click();
      }
      await expect(page.getByTestId("replay-position")).toHaveText(
        /^第 1 \/ \d+ 步$/,
      );
      await expect(page.getByTestId("replay-card")).toHaveCount(
        playerCount * 27,
      );
      await expect(page.getByText(/^本局级牌：/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "上一步", exact: true }),
      ).toBeDisabled();
    }
    // Manual lookup must survive an auth remount without reloading or navigating.
    const manualReplayUrl = joinerPage.url();
    await joinerPage
      .getByRole("button", { name: "退出登录", exact: true })
      .click();
    await expect(
      joinerPage.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await joinerPage.getByLabel("用户名").fill(joiner.username);
    await joinerPage.getByLabel("密码").fill(joiner.password);
    await joinerPage.getByRole("button", { name: "登录", exact: true }).click();
    await expect(joinerPage.getByTestId("replay-position")).toHaveText(
      /^第 1 \/ \d+ 步$/,
    );
    await expect(joinerPage.getByTestId("replay-card")).toHaveCount(
      playerCount * 27,
    );
    expect(joinerPage.url()).toBe(manualReplayUrl);
    const originalCards = await ownerPage
      .getByTestId("replay-card")
      .allTextContents();
    const privateReplayUrl = ownerPage.url();
    const sharedReplayUrl = await ownerPage
      .getByLabel("回放分享链接", { exact: true })
      .inputValue();
    expect(sharedReplayUrl).toBe(
      `${server.url}/history#replay=${challengeCode}`,
    );
    await copyAndCheck(ownerPage, "复制回放链接", sharedReplayUrl);
    await ownerPage
      .getByRole("button", { name: "下一步", exact: true })
      .click();
    await expect(ownerPage.getByTestId("replay-position")).toHaveText(
      /^第 2 \/ \d+ 步$/,
    );
    await expect(joinerPage.getByTestId("replay-position")).toHaveText(
      /^第 1 \/ \d+ 步$/,
    );
    await ownerPage
      .getByRole("button", { name: "上一步", exact: true })
      .click();
    await expect(ownerPage.getByTestId("replay-position")).toHaveText(
      /^第 1 \/ \d+ 步$/,
    );
    expect(
      await ownerPage.getByTestId("replay-card").allTextContents(),
    ).toEqual(originalCards);
    await ownerPage.clock.install();
    await ownerPage
      .getByRole("button", { name: "自动播放", exact: true })
      .click();
    await ownerPage.clock.runFor(1200);
    await expect(ownerPage.getByTestId("replay-position")).toHaveText(
      /^第 2 \/ \d+ 步$/,
    );
    await ownerPage
      .getByRole("button", { name: "暂停回放", exact: true })
      .click();
    const pausedPosition = await ownerPage
      .getByTestId("replay-position")
      .textContent();
    await ownerPage.clock.runFor(2400);
    await expect(ownerPage.getByTestId("replay-position")).toHaveText(
      pausedPosition!,
    );
    await ownerPage
      .getByRole("slider", { name: "回放进度", exact: true })
      .focus();
    await ownerPage.keyboard.press("Home");
    await expect(ownerPage.getByTestId("replay-position")).toHaveText(
      /^第 1 \/ \d+ 步$/,
    );
    await ownerPage.keyboard.press("End");
    await expect(
      ownerPage.getByRole("button", { name: "自动播放", exact: true }),
    ).toBeDisabled();
    await ownerPage.reload();
    await expect(ownerPage.getByTestId("replay-position")).toHaveText(
      /^第 1 \/ \d+ 步$/,
    );
    expect(ownerPage.url()).toBe(privateReplayUrl);
    await ownerPage
      .getByRole("button", { name: "查看结算", exact: true })
      .click();
    await expect(
      ownerPage.getByRole("button", { name: "下一步", exact: true }),
    ).toBeDisabled();
    await expect(
      ownerPage.getByRole("region", { name: "牌局回放", exact: true }),
    ).toContainText("本局结算");
    await ownerPage
      .getByRole("button", { name: "回到发牌", exact: true })
      .focus();
    await ownerPage.keyboard.press("Enter");
    await expect(ownerPage.getByTestId("replay-position")).toHaveText(
      /^第 1 \/ \d+ 步$/,
    );
    expect(
      await ownerPage.getByTestId("replay-card").allTextContents(),
    ).toEqual(originalCards);
    for (const width of [390, 1280]) {
      await ownerPage.setViewportSize({ width, height: 900 });
      await assertNoHorizontalOverflow(ownerPage);
      await captureScreenshot(ownerPage, `${rulesetId}-replay-${width}.png`);
    }
    // A recipient can follow the shared link through login without joining the source Room.
    await joinerPage
      .getByRole("button", { name: "退出登录", exact: true })
      .click();
    await loginUi(joinerPage, server.url, server.accounts[6]!, sharedReplayUrl);
    await expect(joinerPage.getByTestId("replay-position")).toHaveText(
      /^第 1 \/ \d+ 步$/,
    );
    await expect(
      joinerPage.getByText("还没有完成的牌局。", { exact: true }),
    ).toBeVisible();
    await joinerPage.reload();
    await expect(joinerPage.getByTestId("replay-card")).toHaveCount(
      playerCount * 27,
    );
    expect(joinerPage.url()).toBe(sharedReplayUrl);
    await joinerPage.goto(privateReplayUrl);
    await expect(joinerPage.getByRole("alert")).toContainText(
      "你无权查看这份回放。",
    );
    await expect(joinerPage.getByTestId("replay-card")).toHaveCount(0);
    await joinerPage.goBack();
    await expect(joinerPage.getByTestId("replay-position")).toHaveText(
      /^第 1 \/ \d+ 步$/,
    );
    // The existing Challenge selector receives the code in a fresh Room, including after reload.
    await joinerPage
      .getByRole("button", { name: "用此牌局开一桌", exact: true })
      .click();
    await expect(joinerPage.getByTestId("room-lifecycle")).toHaveText("大厅");
    const challengeRoomId = new URL(joinerPage.url()).pathname.slice(
      "/rooms/".length,
    );
    expect(challengeRoomId).not.toBe(roomId);
    await joinerPage.reload();
    await expect(
      joinerPage.getByLabel("同牌挑战码", { exact: true }),
    ).toHaveValue(challengeCode);
    await joinerPage
      .getByRole("button", { name: "查看牌局", exact: true })
      .click();
    await joinerPage
      .getByRole("button", { name: "使用此牌局", exact: true })
      .click();
    await expect(
      joinerPage.getByText("已选择同牌挑战 · 只打一局"),
    ).toBeVisible();
    await chooseFirstSeat(joinerPage);
    for (const [index, account] of server.accounts
      .slice(0, playerCount - 1)
      .entries()) {
      const cookie = protocolCookies.get(account.accountId);
      if (cookie === undefined)
        throw new Error("missing-challenge-player-session");
      const client = new ProtocolClient(server.url, cookie);
      clients.push(client);
      await client.connect();
      await client.join(challengeRoomId);
      await client.command(server.url, challengeRoomId, {
        type: "AssignSeat",
        seatIndex: index + 1,
      });
      await client.command(server.url, challengeRoomId, {
        type: "SetReadiness",
        ready: true,
      });
    }
    await joinerPage
      .getByRole("button", { name: "准备就绪", exact: true })
      .click();
    await expect(joinerPage.getByTestId("hand-card")).toHaveCount(27);
    await expect(
      joinerPage.getByRole("button", { name: "终止同牌挑战", exact: true }),
    ).toBeVisible();
    await expect(ownerPage.getByTestId("replay-position")).toHaveText(
      /^第 1 \/ \d+ 步$/,
    );
    const challengeOwnerCookie = await contextCookie(joinerContext);
    const sourceRoom = await readRoom(
      server.url,
      challengeRoomId,
      challengeOwnerCookie,
    );
    await server.interruptRoom(challengeRoomId);
    await joinerPage.reload();
    await expect(joinerPage.getByTestId("room-lifecycle")).toHaveText(
      "房间已中断",
    );
    await expect(joinerPage.getByTestId("hand-card")).toHaveCount(0);
    await ownerPage.goto(`${server.url}/rooms/${challengeRoomId}`);
    await expect(ownerPage.getByTestId("room-lifecycle")).toHaveText(
      "房间已中断",
    );
    await expect(
      ownerPage.getByRole("button", { name: "归档房间", exact: true }),
    ).toHaveCount(0);
    await expect(
      ownerPage.getByRole("button", { name: "沿用规则开新房间", exact: true }),
    ).toHaveCount(0);
    for (const width of [390, 1280]) {
      await joinerPage.setViewportSize({ width, height: 900 });
      await assertNoHorizontalOverflow(joinerPage);
      await captureScreenshot(
        joinerPage,
        `${rulesetId}-interrupted-${width}.png`,
      );
    }
    const replace = joinerPage.getByRole("button", {
      name: "沿用规则开新房间",
      exact: true,
    });
    await replace.focus();
    await replace.press("Enter");
    await expect(joinerPage.getByTestId("room-lifecycle")).toHaveText("大厅");
    const replacementId = new URL(joinerPage.url()).pathname.slice(
      "/rooms/".length,
    );
    expect(replacementId).not.toBe(challengeRoomId);
    const replacement = await readRoom(
      server.url,
      replacementId,
      challengeOwnerCookie,
    );
    expect(replacement.view.rulesConfiguration).toEqual(
      sourceRoom.view.rulesConfiguration,
    );
    expect(replacement.view).toMatchObject({
      seatingPolicy: "fixed",
      matchRulesConfigurationLocked: false,
      seatingPolicyLocked: false,
      members: [{ playerId: server.accounts[6]!.accountId, ready: false }],
    });
    expect(
      replacement.view.seats.every((seat) => seat.playerId === undefined),
    ).toBe(true);
    await joinerPage.goto(`${server.url}/rooms/${challengeRoomId}`);
    await joinerPage
      .getByRole("button", { name: "归档房间", exact: true })
      .click();
    for (const page of [ownerPage, joinerPage])
      await expect(page.getByTestId("room-lifecycle")).toHaveText("房间已归档");
    await joinerPage.reload();
    await expect(joinerPage.getByTestId("room-lifecycle")).toHaveText(
      "房间已归档",
    );
    await expect(
      joinerPage.getByRole("button", { name: "归档房间", exact: true }),
    ).toHaveCount(0);
    await ownerPage.goto(sharedReplayUrl);
    await expect(ownerPage.getByTestId("replay-position")).toHaveText(
      /^第 1 \/ \d+ 步$/,
    );
    await joinerPage.goto(sharedReplayUrl);
    await expect(joinerPage.getByTestId("replay-position")).toHaveText(
      /^第 1 \/ \d+ 步$/,
    );
    await ownerPage.getByLabel("回放挑战码", { exact: true }).fill("invalid");
    await expect(
      ownerPage.getByRole("region", { name: "牌局回放", exact: true }),
    ).toHaveCount(0);
    await ownerPage.route(
      "**/api/replays/lookup",
      async (route) => {
        const [response] = await Promise.all([
          route.fetch(),
          ownerPage.getByLabel("回放挑战码", { exact: true }).fill("invalid"),
        ]);
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    await ownerPage
      .getByLabel("回放挑战码", { exact: true })
      .fill(challengeCode);
    const [staleReplayResponse] = await Promise.all([
      ownerPage.waitForResponse("**/api/replays/lookup", {
        timeout: 15_000,
      }),
      ownerPage
        .getByRole("region", { name: "查看一手牌的回放", exact: true })
        .getByRole("button", { name: "查看回放", exact: true })
        .click(),
    ]);
    expect(staleReplayResponse.status()).toBe(200);
    expect(await staleReplayResponse.finished()).toBeNull();
    await ownerPage.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      ownerPage.getByRole("region", { name: "牌局回放", exact: true }),
    ).toHaveCount(0);
    await expect(
      ownerPage
        .getByRole("region", { name: "查看一手牌的回放", exact: true })
        .getByRole("button", { name: "查看回放", exact: true }),
    ).toBeEnabled();
    await ownerPage.route(
      "**/api/replays/lookup",
      (route) =>
        route.fulfill({ status: 401, json: errorEnvelope("unauthorized") }),
      { times: 1 },
    );
    await ownerPage
      .getByLabel("回放挑战码", { exact: true })
      .fill(challengeCode);
    await ownerPage
      .getByRole("region", { name: "查看一手牌的回放", exact: true })
      .getByRole("button", { name: "查看回放", exact: true })
      .click();
    await expect(
      ownerPage.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(
      ownerPage.getByRole("region", { name: "牌局回放", exact: true }),
    ).toHaveCount(0);
    await expect(joinerPage.getByTestId("replay-position")).toHaveText(
      /^第 1 \/ \d+ 步$/,
    );
  } finally {
    for (const client of clients) client.close();
    await Promise.all([ownerContext.close(), joinerContext.close()]);
  }
}

test("四人省心规则可续局、终止并重新比赛", async ({ browser, testServer }) => {
  test.setTimeout(Math.max(120_000, test.info().project.timeout));
  await runHappyPath(browser, testServer, "dglz-4p-2d-v1", 4);
});

test("六人自主规则可续局、终止并重新比赛", async ({ browser, testServer }) => {
  test.setTimeout(Math.max(120_000, test.info().project.timeout));
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
    await expect(
      second.getByRole("button", { name: "离座", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("修改密码后清除各标签页手牌并可用新密码返回牌局", async ({
  browser,
  testServer,
}) => {
  const context = await browser.newContext();
  const device = await browser.newContext();
  const clients: ProtocolClient[] = [];
  try {
    const page = await context.newPage();
    const otherTab = await context.newPage();
    const devicePage = await device.newPage();
    const owner = testServer.accounts[0]!;
    await loginUi(page, testServer.url, owner);
    const invite = await createRoom(page, testServer.url, "dglz-4p-2d-v1");
    const roomId = new URL(invite).pathname.slice(7);
    await chooseFirstSeat(page);
    await page.getByRole("button", { name: "选择比赛", exact: true }).click();
    for (const [index, account] of testServer.accounts.slice(1, 4).entries()) {
      const session = await loginProtocol(testServer.url, account);
      const client = new ProtocolClient(testServer.url, session.cookie);
      clients.push(client);
      await client.connect();
      await client.join(roomId);
      await client.command(testServer.url, roomId, {
        type: "AssignSeat",
        seatIndex: index + 1,
      });
      await client.command(testServer.url, roomId, {
        type: "SetReadiness",
        ready: true,
      });
    }
    await page.getByRole("button", { name: "准备就绪" }).click();
    await expect(page.getByTestId("hand-card")).toHaveCount(27);
    await otherTab.goto(invite);
    await expect(otherTab.getByTestId("hand-card")).toHaveCount(27);
    await loginUi(devicePage, testServer.url, owner, invite);
    await expect(devicePage.getByTestId("hand-card")).toHaveCount(27);
    const cards = await otherTab
      .getByTestId("hand-card")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-card")),
      );
    await page.getByRole("link", { name: "修改密码" }).click();
    await page.reload();
    await expect(page.getByRole("form", { name: "修改密码" })).toBeVisible();

    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await assertNoHorizontalOverflow(page);
      await captureScreenshot(page, `password-change-${width}.png`);
    }
    const current = page.getByLabel("当前密码", { exact: true });
    const next = page.getByLabel("新密码", { exact: true });
    const confirmation = page.getByLabel("确认新密码", { exact: true });
    const password = "new correct horse battery staple";
    await current.fill("wrong");
    await next.fill(password);
    await confirmation.fill("mismatch");
    await page.getByRole("button", { name: "确认修改" }).click();
    expect(
      await confirmation.evaluate(
        (node: HTMLInputElement) => node.validationMessage,
      ),
    ).toBe("两次输入的新密码不一致。");
    await confirmation.fill(password);
    await page.getByRole("button", { name: "确认修改" }).click();
    await expect(page.getByRole("alert")).toHaveText("当前密码不正确。");
    await expect(otherTab.getByTestId("hand-card")).toHaveCount(27);
    await current.fill(PASSWORD);
    await confirmation.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "确认修改" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("密码已修改");
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(
      otherTab.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(otherTab.getByTestId("hand-card")).toHaveCount(0);
    await devicePage
      .getByRole("button", { name: "终止比赛", exact: true })
      .click();
    await expect(
      devicePage.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(devicePage.getByTestId("hand-card")).toHaveCount(0);
    await page.getByLabel("用户名").fill(owner.username);
    await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("用户名或密码不正确");
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("form", { name: "修改密码" })).toBeVisible();
    await expect(page.getByLabel("当前密码", { exact: true })).toHaveValue("");
    await page.goto(invite);
    await expect(page.getByTestId("hand-card")).toHaveCount(27);
    expect(
      await page
        .getByTestId("hand-card")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-card")),
        ),
    ).toEqual(cards);
    await otherTab.reload();
    await expect(otherTab.getByTestId("hand-card")).toHaveCount(27);
  } finally {
    for (const client of clients) client.close();
    await Promise.all([context.close(), device.close()]);
  }
});

test("修改密码拒绝过期账户页面并处理响应丢失", async ({
  browser,
  testServer,
}) => {
  const context = await browser.newContext();
  const clients: ProtocolClient[] = [];
  let releaseResponse = () => {};
  try {
    const page = await context.newPage();
    const other = await context.newPage();
    const alice = testServer.accounts[0]!;
    const bob = testServer.accounts[1]!;
    await loginUi(page, testServer.url, alice, `${testServer.url}/account`);
    await other.goto(testServer.url);
    await other.getByRole("button", { name: "退出登录" }).click();
    await expect(
      other.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await loginUi(other, testServer.url, bob);
    await page.getByLabel("当前密码", { exact: true }).fill(PASSWORD);
    await page
      .getByLabel("新密码", { exact: true })
      .fill("must-not-change-bob");
    await page
      .getByLabel("确认新密码", { exact: true })
      .fill("must-not-change-bob");
    await page.getByRole("button", { name: "确认修改" }).click();
    await expect(page.getByRole("alert")).toContainText("登录已失效");
    await expect(page.getByRole("form", { name: "修改密码" })).toHaveCount(0);
    expect((await loginProtocol(testServer.url, bob)).accountId).toBe(
      bob.accountId,
    );

    await other.getByRole("button", { name: "退出登录" }).click();
    await expect(
      other.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await loginUi(page, testServer.url, alice);
    const invite = await createRoom(page, testServer.url, "dglz-4p-2d-v1");
    const roomId = new URL(invite).pathname.slice(7);
    await chooseFirstSeat(page);
    await page.getByRole("button", { name: "选择比赛", exact: true }).click();
    for (const [index, account] of testServer.accounts.slice(1, 4).entries()) {
      const session = await loginProtocol(testServer.url, account);
      const client = new ProtocolClient(testServer.url, session.cookie);
      clients.push(client);
      await client.connect();
      await client.join(roomId);
      await client.command(testServer.url, roomId, {
        type: "AssignSeat",
        seatIndex: index + 1,
      });
      await client.command(testServer.url, roomId, {
        type: "SetReadiness",
        ready: true,
      });
    }
    await page.getByRole("button", { name: "准备就绪" }).click();
    await expect(page.getByTestId("hand-card")).toHaveCount(27);
    await other.goto(invite);
    await expect(other.getByTestId("hand-card")).toHaveCount(27);
    await page.getByRole("link", { name: "修改密码" }).click();
    const password = "password-after-lost-response";
    let committed = false;
    const held = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    await page.route("**/api/account/password", async (route) => {
      const response = await route.fetch();
      committed = response.status() === 200;
      await held;
      await route.abort("failed");
    });
    await page.getByLabel("当前密码", { exact: true }).fill(PASSWORD);
    await page.getByLabel("新密码", { exact: true }).fill(password);
    await page.getByLabel("确认新密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "确认修改" }).click();
    await expect.poll(() => committed).toBe(true);
    // Keep the same App mounted, but change its operation generation before failure.
    await page.getByRole("link", { name: "大怪路子 好友牌局" }).click();
    await expect(
      page.getByRole("heading", { name: "今晚，怎么打？" }),
    ).toBeVisible();
    await expect(other.getByTestId("hand-card")).toHaveCount(27);
    releaseResponse();
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText("未能确认修改结果");
    expect(committed).toBe(true);
    await expect(page.getByRole("form", { name: "修改密码" })).toHaveCount(0);
    await expect(
      other.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(other.getByTestId("hand-card")).toHaveCount(0);
    await expect(other.getByRole("status")).toContainText(
      "请重新登录确认账户状态",
    );
    await page.getByLabel("用户名").fill(alice.username);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "今晚，怎么打？" }),
    ).toBeVisible();
    await page.goto(invite);
    await expect(page.getByTestId("hand-card")).toHaveCount(27);
  } finally {
    releaseResponse();
    for (const client of clients) client.close();
    await context.close();
  }
});

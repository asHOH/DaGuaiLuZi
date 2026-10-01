import { expect, test, type Page } from "@playwright/test";
import { decodeCardInstance } from "@dglz/game-rules";
import { RoomResponseEnvelopeSchema } from "@dglz/protocol";
import { openPlayground } from "../dev/playground";
import { protocolHeaders } from "./support";
import { selectionFeedback } from "../src/play-feedback";

async function room(page: Page) {
  const response = await page.request.get(
    page.url().replace("/rooms/", "/api/rooms/"),
    {
      headers: protocolHeaders(),
    },
  );
  expect(response.ok()).toBe(true);
  const data = RoomResponseEnvelopeSchema.parse(await response.json()).data;
  if (data.view.lifecycle !== "ACTIVE") throw new Error("expected-active-room");
  return { ...data, view: data.view };
}

async function expectTableAlignment(page: Page, playerCount: number) {
  const header = page.locator("header");
  await expect(header).toHaveCount(1);
  const headerBounds = (await header.boundingBox())!;
  expect(headerBounds.height).toBeLessThanOrEqual(50);
  for (const element of [
    header.getByRole("heading"),
    header.getByRole("status"),
    header.getByRole("button", { name: "终止比赛" }),
  ]) {
    const bounds = (await element.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(headerBounds.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(
      headerBounds.y + headerBounds.height,
    );
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(
      headerBounds.x + headerBounds.width,
    );
  }
  for (let position = 1; position < playerCount; position += 1) {
    const seat = page.locator(`[data-position="${position}"]`);
    const bounds = (await seat.boundingBox())!;
    const avatar = (await seat.getByTestId("player-avatar").boundingBox())!;
    expect(
      Math.abs(avatar.x + avatar.width / 2 - (bounds.x + bounds.width / 2)),
    ).toBeLessThan(1);
    const play = (await seat.locator(":scope > div").last().boundingBox())!;
    if (position === playerCount / 2 || page.viewportSize()!.width <= 1000) {
      expect(
        Math.abs(play.x + play.width / 2 - (avatar.x + avatar.width / 2)),
      ).toBeLessThan(1);
    } else {
      expect(
        Math.abs(play.y + play.height / 2 - (avatar.y + avatar.height / 2)),
      ).toBeLessThan(1);
    }
    for (const pass of await seat.getByText("不出", { exact: true }).all()) {
      await expect(pass).toHaveCSS("color", "rgb(240, 149, 149)");
      await expect(pass).toHaveCSS(
        "font-size",
        page.viewportSize()!.width <= 1000 ? "18px" : "22px",
      );
    }
  }
}

test("本地试玩可暂停、单步、刷新并切换六人桌", async ({ browser }) => {
  const playground = await openPlayground(browser);
  const page = playground.page;
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    const controls = page.getByRole("region", { name: "本地试玩控制" });
    await expect(page.getByTestId("hand-card")).toHaveCount(27);
    await controls.getByRole("button", { name: "暂停自动操作" }).click();
    await expect(
      controls.getByRole("button", { name: "继续自动操作" }),
    ).toBeEnabled();
    let current = await room(page);
    expect(current.view.seats).toHaveLength(4);
    await expect(page.getByTestId("remaining-count")).toHaveCount(1);
    await expect(page.getByTestId("player-avatar")).toHaveCount(3);
    await expect(
      page.locator('[data-self="true"]').getByTestId("player-avatar"),
    ).toHaveCount(0);
    for (const label of ["本人", "当前行动", "一队", "二队"]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    for (const name of ["修改密码", "牌局记录", "大怪路子"]) {
      await expect(page.getByRole("link", { name, exact: true })).toHaveCount(
        0,
      );
    }
    for (const name of ["退出登录", "返回开桌", "清空选择"]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
        0,
      );
    }
    await expect(page.getByText("邀请好友", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "你的手牌" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "终止比赛" })).toBeVisible();
    const status = page.locator("header").first().getByRole("status");
    await expect(status).toHaveAttribute("data-state", "ready");
    await expect(status.locator("svg")).toBeVisible();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expectTableAlignment(page, 4);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const playButton = page.getByRole("button", { name: "出牌", exact: true });
    const passButton = page.getByRole("button", { name: "不出", exact: true });
    const clearButton = page.getByRole("button", { name: "清空选择" });
    const handPanel = page.getByRole("region", {
      name: "你的手牌",
      exact: true,
    });
    const ownCount = handPanel.getByTestId("remaining-count");
    const countBounds = await ownCount.boundingBox();
    const firstCardBounds = await page
      .getByTestId("hand-card")
      .first()
      .boundingBox();
    expect(countBounds!.y + countBounds!.height).toBeLessThan(
      firstCardBounds!.y,
    );
    await page.screenshot({
      path: test.info().outputPath("four-player-desktop.png"),
      fullPage: true,
    });
    const pausedRevision = current.revision;
    const selectedCard = page.getByTestId("hand-card").first();
    await selectedCard.click({ position: { x: 12, y: 32 } });
    await expect(selectedCard).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "清空选择" })).toBeVisible();
    await expect(handPanel.locator('p[aria-live="polite"]')).toBeEmpty();
    expect(await ownCount.boundingBox()).toEqual(countBounds);
    expect((await room(page)).revision).toBe(pausedRevision);
    await selectedCard.press("Enter");
    await expect(selectedCard).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "清空选择" })).toHaveCount(0);
    for (const [playable, color] of [
      [true, "rgb(217, 245, 230)"],
      [false, "rgb(255, 226, 226)"],
    ] as const) {
      const card = current.view.hand.find((code) => {
        const feedback = selectionFeedback(current.view, [code]);
        return playable
          ? feedback.ok
          : !feedback.ok && feedback.reason === "response-not-stronger";
      });
      if (card === undefined) continue;
      const button = page.locator(
        `[data-testid="hand-card"][data-card="${card}"]`,
      );
      await button.click({ position: { x: 12, y: 32 } });
      await expect(button.locator(":scope > span")).toHaveCSS(
        "background-color",
        color,
      );
      await clearButton.click();
      await expect(button.locator(":scope > span")).toHaveCSS(
        "background-color",
        "rgb(255, 254, 251)",
      );
    }
    for (let index = 0; index < 4; index += 1) {
      await page
        .getByTestId("hand-card")
        .nth(index)
        .click({ position: { x: 12, y: 32 } });
    }
    for (const card of await page
      .locator('[data-testid="hand-card"][aria-pressed="true"] > span')
      .all()) {
      await expect(card).toHaveCSS("background-color", "rgb(255, 246, 205)");
    }
    await clearButton.click();
    // The driver runs in Node, so browser clock mocking cannot verify the pause.
    await page.waitForTimeout(1500);
    expect((await room(page)).revision).toBe(pausedRevision);

    if (current.view.currentActor === current.view.ownerId) {
      if (current.view.unbeatenPlay === undefined) {
        const card = current.view.hand.find((code) => {
          const decoded = decodeCardInstance(code);
          return decoded.ok && decoded.card.face.rank !== "BIG";
        });
        await page
          .locator(`[data-testid="hand-card"][data-card="${card}"]`)
          .click({ position: { x: 12, y: 32 } });
        await page.getByRole("button", { name: "出牌", exact: true }).click();
      } else {
        await page.getByRole("button", { name: "不出", exact: true }).click();
      }
      await expect
        .poll(async () => (await room(page)).revision)
        .toBeGreaterThan(current.revision);
      current = await room(page);
    }
    expect(current.view.currentActor).not.toBe(current.view.ownerId);
    await expect(handPanel).toHaveAttribute("data-own-turn", "false");
    await expect(handPanel).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
    await expect(playButton).toHaveCount(0);
    await expect(passButton).toHaveCount(0);
    await page
      .getByTestId("hand-card")
      .first()
      .click({ position: { x: 12, y: 32 } });
    await expect(clearButton).toBeEnabled();
    await clearButton.click();
    await expect(page.getByTestId("hand-card").first()).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.screenshot({
      path: test.info().outputPath("four-player-off-turn.png"),
      fullPage: true,
    });
    await controls.getByRole("button", { name: "执行下一步" }).click();
    await expect(controls.getByRole("status")).toHaveText("已执行一步。");
    await expect
      .poll(async () => (await room(page)).revision)
      .toBeGreaterThan(current.revision);
    expect((await room(page)).view.hand).toEqual(current.view.hand);

    const retained = (await room(page)).view.latestPlays;
    await expectTableAlignment(page, 4);
    await expect(page.getByTestId("played-hand")).toHaveCount(retained.length);
    await page.reload();
    await expect(
      controls.getByRole("button", { name: "继续自动操作" }),
    ).toBeEnabled();
    await expect(page.getByTestId("hand-card")).toHaveCount(
      current.view.hand.length,
    );
    expect((await room(page)).view.latestPlays).toEqual(retained);
    for (const play of retained) {
      const displayed = page
        .locator(`[data-seat="${play.seatIndex}"]`)
        .getByTestId("played-hand");
      await expect(displayed).toBeVisible();
      for (const card of play.cards)
        await expect(displayed.locator(`[data-card="${card}"]`)).toHaveCount(1);
    }
    const oldUrl = page.url();
    await controls.getByLabel("试玩人数").selectOption("6");
    await controls.getByRole("button", { name: "重新开始" }).click();
    await expect(page).not.toHaveURL(oldUrl);
    await expect(page.getByTestId("hand-card")).toHaveCount(27);
    await expect(
      controls.getByRole("button", { name: "继续自动操作" }),
    ).toBeEnabled();
    current = await room(page);
    expect(current.view.seats).toHaveLength(6);
    await expect(page.getByTestId("player-avatar")).toHaveCount(5);
    expect(current.view.handSizes).toEqual([27, 27, 27, 27, 27, 27]);
    await expect(page.getByTestId("remaining-count")).toHaveCount(1);

    for (
      let step = 0;
      step < 20 && current.view.currentActor !== current.view.ownerId;
      step += 1
    ) {
      await controls.getByRole("button", { name: "执行下一步" }).click();
      await expect(
        controls.getByRole("button", { name: "执行下一步" }),
      ).toBeEnabled();
      current = await room(page);
    }
    expect(current.view.currentActor).toBe(current.view.ownerId);
    await expect(handPanel).toHaveAttribute("data-own-turn", "true");
    await expect(handPanel).toHaveCSS("border-top-width", "3px");
    await expect(handPanel).toHaveCSS("border-top-color", "rgb(236, 199, 104)");
    await expect(playButton).toBeVisible();
    await expect(passButton).toHaveCount(
      current.view.unbeatenPlay === undefined ? 0 : 1,
    );
    await controls.getByRole("button", { name: "执行下一步" }).click();
    await expect(controls.getByRole("status")).toHaveText(
      "等待你操作，或本局已结束。",
    );
    expect((await room(page)).revision).toBe(current.revision);
    await controls.getByRole("button", { name: "继续自动操作" }).click();
    await expect(
      controls.getByRole("button", { name: "暂停自动操作" }),
    ).toBeEnabled();
    await page.waitForTimeout(1500);
    expect((await room(page)).revision).toBe(current.revision);
    await page
      .getByTestId("hand-card")
      .first()
      .click({ position: { x: 12, y: 32 } });
    await expect(playButton).toHaveCSS(
      "background-color",
      "rgb(116, 212, 165)",
    );
    await expect(clearButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    if (current.view.unbeatenPlay !== undefined) {
      await expect(passButton).toHaveCSS(
        "background-color",
        "rgb(240, 149, 149)",
      );
      await expect(passButton).toHaveCSS("font-weight", "800");
      await passButton.hover();
      await expect(passButton).toHaveCSS(
        "background-color",
        "rgb(240, 149, 149)",
      );
      await page.mouse.move(0, 0);
    }
    const actionBounds = await playButton.boundingBox();
    const cardBounds = await page
      .getByTestId("hand-card")
      .first()
      .boundingBox();
    const currentCountBounds = await ownCount.boundingBox();
    expect(currentCountBounds!.x).toBeLessThan(actionBounds!.x);
    expect(actionBounds!.y + actionBounds!.height).toBeLessThan(cardBounds!.y);
    await page.screenshot({
      path: test.info().outputPath("playground-desktop.png"),
      fullPage: true,
    });
    await clearButton.click();
    for (const width of [1920, 1024, 768, 320, 1920, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expectTableAlignment(page, 6);
      const initialPlayBounds = await playButton.boundingBox();
      const initialPassBounds =
        current.view.unbeatenPlay === undefined
          ? null
          : await passButton.boundingBox();
      for (const selected of [true, false]) {
        await page
          .getByTestId("hand-card")
          .first()
          .click({
            position: { x: 12, y: 32 },
          });
        const firstAction = await playButton.boundingBox();
        const lastAction = await (
          current.view.unbeatenPlay === undefined ? playButton : passButton
        ).boundingBox();
        const panel = await handPanel.boundingBox();
        expect(firstAction!.x).toBe(initialPlayBounds!.x);
        if (initialPassBounds !== null) {
          expect((await passButton.boundingBox())!.x).toBe(initialPassBounds.x);
        }
        await expect(clearButton).toHaveCount(selected ? 1 : 0);
        if (selected) {
          const clearBounds = await clearButton.boundingBox();
          expect(clearBounds!.x).toBeGreaterThan(
            lastAction!.x + lastAction!.width,
          );
          expect(clearBounds!.x + clearBounds!.width).toBeLessThanOrEqual(
            panel!.x + panel!.width,
          );
        }
        expect(
          Math.abs(
            (firstAction!.x + lastAction!.x + lastAction!.width) / 2 -
              (panel!.x + panel!.width / 2),
          ),
        ).toBeLessThan(2);
      }
      for (const group of await page
        .locator('[aria-label="你的手牌"] [data-rank]')
        .all()) {
        await expect
          .poll(async () => {
            const rows = await group.locator("button").evaluateAll((cards) =>
              cards.map((card) =>
                // Card hover/selection lifts do not change the layout row.
                Math.round(card.parentElement!.getBoundingClientRect().top),
              ),
            );
            return new Set(rows).size;
          })
          .toBe(1);
      }
      const hand = handPanel.getByRole("list", {
        name: "你的手牌",
        exact: true,
      });
      const rows = await hand
        .locator(":scope > li")
        .evaluateAll(
          (groups) =>
            new Set(groups.map((group) => group.getBoundingClientRect().top))
              .size,
        );
      const first = (await page
        .getByTestId("hand-card")
        .first()
        .boundingBox())!;
      const last = (await page.getByTestId("hand-card").last().boundingBox())!;
      if (width === 1920) expect(rows).toBe(1);
      else expect(rows).toBeGreaterThan(1);
      const panelBounds = (await handPanel.boundingBox())!;
      if (rows === 1) {
        expect(
          Math.abs(
            (first.x + last.x + last.width) / 2 -
              (panelBounds.x + panelBounds.width / 2),
          ),
        ).toBeLessThan(1);
      } else {
        const handBounds = (await hand.boundingBox())!;
        expect(first.x).toBe(handBounds.x);
        expect(handBounds.width).toBeGreaterThan(panelBounds.width - 32);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page
      .getByTestId("hand-card")
      .first()
      .click({ position: { x: 12, y: 32 } });
    await page.screenshot({
      path: test.info().outputPath("playground-mobile.png"),
      fullPage: true,
    });
  } finally {
    await playground.close();
  }
});

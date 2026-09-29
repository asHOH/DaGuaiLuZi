import { expect, test, type Page } from "@playwright/test";
import { decodeCardInstance } from "@dglz/game-rules";
import { RoomResponseEnvelopeSchema } from "@dglz/protocol";
import { openPlayground } from "../dev/playground";
import { protocolHeaders } from "./support";

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
    const pausedRevision = current.revision;
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
          .click();
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
    await controls.getByRole("button", { name: "执行下一步" }).click();
    await expect(controls.getByRole("status")).toHaveText("已执行一步。");
    await expect
      .poll(async () => (await room(page)).revision)
      .toBeGreaterThan(current.revision);
    expect((await room(page)).view.hand).toEqual(current.view.hand);

    await page.reload();
    await expect(
      controls.getByRole("button", { name: "继续自动操作" }),
    ).toBeEnabled();
    await expect(page.getByTestId("hand-card")).toHaveCount(
      current.view.hand.length,
    );
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
    expect(current.view.handSizes).toEqual([27, 27, 27, 27, 27, 27]);

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
    await page.screenshot({
      path: test.info().outputPath("playground-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("playground-mobile.png"),
      fullPage: true,
    });
  } finally {
    await playground.close();
  }
});

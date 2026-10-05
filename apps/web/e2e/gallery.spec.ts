import { expect, test } from "@playwright/test";
import { openGallery } from "../dev/gallery-launcher";

test("固定牌面验证回合内外的三种选牌颜色", async ({ browser }) => {
  const gallery = await openGallery(browser);
  const page = gallery.page;
  try {
    const controls = page.getByRole("complementary", { name: "预览控制" });
    const preview = page.frameLocator('iframe[title="界面预览"]');
    await controls
      .getByRole("combobox", { name: "页面", exact: true })
      .selectOption("table");
    await controls
      .getByRole("combobox", { name: "人数", exact: true })
      .selectOption("4");
    for (const state of ["respond", "waiting"]) {
      await controls
        .getByRole("combobox", { name: "场景", exact: true })
        .selectOption(state);
      await expect(
        preview.locator(`[data-preview="table/${state}/4"]`),
      ).toBeVisible();
      await expect(
        preview.getByTestId("played-hand").locator('[data-card="9S#1"]'),
      ).toBeVisible();
      await expect(
        preview.getByRole("button", { name: "出牌", exact: true }),
      ).toHaveCount(state === "respond" ? 1 : 0);
      // Against the fixed single 9: Ace wins, 3 loses, and four cards are illegal.
      for (const [codes, color] of [
        [["AS#1"], "rgb(223, 243, 255)"],
        [["3D#1"], "rgb(255, 234, 219)"],
        [["AS#1", "KH#1", "3D#1", "4S#1"], "rgb(255, 246, 205)"],
      ] as const) {
        const cards = codes.map((code) =>
          preview.locator(`[data-testid="hand-card"][data-card="${code}"]`),
        );
        for (const card of cards) await card.press("Space");
        for (const card of cards) {
          await expect(card).toHaveAttribute("aria-pressed", "true");
          await expect(card.locator(":scope > span")).toHaveCSS(
            "background-color",
            color,
          );
        }
        await preview.getByRole("button", { name: "清空选择" }).click();
        for (const card of cards) {
          await expect(card).toHaveAttribute("aria-pressed", "false");
          await expect(card.locator(":scope > span")).toHaveCSS(
            "background-color",
            "rgb(255, 254, 251)",
          );
        }
      }
    }
  } finally {
    await gallery.close();
  }
});

test("预览库可切换场景、调整视口、重置并打开真实试玩", async ({ browser }) => {
  test.setTimeout(120_000);
  const gallery = await openGallery(browser);
  const page = gallery.page;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    const controls = page.getByRole("complementary", { name: "预览控制" });
    const preview = page.frameLocator('iframe[title="界面预览"]');
    async function scenario(screen: string, state: string, players = "4") {
      await controls
        .getByRole("combobox", { name: "页面", exact: true })
        .selectOption(screen);
      await controls
        .getByRole("combobox", { name: "人数", exact: true })
        .selectOption(players);
      await controls
        .getByRole("combobox", { name: "场景", exact: true })
        .selectOption(state);
      await expect(
        preview.locator(`[data-preview="${screen}/${state}/${players}"]`),
      ).toBeVisible();
    }
    await expect(
      controls.getByRole("combobox", { name: "页面", exact: true }),
    ).toHaveValue("history");
    await expect(preview.getByTestId("history-hand")).toHaveCount(1);
    await preview
      .getByTestId("history-hand")
      .getByRole("button", { name: "查看回放" })
      .click();
    await expect(preview.getByTestId("replay-card")).toHaveCount(27);
    await preview
      .getByRole("button", { name: "查看结算", exact: true })
      .click();
    await expect(
      preview.getByRole("button", { name: "下一步", exact: true }),
    ).toBeDisabled();
    await controls.getByRole("button", { name: "重置场景" }).click();
    await expect(preview.getByTestId("replay-card")).toHaveCount(0);
    for (const state of ["empty", "loading", "error"]) {
      await scenario("history", state);
      await expect(
        preview.getByText(
          state === "empty"
            ? "还没有完成的牌局。"
            : state === "loading"
              ? "正在加载历史…"
              : "牌局历史暂时无法加载，请重试。",
        ),
      ).toBeVisible();
    }
    await page.screenshot({
      path: test.info().outputPath("gallery-history-error.png"),
      fullPage: true,
    });
    await scenario("account", "register");
    await expect(preview.getByLabel("确认密码", { exact: true })).toBeVisible();
    await scenario("account", "password-error");
    await expect(preview.getByRole("alert")).toHaveText("当前密码不正确。");
    await scenario("home", "default");
    await expect(
      preview.getByRole("heading", { name: "开一桌" }),
    ).toBeVisible();
    await scenario("lobby", "interrupted");
    await expect(preview.getByTestId("room-lifecycle")).toHaveText(
      "房间已中断",
    );
    await scenario("lobby", "ready", "6");
    await expect(
      preview.getByRole("button", { name: "准备就绪", exact: true }),
    ).toBeVisible();
    await scenario("table", "lead", "6");
    await expect(preview.getByTestId("hand-card")).toHaveCount(27);
    const firstCard = preview.getByTestId("hand-card").first();
    await firstCard.click({ position: { x: 12, y: 32 } });
    await expect(firstCard).toHaveAttribute("aria-pressed", "true");
    await controls
      .getByRole("combobox", { name: "视口", exact: true })
      .selectOption("phone");
    await expect(page.locator("iframe")).toHaveCSS("width", "390px");
    await expect
      .poll(() => preview.locator("html").evaluate(() => window.innerWidth))
      .toBe(390);
    await expect(firstCard).toHaveAttribute("aria-pressed", "true");
    await controls
      .getByRole("combobox", { name: "视口", exact: true })
      .selectOption("narrow");
    await expect
      .poll(() => preview.locator("html").evaluate(() => window.innerWidth))
      .toBe(320);
    await expect(firstCard).toHaveAttribute("aria-pressed", "true");
    await controls
      .getByRole("combobox", { name: "视口", exact: true })
      .selectOption("phone");
    await expect
      .poll(() => preview.locator("html").evaluate(() => window.innerWidth))
      .toBe(390);
    await expect(firstCard).toHaveAttribute("aria-pressed", "true");
    await preview.getByRole("button", { name: "出牌", exact: true }).click();
    await expect(controls.getByRole("status")).toContainText("操作已记录");
    await expect(preview.getByTestId("hand-card")).toHaveCount(27);
    await page.screenshot({
      path: test.info().outputPath("gallery-table-phone.png"),
      fullPage: true,
    });
    await controls.getByRole("button", { name: "重置场景" }).click();
    await expect(preview.getByTestId("hand-card").first()).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await controls
      .getByRole("combobox", { name: "连接状态", exact: true })
      .selectOption("offline");
    await expect(
      preview.getByRole("status", { name: "连接已断开，正在重连…" }),
    ).toBeVisible();
    await expect(preview.getByTestId("hand-card").first()).toBeEnabled();
    await expect(
      preview.getByRole("button", { name: "出牌", exact: true }),
    ).toBeDisabled();
    await controls
      .getByRole("combobox", { name: "连接状态", exact: true })
      .selectOption("ready");
    for (const [state, heading] of [
      ["tribute", "选择进贡牌"],
      ["return-offer", "提供还牌候选"],
      ["return-pick", "从候选中选择还牌"],
      ["pairing", "选择接贡方 · 第 1 轮"],
      ["settled", "本局结束"],
    ]) {
      await scenario("table", state!, "6");
      await expect(
        preview.getByRole("heading", { name: heading!, exact: true }),
      ).toBeVisible();
    }
    await scenario("replay", "loaded", "6");
    await expect(preview.getByTestId("replay-card")).toHaveCount(27);
    await preview
      .getByRole("combobox", { name: "查看座位", exact: true })
      .selectOption("2");
    await expect(preview.locator('[data-self="true"]')).toHaveAttribute(
      "data-seat",
      "2",
    );
    await scenario("challenge", "error");
    await expect(
      controls.getByText(
        "展开“用挑战码开局”，输入示例挑战码，再点击“查看牌局”以显示请求失败提示。",
      ),
    ).toBeVisible();
    await preview.getByText("用挑战码开局", { exact: true }).click();
    await preview
      .getByLabel("同牌挑战码", { exact: true })
      .fill("abcdef123456");
    await preview
      .getByRole("button", { name: "查看牌局", exact: true })
      .click();
    await expect(preview.getByRole("alert")).toHaveText(
      "连接暂时失败，请重试。",
    );
    await scenario("challenge", "copy-error");
    await expect(
      controls.getByText(
        "点击“复制同牌挑战码”或“复制回放链接”以显示复制失败提示。",
      ),
    ).toBeVisible();
    await preview
      .getByRole("button", { name: "复制回放链接", exact: true })
      .click();
    await expect(preview.getByRole("alert")).toContainText("未能自动复制");
    await page.reload();
    await expect(
      controls.getByRole("combobox", { name: "场景", exact: true }),
    ).toHaveValue("copy-error");
    await expect(
      preview.locator('[data-preview="challenge/copy-error/4"]'),
    ).toBeVisible();
    const retainedUrl = page.url();
    await page
      .getByRole("button", { name: "打开试玩牌桌", exact: true })
      .click();
    await expect(controls.getByRole("status")).toContainText("试玩牌桌已打开");
    const playable = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find(
        (candidate) =>
          candidate !== page && candidate.url().includes("/rooms/"),
      )!;
    await expect(playable.getByTestId("hand-card")).toHaveCount(27);
    await playable
      .getByRole("button", { name: "返回预览库", exact: true })
      .click();
    expect(page.url()).toBe(retainedUrl);
    await page
      .getByRole("button", { name: "打开试玩牌桌", exact: true })
      .click();
    await expect(controls.getByRole("status")).toContainText("试玩牌桌已打开");
    expect(
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .filter((candidate) => candidate.url().includes("/rooms/")),
    ).toHaveLength(1);
    const previousRoom = new URL(playable.url()).pathname;
    const previousContext = playable.context();
    await playable.close();
    expect(playable.isClosed()).toBe(true);
    await page
      .getByRole("button", { name: "打开试玩牌桌", exact: true })
      .click();
    await expect(controls.getByRole("status")).toContainText("试玩牌桌已打开");
    const reopenedTables = browser
      .contexts()
      .flatMap((context) => context.pages())
      .filter((candidate) => candidate.url().includes("/rooms/"));
    expect(reopenedTables).toHaveLength(1);
    const reopened = reopenedTables[0]!;
    expect(reopened).not.toBe(playable);
    expect(browser.contexts()).not.toContain(previousContext);
    expect(new URL(reopened.url()).pathname).not.toBe(previousRoom);
    await expect(reopened.getByTestId("hand-card")).toHaveCount(27);
    await reopened
      .getByRole("button", { name: "返回预览库", exact: true })
      .click();
    expect(page.url()).toBe(retainedUrl);
    expect(errors).toEqual([]);
    await gallery.close();
    expect(reopened.isClosed()).toBe(true);
  } finally {
    await gallery.close();
  }
});

test("手牌组合支持独立选牌、局部分组与解散及窄屏离线操作", async ({
  browser,
}) => {
  const gallery = await openGallery(browser);
  const page = gallery.page;
  try {
    const controls = page.getByRole("complementary", { name: "预览控制" });
    await controls
      .getByRole("combobox", { name: "页面", exact: true })
      .selectOption("table");
    await controls
      .getByRole("combobox", { name: "场景", exact: true })
      .selectOption("waiting");
    const preview = page.frameLocator('iframe[title="界面预览"]');
    const cards = preview.getByTestId("hand-card");
    const group = preview.getByRole("button", { name: "组合", exact: true });
    const dissolve = preview.getByRole("button", { name: "解散", exact: true });
    const selected = preview.locator(
      '[data-testid="hand-card"][aria-pressed="true"]',
    );
    const groups = preview.locator('[data-hand-group="true"]');
    const handPanel = preview.getByRole("region", {
      name: "你的手牌",
      exact: true,
    });
    const select = async (...codes: string[]) => {
      for (const code of codes)
        await preview
          .locator(`[data-testid="hand-card"][data-card="${code}"]`)
          .press("Space");
    };
    const contents = () =>
      groups.evaluateAll((elements) =>
        elements.map((element) =>
          [...element.querySelectorAll("[data-card]")].map((card) =>
            card.getAttribute("data-card"),
          ),
        ),
      );
    await expect(cards).toHaveCount(27);
    await expect(group).toHaveCount(0);
    await expect(
      preview.getByRole("button", { name: "出牌", exact: true }),
    ).toHaveCount(0);
    const codes = await cards.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-card")!),
    );
    await select(...codes);
    await expect(group).toBeDisabled();
    await preview.getByRole("button", { name: "清空选择" }).click();
    await select("3D#1", "AS#1");
    await group.click();
    expect(await contents()).toEqual([["AS#1", "3D#1"]]);
    await expect(selected).toHaveCount(0);
    await expect(group).toHaveCount(0);
    await select("KH#1", "2D#1");
    await group.click();
    expect(await contents()).toEqual([
      ["AS#1", "3D#1"],
      ["2D#1", "KH#1"],
    ]);
    await select("AS#1");
    await expect(selected).toHaveCount(1);
    await expect(dissolve).toBeEnabled();
    await select("KH#1", "9D#1");
    await group.click();
    expect(await contents()).toEqual([
      ["3D#1"],
      ["2D#1"],
      ["AS#1", "KH#1", "9D#1"],
    ]);
    await select("KH#1");
    await dissolve.click();
    expect(await contents()).toEqual([["3D#1"], ["2D#1"], ["AS#1", "9D#1"]]);
    await select("BIG#1");
    await group.click();
    await expect(groups).toHaveCount(4);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await controls
      .getByRole("combobox", { name: "视口", exact: true })
      .selectOption("fit");
    await expect
      .poll(() =>
        handPanel.evaluate((panel) => {
          const hand = panel.querySelector('ul[aria-label="你的手牌"]')!;
          const first = hand
            .querySelector("[data-card]")!
            .getBoundingClientRect();
          const last = hand.lastElementChild!.getBoundingClientRect();
          const bounds = panel.getBoundingClientRect();
          return Math.abs(
            (first.left + last.right) / 2 - (bounds.left + bounds.right) / 2,
          );
        }),
      )
      .toBeLessThan(2);
    expect(
      await cards.evaluateAll(
        (elements) =>
          Math.max(
            ...elements.map((card) => card.getBoundingClientRect().top),
          ) -
          Math.min(...elements.map((card) => card.getBoundingClientRect().top)),
      ),
    ).toBeLessThan(10);
    for (const viewport of ["desktop", "phone", "narrow"]) {
      await controls
        .getByRole("combobox", { name: "视口", exact: true })
        .selectOption(viewport);
      await handPanel.screenshot({
        path: test.info().outputPath(`hand-groups-${viewport}.png`),
      });
      expect(
        await preview
          .locator("html")
          .evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
      ).toBe(true);
    }
    await select(...codes);
    await group.click();
    await expect(groups).toHaveCount(0);
    // A large group wraps within a narrow hand without hiding its cards.
    await select(...codes.slice(1));
    await group.click();
    await expect(groups).toHaveCount(1);
    expect(
      await groups
        .locator("[data-card]")
        .evaluateAll(
          (elements) =>
            new Set(
              elements.map((element) => element.getBoundingClientRect().top),
            ).size,
        ),
    ).toBeGreaterThan(1);
    expect(
      await groups.evaluateAll((elements) =>
        elements.every((element) => {
          const bounds = element.getBoundingClientRect();
          return [...element.querySelectorAll("[data-card]")].every((card) => {
            const rect = card.getBoundingClientRect();
            return (
              rect.left >= bounds.left &&
              rect.right <= bounds.right &&
              rect.top >= bounds.top &&
              rect.bottom <= bounds.bottom
            );
          });
        }),
      ),
    ).toBe(true);
    await handPanel.screenshot({
      path: test.info().outputPath("hand-group-wrapped.png"),
    });
    await page.reload();
    await expect(groups).toHaveCount(0);
    await controls
      .getByRole("combobox", { name: "场景", exact: true })
      .selectOption("respond");
    await controls
      .getByRole("combobox", { name: "连接状态", exact: true })
      .selectOption("offline");
    await select("AS#1");
    await expect(
      preview.getByRole("button", { name: "出牌", exact: true }),
    ).toBeDisabled();
    await expect(
      preview.getByRole("button", { name: "不出", exact: true }),
    ).toBeDisabled();
    await group.click();
    await expect(groups).toHaveCount(1);
    await select("AS#1");
    await dissolve.click();
    await expect(groups).toHaveCount(0);
    await handPanel.screenshot({
      path: test.info().outputPath("hand-group-offline-actions.png"),
    });
    await controls
      .getByRole("combobox", { name: "页面", exact: true })
      .selectOption("replay");
    await expect(preview.getByTestId("replay-card")).toHaveCount(27);
    await expect(groups).toHaveCount(0);
    await expect(group).toHaveCount(0);
  } finally {
    await gallery.close();
  }
});

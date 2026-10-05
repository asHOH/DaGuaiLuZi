import { expect, test } from "@playwright/test";
import { openGallery } from "../dev/gallery-launcher";

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
    await expect(preview.getByTestId("hand-card").first()).toBeDisabled();
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

import { expect, test } from "@playwright/test";
import { startServer } from "./support";

for (const width of [390, 1280]) {
  test(`自主注册、空密码登录及改密（${width}）`, async ({ page }) => {
    const server = await startServer();
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(server.url);
      await page.getByRole("button", { name: "没有账号，去注册" }).click();
      await expect(
        page.getByText("密码可留空；留空后，知道用户名的人都能登录此账号。"),
      ).toBeVisible();
      await page.getByLabel("用户名").fill("alice");
      await page.getByLabel("密码", { exact: true }).fill("x");
      await page.getByRole("button", { name: "注册并入座" }).click();
      await expect(page.getByLabel("确认密码")).toHaveJSProperty(
        "validationMessage",
        "两次输入的密码不一致。",
      );
      // Editing the first password clears a stale confirmation error, including to empty.
      await page.getByLabel("密码", { exact: true }).fill("");
      await page.getByRole("button", { name: "注册并入座" }).click();
      await expect(page.getByRole("alert")).toContainText("用户名已被使用");
      await page.getByLabel("用户名").fill("新朋友");
      await page.screenshot({
        path: `output/playwright/registration-${width}.png`,
      });
      await page.getByRole("button", { name: "注册并入座" }).click();
      await expect(page.locator("header").first()).toContainText("新朋友");
      await expect(page.getByRole("heading", { name: "开一桌" })).toBeVisible();
      await page.reload();
      await expect(page.locator("header").first()).toContainText("新朋友");
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await page.getByLabel("用户名").fill("新朋友");
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await expect(page.locator("header").first()).toContainText("新朋友");
      await page.goto(`${server.url}/account`);
      await page.getByLabel("新密码", { exact: true }).fill("x");
      await page.getByLabel("确认新密码").fill("x");
      await page.getByRole("button", { name: "确认修改" }).click();
      await expect(page.getByRole("status")).toContainText("密码已修改");
      await page.getByLabel("用户名").fill("新朋友");
      await page.getByLabel("密码", { exact: true }).fill("x");
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await page.getByLabel("当前密码").fill("x");
      await page.getByRole("button", { name: "确认修改" }).click();
      await expect(page.getByRole("status")).toContainText("密码已修改");
      await page.getByLabel("用户名").fill("新朋友");
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await expect(page.getByRole("form", { name: "修改密码" })).toBeVisible();
    } finally {
      await server.close();
    }
  });
}

test("注册保留房间、回放及挑战链接", async ({ page }) => {
  const server = await startServer();
  try {
    const destinations = [
      "/rooms/11111111-1111-4111-8111-111111111111",
      "/history#replay=abcdef123456",
      "/#challenge=abcdef123456",
    ];
    for (const [index, destination] of destinations.entries()) {
      await page.goto(`${server.url}${destination}`);
      await page.getByRole("button", { name: "没有账号，去注册" }).click();
      await page.getByLabel("用户名").fill(`friend${index}`);
      await page.getByLabel("密码", { exact: true }).fill("x");
      await page.getByLabel("确认密码").fill("x");
      await page.getByRole("button", { name: "注册并入座" }).click();
      await expect(page.locator("header").first()).toContainText(
        `friend${index}`,
      );
      await expect(page).toHaveURL(`${server.url}${destination}`);
      await page.reload();
      await expect(page.locator("header").first()).toContainText(
        `friend${index}`,
      );
      await expect(page).toHaveURL(`${server.url}${destination}`);
      await page.goto(server.url);
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
    }
  } finally {
    await server.close();
  }
});

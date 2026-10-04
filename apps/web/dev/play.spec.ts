import { test } from "@playwright/test";
import { openGallery } from "./gallery-launcher";

test("本地界面预览与试玩", async ({ browser }) => {
  const playground = await openGallery(browser);
  console.log(
    "界面预览库已就绪，可从右上角打开试玩牌桌。关闭预览库窗口即可结束并清理临时数据。",
  );
  try {
    await playground.page.waitForEvent("close", { timeout: 0 });
  } finally {
    await playground.close();
  }
});

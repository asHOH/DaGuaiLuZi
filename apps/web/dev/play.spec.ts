import { test } from "@playwright/test";
import { openPlayground } from "./playground";

test("本地试玩", async ({ browser }) => {
  const playground = await openPlayground(browser);
  console.log(
    "试玩已就绪。你控制一号座位；关闭试玩窗口即可结束并清理临时数据。",
  );
  try {
    await playground.page.waitForEvent("close", { timeout: 0 });
  } finally {
    await playground.close();
  }
});

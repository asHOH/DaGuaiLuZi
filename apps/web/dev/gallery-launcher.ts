import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { type Browser } from "@playwright/test";
import { openPlayground } from "./playground";

export async function openGallery(browser: Browser) {
  // This entry is served only by the local launcher and is absent from production builds.
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../", import.meta.url)),
    server: { host: "127.0.0.1", port: 0 },
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  let closed = false;
  let closing: Promise<void> | undefined;
  let playable: Awaited<ReturnType<typeof openPlayground>> | undefined;
  let opening: Promise<void> | undefined;
  async function close() {
    if (closing !== undefined) return closing;
    closed = true;
    closing = (async () => {
      await opening?.catch(() => {});
      await playable?.close();
      await context.close();
      await server.close();
    })();
    return closing;
  }
  try {
    await server.listen();
    const url = server.resolvedUrls!.local[0]!;
    await page.exposeFunction("dglzOpenPlayable", async () => {
      if (closed) throw new Error("gallery-closed");
      if (opening !== undefined) return opening;
      opening = (async () => {
        if (playable === undefined || playable.page.isClosed()) {
          await playable?.close();
          const launched = await openPlayground(browser, () =>
            page.bringToFront(),
          );
          playable = launched;
          launched.page.once("close", () => {
            void launched
              .close()
              .catch((error: unknown) =>
                console.error("试玩清理失败：", error),
              );
          });
        }
        await playable.page.bringToFront();
      })();
      try {
        await opening;
      } finally {
        opening = undefined;
      }
    });
    await page.goto(`${url}dev/gallery.html`);
    await page.getByRole("heading", { name: "界面预览库" }).waitFor();
    return { page, close };
  } catch (error) {
    await close();
    throw error;
  }
}

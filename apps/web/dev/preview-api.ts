import { errorEnvelope, successEnvelope } from "@dglz/protocol";
import {
  PREVIEW_CODE,
  type PreviewSelection,
  type previewFixtures,
} from "./preview-scenarios";

/** Scoped to the disposable preview document; no app transport or server is modified. */
export function installPreviewApi(
  selection: PreviewSelection,
  fixtures: ReturnType<typeof previewFixtures>,
) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      location.href,
    );
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/"))
      return realFetch(input, init);
    const isHistory = url.pathname === "/api/history";
    const isReplay =
      url.pathname.endsWith("/replay") ||
      url.pathname === "/api/replays/lookup";
    const controlled =
      (isHistory && selection.screen === "history") ||
      (isReplay && selection.screen === "replay");
    // Loading is deliberately stable until the preview document is reset or replaced.
    if (controlled && selection.state === "loading")
      return new Promise<Response>(() => {});
    const failed =
      (controlled || selection.screen === "challenge") &&
      selection.state === "error";
    let value: unknown = errorEnvelope(failed ? "internal-error" : "not-found");
    let status = failed ? 500 : 404;
    if (!failed) {
      if (isHistory) {
        value = successEnvelope({
          hands:
            selection.screen === "history" && selection.state === "empty"
              ? []
              : [fixtures.summary],
        });
        status = 200;
      } else if (isReplay) {
        value = successEnvelope(fixtures.replay);
        status = 200;
      } else if (
        url.pathname === "/api/challenges/lookup" ||
        url.pathname.endsWith("/challenges")
      ) {
        value = successEnvelope({
          code: PREVIEW_CODE,
          rulesConfiguration: fixtures.summary.rulesConfiguration,
          teamLevels: fixtures.summary.teamLevels,
          trumpRank: fixtures.summary.trumpRank,
        });
        status = 200;
      }
    }
    return new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  if (selection.screen === "challenge" && selection.state === "copy-error") {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async () => {
        throw new Error("preview-clipboard-failure");
      },
    });
  }
}

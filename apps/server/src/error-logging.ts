import type { FastifyBaseLogger } from "fastify";

export type ErrorContext = Readonly<{
  operation: string;
  stage?: string;
  roomId?: string;
  accountId?: string | undefined;
  commandId?: string;
  commandType?: string;
  expectedRevision?: number;
  revision?: number;
  handStartSequence?: number | undefined;
  method?: string;
  route?: string | undefined;
  reason?: string | undefined;
}>;

function safeError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error };
  const code = "code" in error ? error.code : undefined;
  // Messages (including stack headers), SQL parameters, and arbitrary error
  // properties can contain credentials, Challenge Codes, or private game state.
  return {
    type: error.constructor.name,
    ...(typeof code === "string" && /^(SQLITE|ERR|FST_ERR)_[A-Z_]+$/.test(code)
      ? { code }
      : {}),
    stack: error.stack
      ?.split("\n")
      .filter((line) => /^\s+at .+:\d+:\d+\)?$/.test(line))
      .join("\n"),
    // ponytail: cap cause chains at four errors, including cycles; raise the cap
    // if deeper wrappers become necessary for diagnosis.
    ...(error.cause !== undefined && depth < 3
      ? { cause: safeError(error.cause, depth + 1) }
      : {}),
  };
}

export function logUnexpectedError(
  logger: Pick<FastifyBaseLogger, "error"> | undefined,
  error: unknown,
  context: ErrorContext,
): void {
  logger?.error({ ...context, err: safeError(error) }, "服务器操作失败");
}

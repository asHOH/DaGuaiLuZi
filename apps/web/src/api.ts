import {
  ErrorEnvelopeSchema,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
} from "@dglz/protocol";

export class ApiError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function incompatibleVersion(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "protocolVersion" in value &&
    typeof value.protocolVersion === "number" &&
    value.protocolVersion !== PROTOCOL_VERSION
  );
}

export const errorMessage = (code: string): string =>
  ({
    unauthorized: "登录已失效，请重新登录。",
    "invalid-credentials": "用户名或密码不正确。",
    "reload-required": "版本已更新，请刷新页面。",
    "room-not-found": "找不到这个房间，请检查房间码。",
    forbidden: "你尚未加入这个房间。",
    "malformed-input": "输入格式不正确，请检查后重试。",
    "rate-limited": "操作太频繁，请稍后再试。",
    "stale-revision": "牌局已更新，请查看最新状态后再操作。",
    "domain-rejected": "当前无法完成此操作，请检查座位和准备状态。",
    "unsupported-persisted-event": "此房间暂时无法恢复，请联系管理员。",
    "origin-forbidden": "连接地址不受支持，请从正确的网址进入。",
  })[code] ?? "连接暂时失败，请重试。";

export async function api<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const value: unknown = await response.json();
  if (incompatibleVersion(value)) throw new ApiError("reload-required");
  const error = ErrorEnvelopeSchema.safeParse(value);
  if (error.success) throw new ApiError(error.data.error.code);
  if (!response.ok) throw new ApiError("internal-error");
  return schema.parse(value);
}

import {
  ErrorEnvelopeSchema,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
} from "@dglz/protocol";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly reason?: string,
  ) {
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

const playErrors: Record<string, string> = {
  "not-current-player": "还没轮到你，请等待当前玩家行动。",
  "card-not-in-hand": "所选牌不在你的手牌中，请重新选择。",
  "invalid-card-instance-code": "牌面数据有误，请同步后重试。",
  "duplicate-card-instance": "同一张牌不能重复选择。",
  "card-not-in-ruleset": "这张牌不属于当前规则组。",
  "unsupported-card-count": "请选择 1、2、3 或 5 张牌。",
  "cards-do-not-form-legal-play": "所选牌不能组成合法牌型。",
  "response-card-count-mismatch": "跟牌张数必须与当前出牌相同。",
  "response-not-stronger": "所选牌必须大于当前出牌。",
  "pass-on-open-lead": "你是领牌玩家，必须出牌。",
  "hand-result-determined": "本局已结束。",
  "hand-setup-incomplete": "请先完成开局选牌。",
  "room-not-active": "当前没有正在进行的牌局。",
  "match-rules-configuration-locked": "比赛规则已锁定，无法修改。",
  "tribute-card-not-eligible": "请选择可进贡的最高牌。",
  "not-pending-setup-actor": "当前无需你选择，请等待其他玩家。",
  "return-candidates-invalid": "小王需提供两张、大王需提供三张不同点数的手牌。",
  "return-card-not-eligible": "请选择当前允许归还的牌。",
  "tie-choice-not-eligible": "请选择本轮允许的对象，或选择放弃。",
  "tie-choice-duplicate": "你已提交本轮选择，请等待其他玩家。",
  "tie-choice-stale": "选择轮次已更新，请查看本轮选项。",
  "challenge-ruleset-too-small": "房间人数超过此挑战所需人数，请另开一个房间。",
  "challenge-already-selected": "已选择这个同牌挑战，请入座并准备。",
  "owner-only": "只有房主可以选择或终止牌局。",
};

export const errorMessage = (code: string, reason?: string): string =>
  (code === "domain-rejected" && reason !== undefined
    ? playErrors[reason]
    : undefined) ??
  {
    unauthorized: "登录已失效，请重新登录。",
    "invalid-credentials": "用户名或密码不正确。",
    "reload-required": "版本已更新，请刷新页面。",
    "room-not-found": "找不到这个房间，请检查房间码。",
    "not-found": "找不到可用的同牌挑战，请检查挑战码或本局是否已完成。",
    forbidden: "你尚未加入这个房间。",
    "malformed-input": "输入格式不正确，请检查后重试。",
    "rate-limited": "操作太频繁，请稍后再试。",
    "stale-revision": "牌局已更新，请查看最新状态后再操作。",
    "domain-rejected": "当前无法完成此操作，请查看最新牌局状态。",
    "unsupported-persisted-event": "此房间暂时无法恢复，请联系管理员。",
    "origin-forbidden": "连接地址不受支持，请从正确的网址进入。",
  }[code] ??
  "连接暂时失败，请重试。";

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

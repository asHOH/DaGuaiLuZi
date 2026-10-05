import type { CompletedHandSummary } from "@dglz/protocol";
import type {
  RULE_VARIANT_VALUES,
  RulesetId,
  RuleVariantName,
} from "@dglz/game-rules";

type RuleValue = (typeof RULE_VARIANT_VALUES)[RuleVariantName][number];

// Check completeness while allowing string-key lookups from Object.entries.
export const RULE_LABELS: Record<string, string> = {
  rulesetId: "规则组",
  jokerPairComparison: "王牌对子比较",
  wildcardRank: "万能牌取值",
  finishingWildcardInterpretation: "出完手牌时的万能牌",
  flushTieBreaking: "同花比较",
  nextHandLeader: "下局领牌",
  tributeCardSelection: "进贡选牌",
  returnCardSelection: "还牌选牌",
  tributeRecipientPairing: "进贡配对",
  matchEnding: "比赛结束",
} satisfies Record<"rulesetId" | RuleVariantName, string>;

export const RULE_VALUES: Record<string, string> = {
  "dglz-6p-3d-v1": "六人三副牌",
  "dglz-4p-2d-v1": "四人两副牌",
  "two-small-and-mixed-are-equal": "两张小王与混合王同级",
  "two-small-jokers-win": "两张小王胜出",
  "weakest-rank": "最弱点数",
  "strongest-rank": "最强点数",
  normal: "正常解释",
  "weakest-form-and-rank": "按最小牌型与牌点",
  "highest-card-only": "只比最大牌",
  "descending-ranks": "逐张比较",
  "first-finisher": "头游",
  "highest-tribute": "进贡最大者",
  "fair-random": "公平随机",
  "giver-choice": "进贡方选择",
  "recipient-choice": "收贡方选择",
  "giver-choice-from-candidates": "进贡方从候选中选择",
  "finish-position-by-tribute-rank": "按进贡牌点对应名次",
  "adjacent-first-automatic": "相邻优先自动配对",
  "no-failure-limit-at-5": "到 5 级不设失败上限",
  "three-failure-limit-at-5": "到 5 级三次失败结束",
} satisfies Record<RulesetId | RuleValue, string>;

export const ACTIVITY_LABELS = {
  match: "比赛",
  challenge: "同牌挑战",
} as const;

export function completionLabel(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function resultLabel(result: CompletedHandSummary["result"]): string {
  return result.outcome === "draw"
    ? "平局"
    : `${result.winningTeam === 0 ? "一队" : "二队"}获胜`;
}

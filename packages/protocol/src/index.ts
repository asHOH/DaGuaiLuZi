import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const PROTOCOL_VERSION_HEADER = "x-dglz-protocol-version" as const;

const identifier = z.string().trim().min(1).max(128);
export const UsernameSchema = z.string().trim().min(1).max(64);
export const PasswordSchema = z.string().min(1).max(1024);

export const RulesetIdSchema = z.enum(["dglz-6p-3d-v1", "dglz-4p-2d-v1"]);
export const SeatingPolicySchema = z.enum(["fixed", "randomized"]);
export const RoomIdSchema = z.string().uuid();

const sharedRulesConfiguration = {
  wildcardRank: z.enum(["weakest-rank", "strongest-rank"]),
  finishingWildcardInterpretation: z.enum(["normal", "weakest-form-and-rank"]),
  flushTieBreaking: z.enum(["highest-card-only", "descending-ranks"]),
  nextHandLeader: z.enum(["first-finisher", "highest-tribute"]),
  tributeCardSelection: z.enum(["fair-random", "giver-choice"]),
  tributeRecipientPairing: z.enum([
    "finish-position-by-tribute-rank",
    "adjacent-first-automatic",
  ]),
  matchEnding: z.enum(["no-failure-limit-at-5", "three-failure-limit-at-5"]),
} as const;

export const SixPlayerRulesConfigurationSchema = z
  .object({
    rulesetId: z.literal("dglz-6p-3d-v1"),
    ...sharedRulesConfiguration,
    jokerPairComparison: z.enum([
      "two-small-and-mixed-are-equal",
      "two-small-jokers-win",
    ]),
    returnCardSelection: z.enum([
      "recipient-choice",
      "giver-choice-from-candidates",
    ]),
  })
  .strict();

export const FourPlayerRulesConfigurationSchema = z
  .object({
    rulesetId: z.literal("dglz-4p-2d-v1"),
    ...sharedRulesConfiguration,
  })
  .strict();

export const RulesConfigurationSchema = z.discriminatedUnion("rulesetId", [
  SixPlayerRulesConfigurationSchema,
  FourPlayerRulesConfigurationSchema,
]);

export type RulesConfiguration = z.infer<typeof RulesConfigurationSchema>;
export type RulesetId = z.infer<typeof RulesetIdSchema>;
export type SeatingPolicy = z.infer<typeof SeatingPolicySchema>;

export const LoginCommandSchema = z
  .object({ username: UsernameSchema, password: PasswordSchema })
  .strict();
export type LoginCommand = z.infer<typeof LoginCommandSchema>;

export const CreateRoomCommandSchema = z
  .object({
    rulesetId: RulesetIdSchema,
    seatingPolicy: SeatingPolicySchema,
  })
  .strict();
export type CreateRoomCommand = z.infer<typeof CreateRoomCommandSchema>;

export const ProtocolErrorCodeSchema = z.enum([
  "reload-required",
  "malformed-input",
  "invalid-credentials",
  "unauthorized",
  "forbidden",
  "origin-forbidden",
  "not-found",
  "room-not-found",
  "rate-limited",
  "unsupported-persisted-event",
  "internal-error",
]);

export type ProtocolErrorCode = z.infer<typeof ProtocolErrorCodeSchema>;

export const ErrorEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    ok: z.literal(false),
    error: z.object({ code: ProtocolErrorCodeSchema }).strict(),
  })
  .strict();

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export type SuccessEnvelope<T> = Readonly<{
  protocolVersion: typeof PROTOCOL_VERSION;
  ok: true;
  data: T;
}>;

export function successEnvelope<T>(data: T): SuccessEnvelope<T> {
  return { protocolVersion: PROTOCOL_VERSION, ok: true, data };
}

export function errorEnvelope(code: ProtocolErrorCode): ErrorEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    error: { code },
  };
}

export function parseProtocolVersion(
  value: string | readonly string[] | undefined,
): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export const LoginResponseDataSchema = z
  .object({
    accountId: identifier,
    username: UsernameSchema,
  })
  .strict();

export const LogoutResponseDataSchema = z.object({}).strict();

export const PlayerViewMemberSchema = z
  .object({
    playerId: identifier,
    joinOrder: z.number().int().nonnegative(),
    ready: z.boolean(),
  })
  .strict();

export const PlayerViewSeatSchema = z
  .object({
    seatIndex: z.number().int().nonnegative(),
    playerId: identifier.optional(),
  })
  .strict();

export const PlayerViewSchema = z
  .object({
    roomId: RoomIdSchema,
    lifecycle: z.literal("LOBBY"),
    ownerId: identifier,
    members: z.array(PlayerViewMemberSchema),
    seats: z.array(PlayerViewSeatSchema),
    rulesConfiguration: RulesConfigurationSchema,
    seatingPolicy: SeatingPolicySchema,
    matchRulesConfigurationLocked: z.boolean(),
    seatingPolicyLocked: z.boolean(),
  })
  .strict();

export type PlayerView = z.infer<typeof PlayerViewSchema>;

export const RoomViewDataSchema = z
  .object({
    revision: z.number().int().positive(),
    view: PlayerViewSchema,
  })
  .strict();

export type RoomViewData = z.infer<typeof RoomViewDataSchema>;

export const LoginResponseEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    ok: z.literal(true),
    data: LoginResponseDataSchema,
  })
  .strict();

export const RoomResponseEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    ok: z.literal(true),
    data: RoomViewDataSchema,
  })
  .strict();

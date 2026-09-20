import {
  ChallengeCodeSchema,
  CompletedHandReferenceSchema,
} from "@dglz/protocol";

export type ReplaySource =
  { code: string } | { roomId: string; handStartSequence: number };

export function replayHash(source: ReplaySource): string {
  return "code" in source
    ? `#replay=${source.code}`
    : `#hand=${source.roomId}/${source.handStartSequence}`;
}

export function replayLink(code: string): string {
  return `/history${replayHash({ code })}`;
}

export function replaySource(hash: string): ReplaySource | undefined {
  const params = new URLSearchParams(hash.slice(1));
  if (params.has("replay")) {
    const code = ChallengeCodeSchema.safeParse(params.get("replay"));
    return code.success ? { code: code.data } : undefined;
  }
  const parts = params.get("hand")?.split("/");
  if (parts?.length !== 2) return undefined;
  const reference = CompletedHandReferenceSchema.safeParse({
    roomId: parts[0],
    handStartSequence: Number(parts[1]),
  });
  return reference.success ? reference.data : undefined;
}

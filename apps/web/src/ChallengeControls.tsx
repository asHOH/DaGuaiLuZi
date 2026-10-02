import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ChallengeCodeSchema,
  ChallengeResponseEnvelopeSchema,
  type ChallengePreview,
  type RoomCommandPayload,
} from "@dglz/protocol";
import { api, ApiError, errorMessage } from "./api";
import { replayLink } from "./replay-links";
import controls from "./controls.module.css";
import styles from "./ChallengeControls.module.css";

type ControlsProps = {
  disabled: boolean;
  onFailure?: ((reason: unknown) => void) | undefined;
};

function reportFailure(reason: unknown, onFailure: ControlsProps["onFailure"]) {
  if (
    reason instanceof ApiError &&
    (reason.code === "unauthorized" || reason.code === "reload-required")
  )
    onFailure?.(reason);
  return errorMessage(
    reason instanceof ApiError ? reason.code : "internal-error",
  );
}

export function ChallengeEntry({
  disabled,
  onFailure,
  onCommand,
}: ControlsProps & {
  onCommand: (payload: RoomCommandPayload) => void;
}) {
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<ChallengePreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(() => {
    const parsed = ChallengeCodeSchema.safeParse(
      new URLSearchParams(location.hash.slice(1)).get("challenge"),
    );
    if (parsed.success) setCode(parsed.data);
    return () => {
      request.current++;
    };
  }, []);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = ChallengeCodeSchema.safeParse(code.trim().toLowerCase());
    if (!parsed.success) {
      setError("请输入完整的 12 位同牌挑战码。");
      return;
    }
    const generation = ++request.current;
    setBusy(true);
    setError("");
    setPreview(undefined);
    try {
      const response = await api(
        "/challenges/lookup",
        ChallengeResponseEnvelopeSchema,
        { code: parsed.data },
      );
      if (generation === request.current) setPreview(response.data);
    } catch (reason) {
      if (generation === request.current)
        setError(reportFailure(reason, onFailure));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  }

  return (
    <section className={styles.challengePanel} aria-label="选择同牌挑战">
      <h3>同一手牌，换你来打</h3>
      <p>使用好友分享的挑战码，重现相同的开局。每次挑战只打一局。</p>
      <form
        onSubmit={(event) => {
          void lookup(event);
        }}
      >
        <label>
          同牌挑战码
          <input
            value={code}
            autoComplete="off"
            spellCheck={false}
            maxLength={128}
            disabled={disabled}
            onChange={(event) => {
              request.current++;
              setCode(event.target.value);
              setPreview(undefined);
              setError("");
              setBusy(false);
            }}
          />
        </label>
        <button
          type="submit"
          className={controls.secondaryButton}
          disabled={disabled || busy || code.trim() === ""}
        >
          {busy ? "正在查找…" : "查看牌局"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <div className={styles.challengePreview} aria-label="同牌挑战预览">
          <p>
            {preview.rulesConfiguration.rulesetId === "dglz-4p-2d-v1"
              ? "四人 · 两副牌"
              : "六人 · 三副牌"}
            {" · "}一队等级 {preview.teamLevels[0]} · 二队等级{" "}
            {preview.teamLevels[1]} · 当前级牌 {preview.trumpRank}
          </p>
          <button
            type="button"
            className={controls.primaryButton}
            disabled={disabled || busy}
            onClick={() =>
              onCommand({ type: "SelectChallengeHand", code: preview.code })
            }
          >
            使用此牌局
          </button>
        </div>
      )}
    </section>
  );
}

export function ChallengeShare({
  roomId,
  handStartSequence,
  disabled,
  onFailure,
  initialCode,
  onChallenge,
}: ControlsProps & {
  roomId: string;
  handStartSequence: number;
  initialCode?: string | undefined;
  onChallenge?: ((code: string) => Promise<void>) | undefined;
}) {
  const [code, setCode] = useState(initialCode ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function generate() {
    const generation = ++request.current;
    setBusy(true);
    setError("");
    try {
      const response = await api(
        `/rooms/${roomId}/challenges`,
        ChallengeResponseEnvelopeSchema,
        { handStartSequence },
      );
      if (generation === request.current) setCode(response.data.code);
    } catch (reason) {
      if (generation === request.current)
        setError(reportFailure(reason, onFailure));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  }
  async function copy(link = false) {
    const generation = request.current;
    try {
      await navigator.clipboard.writeText(
        link ? `${location.origin}${replayLink(code)}` : code,
      );
      if (generation === request.current) setMessage("已复制，可分享给好友。");
    } catch {
      if (generation === request.current)
        setMessage("未能自动复制，请选中挑战码或回放链接后手动复制。");
    }
  }
  return (
    <div className={styles.challengeShare}>
      {code ? (
        <>
          <label>
            本局同牌挑战码
            <input
              readOnly
              value={code}
              spellCheck={false}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <label>
            回放分享链接
            <input
              readOnly
              value={`${location.origin}${replayLink(code)}`}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <button
            type="button"
            className={controls.secondaryButton}
            disabled={disabled}
            onClick={() => {
              void copy();
            }}
          >
            复制同牌挑战码
          </button>
          <button
            type="button"
            className={controls.secondaryButton}
            disabled={disabled}
            onClick={() => void copy(true)}
          >
            复制回放链接
          </button>
          {onChallenge ? (
            <button
              type="button"
              className={controls.primaryButton}
              disabled={disabled}
              onClick={() => void onChallenge(code)}
            >
              用此牌局开一桌
            </button>
          ) : (
            <a href={replayLink(code)}>查看本局回放</a>
          )}
          {message && <p role="status">{message}</p>}
        </>
      ) : (
        <button
          type="button"
          className={controls.secondaryButton}
          disabled={disabled || busy}
          onClick={() => {
            void generate();
          }}
        >
          {busy ? "正在生成…" : "生成同牌挑战码"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

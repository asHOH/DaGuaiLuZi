import type { FormEvent } from "react";
import { SuitIcon } from "./SuitIcon";
import controls from "./controls.module.css";
import styles from "./shell.module.css";

export function LoginPage({
  busy,
  canRetry,
  onSubmit,
  onRestore,
}: {
  busy: boolean;
  canRetry: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRestore: () => Promise<void>;
}) {
  return (
    <section className={styles.welcome}>
      <div className={styles.intro}>
        <h1>
          坐下来，
          <br />
          打几手。
        </h1>
        <p>
          四人或六人，邀好友入座。
          <br />
          熟悉的大怪路子，现在随时开桌。
        </p>
        <div className={styles.motif} aria-hidden="true">
          <span>
            <SuitIcon suit="S" />
          </span>
          <span>
            <SuitIcon suit="H" />
          </span>
          <span>
            <SuitIcon suit="C" />
          </span>
        </div>
      </div>
      <form
        className={styles.panel}
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <h2>登录入座</h2>
        <p>使用管理员为你开通的账号。</p>
        <label>
          用户名
          <input
            name="username"
            autoComplete="username"
            required
            maxLength={64}
          />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
          />
        </label>
        <button className={controls.primary} disabled={busy}>
          登录
        </button>
        {canRetry && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void onRestore();
            }}
          >
            重试恢复登录
          </button>
        )}
      </form>
    </section>
  );
}

export function PasswordPage({
  username,
  busy,
  onSubmit,
  onBack,
}: {
  username: string;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onBack: () => void;
}) {
  return (
    <section className={styles.passwordPage}>
      <h1>修改密码</h1>
      <form
        className={styles.panel}
        aria-label="修改密码"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <p>修改后，所有设备都需要重新登录。</p>
        <input
          type="hidden"
          name="username"
          autoComplete="username"
          value={username}
        />
        <label>
          当前密码
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
            disabled={busy}
            autoFocus
          />
        </label>
        <label>
          新密码
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            maxLength={1024}
            disabled={busy}
            onInput={(event) => {
              const confirmation = event.currentTarget.form?.elements.namedItem(
                "confirmPassword",
              ) as HTMLInputElement | null;
              confirmation?.setCustomValidity("");
            }}
          />
        </label>
        <label>
          确认新密码
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            maxLength={1024}
            disabled={busy}
            onInput={(event) => event.currentTarget.setCustomValidity("")}
          />
        </label>
        <button className={controls.primary} disabled={busy}>
          {busy ? "正在修改…" : "确认修改"}
        </button>
        <button type="button" disabled={busy} onClick={onBack}>
          返回开桌
        </button>
      </form>
    </section>
  );
}

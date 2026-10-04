import { useState, type FormEvent } from "react";
import controls from "./controls.module.css";
import styles from "./shell.module.css";

export function LoginPage({
  busy,
  canRetry,
  onSubmit,
  onRestore,
  onModeChange,
  initialMode = "login",
}: {
  busy: boolean;
  canRetry: boolean;
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    registering: boolean,
  ) => Promise<void>;
  onRestore: () => Promise<void>;
  onModeChange: () => void;
  initialMode?: "login" | "register";
}) {
  const [registering, setRegistering] = useState(initialMode === "register");
  return (
    <section className={styles.welcome}>
      <form
        key={String(registering)}
        className={styles.panel}
        onSubmit={(event) => {
          event.preventDefault();
          if (registering) {
            const data = new FormData(event.currentTarget);
            if (data.get("password") !== data.get("confirmPassword")) {
              const confirmation = event.currentTarget.elements.namedItem(
                "confirmPassword",
              ) as HTMLInputElement;
              confirmation.setCustomValidity("两次输入的密码不一致。");
              confirmation.reportValidity();
              return;
            }
          }
          void onSubmit(event, registering);
        }}
      >
        <h2>{registering ? "注册账号" : "登录入座"}</h2>
        {registering && (
          <p>密码可留空；留空后，知道用户名的人都能登录此账号。</p>
        )}
        <label>
          用户名
          <input
            name="username"
            autoComplete="username"
            required
            maxLength={64}
            disabled={busy}
          />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            autoComplete={registering ? "new-password" : "current-password"}
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
        {registering && (
          <label>
            确认密码
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              maxLength={1024}
              disabled={busy}
              onInput={(event) => event.currentTarget.setCustomValidity("")}
            />
          </label>
        )}
        <button className={controls.primary} disabled={busy}>
          {busy
            ? registering
              ? "正在注册…"
              : "正在登录…"
            : registering
              ? "注册并入座"
              : "登录"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRegistering(!registering);
            onModeChange();
          }}
        >
          {registering ? "已有账号，去登录" : "没有账号，去注册"}
        </button>
        <p>忘记密码请联系管理员。</p>
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
        <p>密码可留空；留空后，知道用户名的人都能登录此账号。</p>
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

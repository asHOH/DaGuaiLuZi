import { type ReactNode } from "react";
import styles from "./shell.module.css";

export function AppHeader({
  username,
  showNavigation,
  path,
  busy,
  connectionStatus,
  onNavigate,
  onLogout,
}: {
  username: string | undefined;
  showNavigation: boolean;
  path: string;
  busy: boolean;
  connectionStatus: ReactNode;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}) {
  return (
    <header className={styles.header}>
      {!showNavigation ? (
        <span className={styles.brand}>大怪路子</span>
      ) : (
        <a
          className={styles.brand}
          href="/"
          onClick={(event) => {
            event.preventDefault();
            onNavigate("/");
          }}
        >
          大怪路子
        </a>
      )}
      {username !== undefined && (
        <div className={styles.account}>
          <span>{username}</span>
          {!showNavigation ? (
            connectionStatus
          ) : (
            <>
              {path !== "/account" && (
                <a
                  href="/account"
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate("/account");
                  }}
                >
                  修改密码
                </a>
              )}
              {path !== "/history" && (
                <a
                  href="/history"
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate("/history");
                  }}
                >
                  牌局记录
                </a>
              )}
              <button disabled={busy} onClick={onLogout}>
                退出登录
              </button>
            </>
          )}
        </div>
      )}
    </header>
  );
}

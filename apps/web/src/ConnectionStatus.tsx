import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { WifiHighIcon } from "@phosphor-icons/react/dist/csr/WifiHigh";
import { WifiSlashIcon } from "@phosphor-icons/react/dist/csr/WifiSlash";
import { type RoomState } from "./room-connection";
import styles from "./shell.module.css";

const STATUS = {
  offline: { Icon: WifiSlashIcon, label: "连接已断开，正在重连…" },
  uncertain: { Icon: WarningCircleIcon, label: "等待确认操作结果" },
  pending: { Icon: PaperPlaneTiltIcon, label: "正在提交…" },
  syncing: { Icon: ArrowsClockwiseIcon, label: "正在同步牌局…" },
  error: { Icon: WarningCircleIcon, label: "操作失败，请查看提示" },
  ready: { Icon: WifiHighIcon, label: "已连接 · 牌局已同步" },
};

export function ConnectionStatus({ state }: { state: RoomState }) {
  const status = !state.connected
    ? "offline"
    : state.uncertain
      ? "uncertain"
      : state.pending
        ? "pending"
        : !state.synced
          ? "syncing"
          : state.error
            ? "error"
            : "ready";
  const { Icon, label } = STATUS[status];
  return (
    <span
      className={styles.connectionIndicator}
      role="status"
      title={label}
      data-state={status}
    >
      <Icon size={22} aria-hidden="true" focusable="false" />
      <span className={styles.visuallyHidden}>{label}</span>
    </span>
  );
}

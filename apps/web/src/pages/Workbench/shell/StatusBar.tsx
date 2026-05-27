import { Icon } from "@/components/ui/Icon";
import type { ReconnectState } from "@/hooks/useReconnectingWebSocket";
import type { TaskLockConflictDetail } from "@/types";
import { formatDuration } from "../state/useSessionStats";
import styles from "./StatusBar.module.css";

interface PreannotationProgress {
  current: number;
  total: number;
  status: string;
}

type DiffMode = "final" | "raw" | "diff";

interface StatusBarProps {
  userBoxesCount: number;
  aiBoxesCount: number;
  activeClass: string;
  imageWidth: number | null;
  imageHeight: number | null;
  cursor: { x: number; y: number } | null;
  preannotationProgress: PreannotationProgress | null;
  preannotationConn: ReconnectState;
  preannotationRetries: number;
  /** 本会话每题平均耗时（毫秒）。null = 样本 < 10。 */
  avgLeadMs?: number | null;
  /** 剩余题数（用于 ETA 计算）。 */
  remainingTaskCount?: number;
  /** 离线队列：> 0 时右侧显示"离线 · N 操作待同步"徽章。 */
  offlineQueueCount?: number;
  online?: boolean;
  onShowQueueDrawer?: () => void;
  /** 锁剩余时间（毫秒）。0 = 未持有锁。 */
  lockRemainingMs?: number;
  /** 锁错误消息。非空时优先展示错误。 */
  lockError?: string | null;
  lockConflict?: TaskLockConflictDetail | null;
  /** M2 · review 模式下的 diff 控制（final/raw/diff）。有值时渲染 segmented control。 */
  diffMode?: DiffMode;
  onSetDiffMode?: (m: DiffMode) => void;
}

function formatLockTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function lockStatusText(lockError: string, lockConflict?: TaskLockConflictDetail | null): string {
  if (lockError === "Lock expired") return "锁已过期";
  const name = lockConflict?.locked_by?.name?.trim();
  return name ? `${name} 正在编辑` : "他人正在编辑";
}

export function StatusBar({
  userBoxesCount, aiBoxesCount, activeClass,
  imageWidth, imageHeight, cursor,
  preannotationProgress, preannotationConn, preannotationRetries,
  avgLeadMs, remainingTaskCount,
  offlineQueueCount, online, onShowQueueDrawer,
  lockRemainingMs, lockError, lockConflict,
  diffMode, onSetDiffMode,
}: StatusBarProps) {
  const dimText = imageWidth && imageHeight ? `${imageWidth}×${imageHeight}` : "—";
  const cursorText = cursor && imageWidth && imageHeight
    ? `(${Math.round(cursor.x * imageWidth)}, ${Math.round(cursor.y * imageHeight)})`
    : null;
  const etaText = avgLeadMs && remainingTaskCount && remainingTaskCount > 0
    ? `${formatDuration(avgLeadMs)}/题 · 剩 ${remainingTaskCount} · 约 ${formatDuration(avgLeadMs * remainingTaskCount)}`
    : avgLeadMs ? `${formatDuration(avgLeadMs)}/题` : "—";

  const Sep = () => <span aria-hidden className={styles.separator} />;
  return (
    <div className={styles.root}>
      <div className={styles.group}>
        {lockRemainingMs !== undefined && lockRemainingMs > 0 && !lockError && (
          <>
            <span className={cn(styles.inlineItem, lockRemainingMs < 60_000 && styles.lockWarning)}>
              <Icon name="lock" size={11} /> 锁剩余 <span className={cn("mono", styles.monoMedium)}>{formatLockTime(lockRemainingMs)}</span>
            </span>
            <Sep />
          </>
        )}
        {lockError && (
          <>
            <span className={cn(styles.inlineItem, styles.lockError)}>
              <Icon name="warning" size={11} /> {lockStatusText(lockError, lockConflict)}
            </span>
            <Sep />
          </>
        )}
        <span className={styles.inlineItem}>
          <span className={cn("mono", styles.countValue)}>{userBoxesCount}</span>
          <span>已确认</span>
        </span>
        <Sep />
        <span className={styles.inlineItem}>
          <Icon name="circleDot" size={11} className={styles.aiIcon} />
          <span className={cn("mono", styles.countValue, aiBoxesCount > 0 && styles.aiCountActive)}>{aiBoxesCount}</span>
          <span>AI 待审</span>
        </span>
        <Sep />
        <span className={styles.inlineItem}>
          当前类别
          <span className={styles.activeClass}>{activeClass}</span>
        </span>
      </div>
      <div className={styles.group}>
        {diffMode !== undefined && onSetDiffMode && (
          <>
            <div className={styles.diffGroup}>
              {(["final", "raw", "diff"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onSetDiffMode(m)}
                  className={cn(
                    styles.diffButton,
                    m === "final" && styles.diffButtonFirst,
                    m === "raw" && styles.diffButtonMiddle,
                    m === "diff" && styles.diffButtonLast,
                    diffMode === m && styles.diffButtonActive,
                  )}
                >
                  {m === "final" ? "仅最终" : m === "raw" ? "仅 AI" : "叠加"}
                </button>
              ))}
            </div>
            <Sep />
          </>
        )}
        {(offlineQueueCount && offlineQueueCount > 0) || online === false ? (
          <button
            type="button"
            onClick={onShowQueueDrawer}
            title={online === false ? "当前离线 · 点击查看离线队列详情" : "点击查看离线队列详情"}
            className={cn(
              styles.offlineButton,
              online === false ? styles.offlineButtonOffline : styles.offlineButtonOnline,
              !onShowQueueDrawer && styles.offlineButtonIdle,
            )}
          >
            <span className={styles.offlineLabel}>{online === false ? "离线" : "暂存"}</span>
            <span className="mono">· {offlineQueueCount ?? 0} 操作待同步</span>
          </button>
        ) : null}
        <span title="本会话单题平均耗时与剩余 ETA（&lt; 10 题样本时显示 —）">
          ETA <span className={cn("mono", styles.fgText, styles.monoMedium)}>{etaText}</span>
        </span>
        <Sep />
        <span>分辨率 <span className={cn("mono", styles.fgText)}>{dimText}</span></span>
        {cursorText && (
          <>
            <Sep />
            <span>光标 <span className={cn("mono", styles.fgText)}>{cursorText}</span></span>
          </>
        )}
        {preannotationProgress && (
          <>
            <Sep />
            <span className={styles.preannotation}>
              预标注 <span className="mono">{preannotationProgress.current}/{preannotationProgress.total}</span>
            </span>
          </>
        )}
        <Sep />
        <span className={styles.connection}>
          <span
            className={cn(
              styles.connectionDot,
              preannotationConn === "open" && styles.connectionOpen,
              preannotationConn === "reconnecting" && styles.connectionReconnecting,
              preannotationConn === "failed" && styles.connectionFailed,
            )}
          />
          {preannotationConn === "open" && "实时同步"}
          {preannotationConn === "reconnecting" && `重连中… (${preannotationRetries})`}
          {preannotationConn === "failed" && "实时进度暂停"}
        </span>
      </div>
    </div>
  );
}

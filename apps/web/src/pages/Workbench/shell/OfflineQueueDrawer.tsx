import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import {
  type OfflineOp,
  clearAll,
  getAll,
  removeById,
  subscribe,
} from "../state/offlineQueue";
import styles from "./OfflineQueueDrawer.module.css";

interface OfflineQueueDrawerProps {
  open: boolean;
  onClose: () => void;
  /** 当前题（v0.6.4：用于「当前题」筛选 + 默认展开当前题分组）。*/
  currentTaskId?: string;
  /** 单条同步：执行远端请求；抛错 = 不弹出，调用方 toast 错误。成功后 drawer 自己 removeById。 */
  onFlushOne: (op: OfflineOp) => Promise<void>;
  /** 全部同步：drain 整个队列，调用方负责 invalidate cache + 提示。 */
  onFlushAll: () => Promise<void>;
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const KIND_LABEL: Record<OfflineOp["kind"], string> = {
  create: "新建标注",
  update: "更新标注",
  delete: "删除标注",
};

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function kindClassName(kind: OfflineOp["kind"]): string {
  if (kind === "create") return styles.kindCreate;
  if (kind === "update") return styles.kindUpdate;
  return styles.kindDelete;
}

/** v0.6.4：retry_count 颜色阈值。0 灰，1-2 黄（已有失败但不严重），≥3 红。*/
function retryBadgeClassName(rc: number): string {
  if (rc >= 3) return styles.retryDanger;
  if (rc >= 1) return styles.retryWarning;
  return styles.retryNeutral;
}

type TaskFilter = "all" | "current";
type RetryFilter = "all" | "failed";

export function OfflineQueueDrawer({ open, onClose, currentTaskId, onFlushOne, onFlushAll }: OfflineQueueDrawerProps) {
  const [items, setItems] = useState<OfflineOp[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flushAllBusy, setFlushAllBusy] = useState(false);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [retryFilter, setRetryFilter] = useState<RetryFilter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const pushToast = useToastStore((s) => s.push);

  // 实时订阅队列变化
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = () => {
      getAll().then((q) => { if (!cancelled) setItems(q); });
    };
    const unsub = subscribe(() => refresh());
    refresh();
    return () => {
      cancelled = true;
      unsub();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 应用筛选
  const filtered = useMemo(() => {
    return items.filter((op) => {
      if (taskFilter === "current" && currentTaskId && op.taskId !== currentTaskId) return false;
      if (retryFilter === "failed" && (op.retry_count ?? 0) < 3) return false;
      return true;
    });
  }, [items, taskFilter, retryFilter, currentTaskId]);

  // 按 taskId 分组（保持时间顺序）
  const grouped = useMemo(() => {
    const order: string[] = [];
    const buckets: Record<string, OfflineOp[]> = {};
    for (const op of filtered) {
      if (!buckets[op.taskId]) {
        buckets[op.taskId] = [];
        order.push(op.taskId);
      }
      buckets[op.taskId].push(op);
    }
    return { order, buckets };
  }, [filtered]);

  // 跨题统计
  const taskCount = grouped.order.length;
  const currentTaskItemCount = useMemo(() => {
    if (!currentTaskId) return 0;
    return items.filter((op) => op.taskId === currentTaskId).length;
  }, [items, currentTaskId]);

  const handleRetry = useCallback(async (op: OfflineOp) => {
    setBusyId(op.id);
    try {
      await onFlushOne(op);
      await removeById(op.id);
      pushToast({ msg: "已同步该操作", kind: "success" });
    } catch (err) {
      pushToast({ msg: "同步失败", sub: String(err), kind: "error" });
    } finally {
      setBusyId(null);
    }
  }, [onFlushOne, pushToast]);

  const handleDelete = useCallback(async (op: OfflineOp) => {
    setBusyId(op.id);
    try {
      await removeById(op.id);
      pushToast({ msg: "已从队列删除", kind: "success" });
    } finally {
      setBusyId(null);
    }
  }, [pushToast]);

  const handleClearAll = useCallback(async () => {
    if (items.length === 0) return;
    if (!window.confirm(`确认丢弃全部 ${items.length} 条离线操作？此操作不可撤销。`)) return;
    await clearAll();
    pushToast({ msg: "队列已清空", kind: "warning" });
  }, [items.length, pushToast]);

  const handleFlushAll = useCallback(async () => {
    setFlushAllBusy(true);
    try {
      await onFlushAll();
    } finally {
      setFlushAllBusy(false);
    }
  }, [onFlushAll]);

  if (!open) return null;

  return createPortal(
    <>
      {/* 背景遮罩，仅供点击关闭，不阻塞画布交互 */}
      <div
        onClick={onClose}
        className={styles.backdrop}
      />
      <aside
        role="dialog"
        aria-label="离线队列"
        aria-modal="false"
        onClick={(e) => e.stopPropagation()}
        className={styles.drawer}
      >
        <header className={styles.header}>
          <div className={styles.headerContent}>
            <Icon name="inbox" size={14} />
            <div className={styles.title}>离线队列</div>
            <div className={styles.summary}>
              {items.length === 0
                ? "暂无操作"
                : `${items.length} 条 · 跨 ${taskCount} 题${currentTaskId ? ` · 当前题 ${currentTaskItemCount}` : ""}`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className={styles.iconButton}
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        {/* v0.6.4：筛选 chip */}
        {items.length > 0 && (
          <div className={styles.filters}>
            <span className={styles.filterLabel}>范围：</span>
            <FilterChip label="全部" active={taskFilter === "all"} onClick={() => setTaskFilter("all")} />
            <FilterChip
              label="当前题"
              active={taskFilter === "current"}
              disabled={!currentTaskId}
              onClick={() => setTaskFilter("current")}
            />
            <span className={styles.filterLabelSpaced}>状态：</span>
            <FilterChip label="全部" active={retryFilter === "all"} onClick={() => setRetryFilter("all")} />
            <FilterChip
              label="失败 ≥ 3"
              active={retryFilter === "failed"}
              onClick={() => setRetryFilter("failed")}
            />
          </div>
        )}

        <div className={styles.content}>
          {filtered.length === 0 ? (
            <div className={styles.emptyState}>
              <Icon name="check" size={18} className={styles.emptyIcon} />
              <div>{items.length === 0 ? "暂无离线操作" : "当前筛选无匹配项"}</div>
              <div className={styles.emptyHint}>
                {items.length === 0 ? "所有标注操作已同步至服务器。" : "调整上方筛选 chip 查看其他项。"}
              </div>
            </div>
          ) : (
            grouped.order.map((tid) => {
              const opsInTask = grouped.buckets[tid];
              const isCurrent = tid === currentTaskId;
              const isCollapsed = collapsed[tid] ?? !isCurrent; // 默认展开当前题，其余折叠
              return (
                <div key={tid} className={styles.taskGroup}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [tid]: !isCollapsed }))}
                    className={cn(styles.groupHeader, isCurrent && styles.groupHeaderCurrent)}
                  >
                    <Icon name={isCollapsed ? "chevRight" : "chevDown"} size={11} />
                    <span className="mono">任务 {tid.slice(0, 8)}…</span>
                    {isCurrent && <span className={styles.currentBadge}>当前</span>}
                    <span className={styles.groupCount}>
                      {opsInTask.length} 条
                    </span>
                  </button>
                  {!isCollapsed && opsInTask.map((op) => {
                    const isBusy = busyId === op.id;
                    const rc = op.retry_count ?? 0;
                    return (
                      <div
                        key={op.id}
                        className={cn(
                          styles.queueItem,
                          isBusy && styles.queueItemBusy,
                          rc >= 3 && styles.queueItemFailed,
                        )}
                      >
                        <div className={styles.itemMeta}>
                          <span
                            className={cn(styles.kindBadge, kindClassName(op.kind))}
                          >
                            {KIND_LABEL[op.kind]}
                          </span>
                          <span className={cn("mono", styles.mutedMono)}>
                            {formatTs(op.ts)}
                          </span>
                          {rc > 0 && (
                            <span
                              className={cn(styles.retryBadge, retryBadgeClassName(rc))}
                              title={`累计同步失败 ${rc} 次`}
                            >
                              失败 ×{rc}
                            </span>
                          )}
                          {op.kind === "create" && op.tmpId && (
                            <span
                              className={cn("mono", styles.tmpId)}
                              title={op.tmpId}
                            >
                              {op.tmpId.slice(0, 12)}…
                            </span>
                          )}
                        </div>
                        {op.kind !== "create" && (
                          <div className={cn("mono", styles.mutedMono)}>
                            标注 {op.annotationId.slice(0, 8)}…
                          </div>
                        )}
                        <div className={styles.itemActions}>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleRetry(op)}
                            className={styles.smallButton}
                          >
                            重试
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDelete(op)}
                            className={cn(styles.smallButton, styles.discardButton)}
                          >
                            丢弃
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            disabled={items.length === 0}
            onClick={handleClearAll}
            className={styles.footerButton}
          >
            全部丢弃
          </button>
          <button
            type="button"
            disabled={items.length === 0 || flushAllBusy}
            onClick={handleFlushAll}
            className={cn(styles.footerButton, styles.syncAllButton)}
          >
            {flushAllBusy ? "同步中…" : "立即同步全部"}
          </button>
        </footer>
      </aside>
    </>,
    document.body,
  );
}

function FilterChip({
  label, active, disabled, onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(styles.filterChip, active && styles.filterChipActive)}
    >
      {label}
    </button>
  );
}

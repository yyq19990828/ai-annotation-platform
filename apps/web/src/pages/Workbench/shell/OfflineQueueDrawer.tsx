import { useCallback, useEffect, useState } from "react";
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

interface OfflineQueueDrawerProps {
  open: boolean;
  onClose: () => void;
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

function kindColor(kind: OfflineOp["kind"]): string {
  if (kind === "create") return "oklch(0.65 0.15 145)";
  if (kind === "update") return "oklch(0.70 0.15 75)";
  return "oklch(0.60 0.18 25)";
}

export function OfflineQueueDrawer({ open, onClose, onFlushOne, onFlushAll }: OfflineQueueDrawerProps) {
  const [items, setItems] = useState<OfflineOp[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flushAllBusy, setFlushAllBusy] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  // 实时订阅队列变化（多 tab 也会触发）
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
        style={{
          position: "fixed",
          inset: 0,
          background: "oklch(0 0 0 / 0.25)",
          zIndex: 60,
        }}
      />
      <aside
        role="dialog"
        aria-label="离线队列"
        aria-modal="false"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          right: 0,
          top: 0,
          bottom: 0,
          width: 380,
          maxWidth: "100vw",
          background: "var(--color-bg-elev)",
          borderLeft: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-lg)",
          zIndex: 61,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="inbox" size={14} />
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-fg)" }}>离线队列</div>
            <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
              {items.length === 0 ? "暂无操作" : `${items.length} 条待同步`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--color-fg-muted)",
              padding: 4,
              display: "inline-flex",
              alignItems: "center",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {items.length === 0 ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--color-fg-muted)",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              <Icon name="check" size={18} style={{ color: "oklch(0.65 0.15 145)", marginBottom: 8 }} />
              <div>暂无离线操作</div>
              <div style={{ marginTop: 4, fontSize: 11 }}>所有标注操作已同步至服务器。</div>
            </div>
          ) : (
            items.map((op) => {
              const isBusy = busyId === op.id;
              return (
                <div
                  key={op.id}
                  style={{
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--color-border)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    opacity: isBusy ? 0.5 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: kindColor(op.kind),
                        background: "var(--color-bg-sunken)",
                        padding: "1px 6px",
                        borderRadius: 3,
                      }}
                    >
                      {KIND_LABEL[op.kind]}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--color-fg-muted)" }} className="mono">
                      {formatTs(op.ts)}
                    </span>
                    {op.kind === "create" && op.tmpId && (
                      <span
                        style={{ fontSize: 10, color: "var(--color-fg-muted)" }}
                        className="mono"
                        title={op.tmpId}
                      >
                        {op.tmpId.slice(0, 12)}…
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }} className="mono">
                    任务 {op.taskId.slice(0, 8)}…
                    {op.kind !== "create" && ` · 标注 ${op.annotationId.slice(0, 8)}…`}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleRetry(op)}
                      style={{
                        fontSize: 11,
                        padding: "3px 10px",
                        border: "1px solid var(--color-border)",
                        background: "var(--color-bg-elev)",
                        borderRadius: "var(--radius-sm)",
                        cursor: isBusy ? "wait" : "pointer",
                        color: "var(--color-fg)",
                      }}
                    >
                      重试
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDelete(op)}
                      style={{
                        fontSize: 11,
                        padding: "3px 10px",
                        border: "1px solid var(--color-border)",
                        background: "transparent",
                        borderRadius: "var(--radius-sm)",
                        cursor: isBusy ? "wait" : "pointer",
                        color: "oklch(0.60 0.18 25)",
                      }}
                    >
                      丢弃
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <footer
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--color-border)",
            display: "flex",
            gap: 8,
            justifyContent: "space-between",
          }}
        >
          <button
            type="button"
            disabled={items.length === 0}
            onClick={handleClearAll}
            style={{
              fontSize: 12,
              padding: "6px 12px",
              border: "1px solid var(--color-border)",
              background: "transparent",
              borderRadius: "var(--radius-sm)",
              cursor: items.length === 0 ? "not-allowed" : "pointer",
              color: items.length === 0 ? "var(--color-fg-muted)" : "oklch(0.60 0.18 25)",
              opacity: items.length === 0 ? 0.5 : 1,
            }}
          >
            全部丢弃
          </button>
          <button
            type="button"
            disabled={items.length === 0 || flushAllBusy}
            onClick={handleFlushAll}
            style={{
              fontSize: 12,
              padding: "6px 14px",
              border: "1px solid oklch(0.55 0.18 250)",
              background: "oklch(0.55 0.18 250)",
              borderRadius: "var(--radius-sm)",
              cursor: items.length === 0 || flushAllBusy ? "not-allowed" : "pointer",
              color: "white",
              fontWeight: 600,
              opacity: items.length === 0 || flushAllBusy ? 0.5 : 1,
            }}
          >
            {flushAllBusy ? "同步中…" : "立即同步全部"}
          </button>
        </footer>
      </aside>
    </>,
    document.body,
  );
}

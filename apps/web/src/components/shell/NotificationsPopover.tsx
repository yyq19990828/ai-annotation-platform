import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import { useNotifications, markAllRead } from "@/hooks/useNotifications";
import { auditActionLabel } from "@/utils/auditLabels";
import type { NotificationItem } from "@/api/notifications";

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

function NotifRow({ item, isNew }: { item: NotificationItem; isNew: boolean }) {
  return (
    <div style={{
      padding: "10px 14px",
      borderBottom: "1px solid var(--color-border)",
      display: "flex", gap: 10, alignItems: "flex-start",
      background: isNew ? "oklch(0.97 0.01 252)" : undefined,
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: "50%", marginTop: 6, flexShrink: 0,
        background: isNew ? "var(--color-accent)" : "transparent",
        border: isNew ? undefined : "1px solid var(--color-border)",
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5 }}>
          <span style={{ fontWeight: 500 }}>{item.actor_email ?? "系统"}</span>
          {" "}
          <span style={{ color: "var(--color-fg-muted)" }}>{auditActionLabel(item.action)}</span>
          {item.target_type && (
            <span style={{ color: "var(--color-fg-muted)" }}> · {item.target_type}</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 2 }}>
          {relativeTime(item.created_at)}
        </div>
      </div>
    </div>
  );
}

interface Props {
  onClose: () => void;
}

export function NotificationsPopover({ onClose }: Props) {
  const { data } = useNotifications();
  const ref = useRef<HTMLDivElement>(null);
  const lastRead = (() => {
    const v = localStorage.getItem("notifications_last_read");
    return v ? parseInt(v, 10) : 0;
  })();

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const items = data?.items ?? [];

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        width: 340,
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg, 0 8px 24px rgba(0,0,0,.12))",
        zIndex: 200,
        overflow: "hidden",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 14px 10px",
        borderBottom: "1px solid var(--color-border)",
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>通知</span>
        {items.length > 0 && (
          <button
            onClick={() => { markAllRead(); onClose(); }}
            style={{
              fontSize: 11, color: "var(--color-accent)", background: "none",
              border: "none", cursor: "pointer", padding: 0,
            }}
          >
            全部已读
          </button>
        )}
      </div>

      <div style={{ maxHeight: 380, overflowY: "auto" }}>
        {items.length === 0 ? (
          <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
            <Icon name="bell" size={22} style={{ opacity: 0.25, marginBottom: 6 }} />
            <div>暂无通知</div>
          </div>
        ) : (
          items.map((item) => (
            <NotifRow
              key={item.id}
              item={item}
              isNew={new Date(item.created_at).getTime() > lastRead}
            />
          ))
        )}
      </div>
    </div>
  );
}

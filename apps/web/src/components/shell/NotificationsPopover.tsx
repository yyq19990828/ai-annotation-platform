import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import {
  useNotifications,
  useMarkAllRead,
  useMarkRead,
} from "@/hooks/useNotifications";
import type { NotificationItem } from "@/api/notifications";
import { useAuthStore } from "@/stores/authStore";
import { useBugDrawerStore } from "@/stores/bugDrawerStore";

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

const TYPE_LABEL: Record<string, string> = {
  "bug_report.commented": "评论了反馈",
  "bug_report.status_changed": "更新了反馈状态",
  "bug_report.reopened": "重新打开了反馈",
  "batch.rejected": "驳回了批次",
};

interface NotifRowProps {
  item: NotificationItem;
  onClick: () => void;
}

function NotifRow({ item, onClick }: NotifRowProps) {
  const isUnread = item.read_at === null;
  const payload = item.payload || {};
  const actorName = (payload as { actor_name?: string }).actor_name || "系统";
  const fromStatus = (payload as { from_status?: string }).from_status;
  const toStatus = (payload as { to_status?: string }).to_status;
  const reopen = Boolean((payload as { reopen?: boolean }).reopen);

  // v0.7.0：batch.rejected 复用同一行渲染，但 payload 字段不同
  const isBatchRejected = item.type === "batch.rejected";
  const displayId = isBatchRejected
    ? (payload as { batch_display_id?: string }).batch_display_id || ""
    : (payload as { display_id?: string }).display_id || "";
  const title = isBatchRejected
    ? (payload as { batch_name?: string }).batch_name || ""
    : (payload as { title?: string }).title || "";
  const snippet = isBatchRejected
    ? (payload as { feedback?: string }).feedback || ""
    : (payload as { snippet?: string }).snippet || "";

  const verb = reopen
    ? "重新打开了反馈"
    : item.type === "bug_report.status_changed"
    ? `状态 ${fromStatus ?? ""} → ${toStatus ?? ""}`
    : TYPE_LABEL[item.type] || item.type;

  return (
    <div
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--color-border)",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        background: isUnread ? "oklch(0.97 0.01 252)" : undefined,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          marginTop: 6,
          flexShrink: 0,
          background: isUnread ? "var(--color-accent)" : "transparent",
          border: isUnread ? undefined : "1px solid var(--color-border)",
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5 }}>
          <span style={{ fontWeight: 500 }}>{actorName}</span>{" "}
          <span style={{ color: "var(--color-fg-muted)" }}>{verb}</span>
          {displayId && (
            <>
              {" "}
              <span style={{ color: "var(--color-fg-muted)" }}>· {displayId}</span>
            </>
          )}
        </div>
        {title && (
          <div
            style={{
              fontSize: 12,
              color: "var(--color-fg)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </div>
        )}
        {snippet && (
          <div
            style={{
              fontSize: 11,
              color: "var(--color-fg-muted)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            “{snippet}”
          </div>
        )}
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
  const markAllRead = useMarkAllRead();
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const role = useAuthStore((s) => s.user?.role);
  const openBugDrawer = useBugDrawerStore((s) => s.openDrawer);

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
  const unread = data?.unread ?? 0;

  function handleRowClick(item: NotificationItem) {
    if (item.read_at === null) {
      markRead.mutate(item.id);
    }
    if (item.target_type === "bug_report") {
      // v0.7.0：按角色路由 — admin/super_admin 跳 /bugs 总览；提交者打开「我的反馈」抽屉并定位到该条
      if (role === "super_admin" || role === "project_admin") {
        navigate("/bugs");
      } else {
        openBugDrawer(item.target_id);
      }
    } else if (item.target_type === "batch") {
      // v0.7.0：批次相关通知（如 batch.rejected）跳工作台并预选该批次
      const payload = (item.payload || {}) as { project_id?: string };
      const projectId = payload.project_id;
      if (projectId) {
        navigate(`/projects/${projectId}/annotate?batch=${item.target_id}`);
      }
    }
    onClose();
  }

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        width: 360,
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg, 0 8px 24px rgba(0,0,0,.12))",
        zIndex: 200,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px 10px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          通知{unread > 0 ? ` · ${unread} 未读` : ""}
        </span>
        {unread > 0 && (
          <button
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            style={{
              fontSize: 11,
              color: "var(--color-accent)",
              background: "none",
              border: "none",
              cursor: markAllRead.isPending ? "not-allowed" : "pointer",
              padding: 0,
            }}
          >
            全部已读
          </button>
        )}
      </div>

      <div style={{ maxHeight: 380, overflowY: "auto" }}>
        {items.length === 0 ? (
          <div
            style={{
              padding: "24px 14px",
              textAlign: "center",
              color: "var(--color-fg-subtle)",
              fontSize: 13,
            }}
          >
            <Icon name="bell" size={22} style={{ opacity: 0.25, marginBottom: 6 }} />
            <div>暂无通知</div>
          </div>
        ) : (
          items.map((item) => (
            <NotifRow key={item.id} item={item} onClick={() => handleRowClick(item)} />
          ))
        )}
      </div>
    </div>
  );
}

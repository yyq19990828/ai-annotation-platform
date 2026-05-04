import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { useBatchAuditLogs } from "@/hooks/useBatches";
import type { BatchResponse, BatchAuditLogEntry } from "@/api/batches";

const ACTION_LABEL: Record<string, string> = {
  "batch.created": "创建",
  "batch.status_changed": "状态变更",
  "batch.rejected": "驳回",
  "batch.deleted": "删除",
  "batch.distribute_even": "项目级分派",
  "batch.bulk_archive": "批量归档",
  "batch.bulk_delete": "批量删除",
  "batch.bulk_reassign": "批量改派",
  "batch.bulk_activate": "批量激活",
};

const ROLE_VARIANT: Record<string, "default" | "accent" | "warning" | "success" | "danger"> = {
  super_admin: "danger",
  project_admin: "accent",
  reviewer: "warning",
  annotator: "default",
  viewer: "default",
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "超管",
  project_admin: "项目管理",
  reviewer: "质检员",
  annotator: "标注员",
  viewer: "只读",
};

export function BatchAuditLogDrawer({
  projectId,
  batch,
  onClose,
}: {
  projectId: string;
  batch: BatchResponse;
  onClose: () => void;
}) {
  const { data: logs = [], isLoading } = useBatchAuditLogs(projectId, batch.id, true);

  return (
    <Modal open onClose={onClose} title={`操作历史 · ${batch.display_id} ${batch.name}`} width={680}>
      {isLoading && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
          加载中…
        </div>
      )}
      {!isLoading && logs.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
          暂无操作记录
        </div>
      )}
      {!isLoading && logs.length > 0 && (
        <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
          {logs.map((log) => (
            <Entry key={log.id} log={log} />
          ))}
        </div>
      )}
    </Modal>
  );
}

function Entry({ log }: { log: BatchAuditLogEntry }) {
  const [open, setOpen] = useState(false);
  const time = log.created_at ? new Date(log.created_at).toLocaleString() : "—";
  const role = log.actor_role ?? "";
  const actionLabel = ACTION_LABEL[log.action] ?? log.action;

  // 状态变更：detail.before / detail.after / detail.reverse / detail.reason
  const detail = log.detail ?? {};
  const before = (detail as { before?: string }).before;
  const after = (detail as { after?: string }).after;
  const reverse = (detail as { reverse?: boolean }).reverse;
  const reason = (detail as { reason?: string }).reason;

  return (
    <div
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid var(--color-border)",
        fontSize: 12.5,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="mono" style={{ color: "var(--color-fg-subtle)", fontSize: 11 }}>{time}</span>
        {role && (
          <Badge variant={ROLE_VARIANT[role] ?? "default"} dot>
            {ROLE_LABEL[role] ?? role}
          </Badge>
        )}
        <span style={{ color: "var(--color-fg-muted)" }}>{log.actor_email ?? "—"}</span>
        <span style={{ fontWeight: 500 }}>{actionLabel}</span>
        {log.action === "batch.status_changed" && before && after && (
          <span style={{ color: "var(--color-fg-subtle)" }}>
            {before} → <strong style={{ color: "var(--color-fg)" }}>{after}</strong>
            {reverse && (
              <span
                style={{
                  marginLeft: 6,
                  padding: "1px 6px",
                  borderRadius: 100,
                  background: "var(--color-warning)",
                  color: "#fff",
                  fontSize: 10,
                }}
              >
                逆向
              </span>
            )}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "none",
            color: "var(--color-accent)",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "inherit",
          }}
        >
          {open ? "收起" : "详情"}
        </button>
      </div>
      {reason && (
        <div
          style={{
            marginTop: 4,
            padding: "4px 8px",
            background: "color-mix(in oklab, var(--color-warning) 8%, transparent)",
            borderLeft: "2px solid var(--color-warning)",
            color: "var(--color-fg-muted)",
            fontSize: 12,
          }}
        >
          原因：{reason}
        </div>
      )}
      {open && (
        <pre
          style={{
            marginTop: 6,
            padding: 8,
            background: "var(--color-bg-sunken)",
            borderRadius: "var(--radius-sm)",
            fontSize: 11,
            color: "var(--color-fg-muted)",
            overflowX: "auto",
            fontFamily: "var(--font-mono)",
          }}
        >
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

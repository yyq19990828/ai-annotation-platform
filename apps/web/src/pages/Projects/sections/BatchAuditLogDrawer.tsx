import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { useBatchAuditLogs } from "@/hooks/useBatches";
import type { BatchResponse, BatchAuditLogEntry } from "@/api/batches";
import styles from "./BatchAuditLogDrawer.module.css";

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

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
        <div className={styles.placeholder}>
          加载中…
        </div>
      )}
      {!isLoading && logs.length === 0 && (
        <div className={styles.placeholder}>
          暂无操作记录
        </div>
      )}
      {!isLoading && logs.length > 0 && (
        <div className={styles.logList}>
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
    <div className={styles.entry}>
      <div className={styles.entryHeader}>
        <span className={cn("mono", styles.time)}>{time}</span>
        {role && (
          <Badge variant={ROLE_VARIANT[role] ?? "default"} dot>
            {ROLE_LABEL[role] ?? role}
          </Badge>
        )}
        <span className={styles.actorEmail}>{log.actor_email ?? "—"}</span>
        <span className={styles.actionLabel}>{actionLabel}</span>
        {log.action === "batch.status_changed" && before && after && (
          <span className={styles.statusChange}>
            {before} → <strong className={styles.statusAfter}>{after}</strong>
            {reverse && (
              <span className={styles.reverseBadge}>
                逆向
              </span>
            )}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={styles.detailButton}
        >
          {open ? "收起" : "详情"}
        </button>
      </div>
      {reason && (
        <div className={styles.reason}>
          原因：{reason}
        </div>
      )}
      {open && (
        <pre className={styles.detailPre}>
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

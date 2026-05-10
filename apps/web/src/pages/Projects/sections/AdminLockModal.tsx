import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { BatchResponse } from "@/api/batches";

const REASON_MAX = 500;

export function AdminLockModal({
  batch,
  onClose,
  onSubmit,
  pending,
}: {
  batch: BatchResponse;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const tooLong = trimmed.length > REASON_MAX;
  const canSubmit = trimmed.length > 0 && !tooLong && !pending;

  return (
    <Modal open title={`锁定批次 ${batch.display_id}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
        <p style={{ margin: 0, color: "var(--color-fg-muted)" }}>
          锁定后，自动状态推进将被冻结，不再向该批次派发新任务。锁定原因将记录在审计日志中，并通知被分派的标注员 / 审核员。
        </p>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
            锁定原因（必填，{trimmed.length}/{REASON_MAX}）
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="请说明锁定原因，例如：发现数据质量问题，暂停标注，待确认后解锁…"
            rows={4}
            style={{
              padding: "8px 10px",
              border: `1px solid ${tooLong ? "var(--color-danger)" : "var(--color-border)"}`,
              borderRadius: "var(--radius-sm)",
              fontSize: 13,
              fontFamily: "inherit",
              background: "var(--color-bg)",
              color: "var(--color-fg)",
              resize: "vertical",
              minHeight: 88,
            }}
            autoFocus
          />
          {tooLong && (
            <span style={{ fontSize: 11, color: "var(--color-danger)" }}>
              超出 {REASON_MAX} 字上限
            </span>
          )}
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button
            onClick={() => canSubmit && onSubmit(trimmed)}
            disabled={!canSubmit}
            style={{
              background: canSubmit ? "var(--color-warning)" : undefined,
              color: canSubmit ? "#fff" : undefined,
            }}
          >
            {pending ? "锁定中…" : "确认锁定"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

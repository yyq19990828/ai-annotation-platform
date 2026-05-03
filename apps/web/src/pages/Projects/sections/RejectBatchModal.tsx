import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/components/ui/Toast";
import { useRejectBatch } from "@/hooks/useBatches";
import type { BatchResponse } from "@/api/batches";

const FEEDBACK_MAX = 500;

export function RejectBatchModal({
  projectId,
  batch,
  onClose,
}: {
  projectId: string;
  batch: BatchResponse;
  onClose: () => void;
}) {
  const pushToast = useToastStore((s) => s.push);
  const rejectBatch = useRejectBatch(projectId);
  const [feedback, setFeedback] = useState("");
  const trimmed = feedback.trim();
  const tooLong = trimmed.length > FEEDBACK_MAX;
  const canSubmit = trimmed.length > 0 && !tooLong && !rejectBatch.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    rejectBatch.mutate(
      { batchId: batch.id, feedback: trimmed },
      {
        onSuccess: () => {
          pushToast({ msg: "批次已驳回，已通知被分派的标注员", kind: "success" });
          onClose();
        },
        onError: (e) =>
          pushToast({ msg: "驳回失败", sub: (e as Error).message, kind: "warning" }),
      },
    );
  };

  return (
    <Modal open title={`驳回批次 ${batch.display_id}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
        <p style={{ margin: 0, color: "var(--color-fg-muted)" }}>
          驳回后批次状态变为「已退回」，被分派的标注员会收到通知。已提交质检 / 已通过的任务回退到待标注，**已有标注内容会保留**，标注员可在 reviewer 留言指引下继续修改。
        </p>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
            驳回原因 / 留言（必填，{trimmed.length}/{FEEDBACK_MAX}）
          </span>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="请说明需要标注员重做的具体问题…"
            rows={5}
            style={{
              padding: "8px 10px",
              border: `1px solid ${tooLong ? "var(--color-danger)" : "var(--color-border)"}`,
              borderRadius: "var(--radius-sm)",
              fontSize: 13,
              fontFamily: "inherit",
              background: "var(--color-bg)",
              color: "var(--color-fg)",
              resize: "vertical",
              minHeight: 100,
            }}
            autoFocus
          />
          {tooLong && (
            <span style={{ fontSize: 11, color: "var(--color-danger)" }}>
              超出 {FEEDBACK_MAX} 字上限
            </span>
          )}
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              background: canSubmit ? "var(--color-danger)" : undefined,
              color: canSubmit ? "#fff" : undefined,
            }}
          >
            {rejectBatch.isPending ? "驳回中…" : "确认驳回"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

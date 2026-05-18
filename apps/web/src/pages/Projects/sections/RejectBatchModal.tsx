import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/components/ui/Toast";
import { useRejectBatch } from "@/hooks/useBatches";
import type { BatchResponse } from "@/api/batches";
import styles from "./RejectBatchModal.module.css";

const FEEDBACK_MAX = 500;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

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
      <div className={styles.body}>
        <p className={styles.description}>
          驳回后批次状态变为「已退回」，被分派的标注员会收到通知。已提交质检 / 已通过的任务回退到待标注，**已有标注内容会保留**，标注员可在 reviewer 留言指引下继续修改。
        </p>
        <label className={styles.field}>
          <span className={styles.labelText}>
            驳回原因 / 留言（必填，{trimmed.length}/{FEEDBACK_MAX}）
          </span>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="请说明需要标注员重做的具体问题…"
            rows={5}
            className={cn(styles.textarea, tooLong && styles.textareaInvalid)}
            autoFocus
          />
          {tooLong && (
            <span className={styles.errorText}>
              超出 {FEEDBACK_MAX} 字上限
            </span>
          )}
        </label>
        <div className={styles.actions}>
          <Button onClick={onClose}>取消</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={canSubmit ? styles.dangerSubmitButton : undefined}
          >
            {rejectBatch.isPending ? "驳回中…" : "确认驳回"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

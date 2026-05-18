import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/components/ui/Toast";
import { useTransitionBatch } from "@/hooks/useBatches";
import type { BatchResponse } from "@/api/batches";
import styles from "./ReverseTransitionModal.module.css";

const REASON_MAX = 500;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type ReverseKind = "unarchive" | "reopen_from_approved" | "reopen_from_rejected";

const COPY: Record<
  ReverseKind,
  { title: (b: BatchResponse) => string; description: string; targetStatus: string; success: string }
> = {
  unarchive: {
    title: (b) => `撤销归档 · ${b.display_id}`,
    description:
      "批次状态会回到「激活」，由调度器在下一次任务操作时自动推进到正确阶段。被分派的标注员 / 审核员会收到通知。",
    targetStatus: "active",
    success: "已撤销归档",
  },
  reopen_from_approved: {
    title: (b) => `重开审核 · ${b.display_id}`,
    description:
      "批次会从「已通过」回到「审核中」。原审核元数据（通过时间 / 审核人 / 反馈）会被清空，审核员需重新评估。",
    targetStatus: "reviewing",
    success: "已重开审核",
  },
  reopen_from_rejected: {
    title: (b) => `直接复审 · ${b.display_id}`,
    description:
      "批次从「已退回」直接进入「审核中」，跳过标注员重做。上一次的退回原因会保留，审核员可重新评估。",
    targetStatus: "reviewing",
    success: "已直接复审",
  },
};

export function ReverseTransitionModal({
  projectId,
  batch,
  kind,
  onClose,
}: {
  projectId: string;
  batch: BatchResponse;
  kind: ReverseKind;
  onClose: () => void;
}) {
  const pushToast = useToastStore((s) => s.push);
  const transition = useTransitionBatch(projectId);
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const tooLong = trimmed.length > REASON_MAX;
  const canSubmit = trimmed.length > 0 && !tooLong && !transition.isPending;
  const copy = COPY[kind];

  const handleSubmit = () => {
    if (!canSubmit) return;
    transition.mutate(
      { batchId: batch.id, targetStatus: copy.targetStatus, reason: trimmed },
      {
        onSuccess: () => {
          pushToast({ msg: copy.success, kind: "success" });
          onClose();
        },
        onError: (e) =>
          pushToast({ msg: "操作失败", sub: (e as Error).message, kind: "warning" }),
      },
    );
  };

  return (
    <Modal open title={copy.title(batch)} onClose={onClose}>
      <div className={styles.body}>
        <p className={styles.description}>{copy.description}</p>
        <label className={styles.field}>
          <span className={styles.labelText}>
            操作原因（必填 · {trimmed.length}/{REASON_MAX}） · 会写入审计日志
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="请简要说明操作原因（运维需要 / 误判修正 / …）"
            rows={4}
            className={cn(styles.textarea, tooLong && styles.textareaInvalid)}
            autoFocus
          />
          {tooLong && (
            <span className={styles.errorText}>
              超出 {REASON_MAX} 字上限
            </span>
          )}
        </label>
        <div className={styles.actions}>
          <Button onClick={onClose}>取消</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={canSubmit ? styles.accentSubmitButton : undefined}
          >
            {transition.isPending ? "提交中…" : "确认"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

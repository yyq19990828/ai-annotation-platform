/**
 * v0.7.6 · ResetBatchModal — 终极重置到 draft 的二次确认 modal
 *
 * 与 ReverseTransitionModal 的区别：reset 绕过 VALID_TRANSITIONS，是 owner 兜底重置。
 * 强制 reason ≥ 10 字（与后端 BatchReset schema 对齐）。task 全回 pending、保留 annotation、释放标注员锁。
 */
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/components/ui/Toast";
import { useResetBatch } from "@/hooks/useBatches";
import type { BatchResponse } from "@/api/batches";
import styles from "./ResetBatchModal.module.css";

const REASON_MIN = 10;
const REASON_MAX = 500;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function ResetBatchModal({
  projectId,
  batch,
  onClose,
}: {
  projectId: string;
  batch: BatchResponse;
  onClose: () => void;
}) {
  const pushToast = useToastStore((s) => s.push);
  const reset = useResetBatch(projectId);
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < REASON_MIN;
  const tooLong = trimmed.length > REASON_MAX;
  const canSubmit = trimmed.length >= REASON_MIN && !tooLong && !reset.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    reset.mutate(
      { batchId: batch.id, reason: trimmed },
      {
        onSuccess: () => {
          pushToast({ msg: "已重置到草稿", kind: "success" });
          onClose();
        },
        onError: (e) =>
          pushToast({ msg: "重置失败", sub: (e as Error).message, kind: "warning" }),
      },
    );
  };

  return (
    <Modal open title={`重置到草稿 · ${batch.display_id}`} onClose={onClose}>
      <div className={styles.body}>
        <div className={styles.warningBox}>
          <strong>这是 owner 兜底操作。</strong>批次将从 <code>{batch.status}</code> 强制回到 <code>draft</code>：
          <ul className={styles.warningList}>
            <li>批次内 <strong>{batch.total_tasks}</strong> 个 task 全部回 pending</li>
            <li>已有标注记录 <strong>保留</strong>（不删 annotation，不改 is_active）</li>
            <li>会 <strong>释放</strong> 所有标注员锁，原审核反馈 / 审核人会被清空</li>
          </ul>
        </div>
        <label className={styles.field}>
          <span className={styles.labelText}>
            重置原因（必填 · 至少 {REASON_MIN} 字 · {trimmed.length}/{REASON_MAX}） · 会写入审计日志
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="说明为什么要把批次回退到草稿（迁移错误数据 / 整体重做 / …）"
            rows={4}
            className={cn(styles.textarea, (tooLong || tooShort) && styles.textareaInvalid)}
            autoFocus
          />
          {tooShort && (
            <span className={styles.errorText}>
              至少 {REASON_MIN} 字
            </span>
          )}
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
            className={canSubmit ? styles.warningSubmitButton : undefined}
          >
            {reset.isPending ? "重置中…" : "确认重置"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

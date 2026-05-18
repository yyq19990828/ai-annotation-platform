import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { BatchResponse } from "@/api/batches";
import styles from "./AdminLockModal.module.css";

const REASON_MAX = 500;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

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
      <div className={styles.body}>
        <p className={styles.description}>
          锁定后，自动状态推进将被冻结，不再向该批次派发新任务。锁定原因将记录在审计日志中，并通知被分派的标注员 / 审核员。
        </p>
        <label className={styles.field}>
          <span className={styles.labelText}>
            锁定原因（必填，{trimmed.length}/{REASON_MAX}）
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="请说明锁定原因，例如：发现数据质量问题，暂停标注，待确认后解锁…"
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
            onClick={() => canSubmit && onSubmit(trimmed)}
            disabled={!canSubmit}
            className={canSubmit ? styles.warningSubmitButton : undefined}
          >
            {pending ? "锁定中…" : "确认锁定"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

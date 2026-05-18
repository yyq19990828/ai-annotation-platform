import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import styles from "./BulkRejectModal.module.css";

const FEEDBACK_MAX = 500;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function BulkRejectModal({
  count,
  onClose,
  onSubmit,
  pending,
}: {
  count: number;
  onClose: () => void;
  onSubmit: (feedback: string) => void;
  pending: boolean;
}) {
  const [feedback, setFeedback] = useState("");
  const trimmed = feedback.trim();
  const tooLong = trimmed.length > FEEDBACK_MAX;
  const canSubmit = trimmed.length > 0 && !tooLong && !pending;

  return (
    <Modal open title={`批量驳回 ${count} 个批次`} onClose={onClose}>
      <div className={styles.body}>
        <p className={styles.description}>
          所选「审核中」批次将全部变为「已退回」，已提交质检 / 已通过的任务回退到待标注，标注内容保留。同一条反馈留言将发送给各批次的被分派标注员。
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
            onClick={() => canSubmit && onSubmit(trimmed)}
            disabled={!canSubmit}
            className={canSubmit ? styles.dangerSubmitButton : undefined}
          >
            {pending ? "驳回中…" : `确认驳回 ${count} 个批次`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

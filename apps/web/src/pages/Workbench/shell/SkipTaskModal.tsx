/**
 * v0.8.7 F7 · 标注员跳过任务 modal。
 *
 * 4 项预设原因（image_corrupt / no_target / unclear / other）+ 可选 note。
 * 确认后 POST /tasks/{id}/skip，由父组件触发 invalidate + 切下一题。
 */
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import styles from "./SkipTaskModal.module.css";

export type SkipReason = "image_corrupt" | "no_target" | "unclear" | "other";

const REASON_LABELS: Record<SkipReason, string> = {
  image_corrupt: "图像损坏 / 无法打开",
  no_target: "图中无目标可标",
  unclear: "图像不清晰 / 难以判断",
  other: "其他（请补充说明）",
};

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

interface SkipTaskModalProps {
  open: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: (reason: SkipReason, note?: string) => void;
}

export function SkipTaskModal({
  open,
  isSubmitting,
  onClose,
  onConfirm,
}: SkipTaskModalProps) {
  const [reason, setReason] = useState<SkipReason>("image_corrupt");
  const [note, setNote] = useState("");

  const canConfirm =
    reason !== "other" || note.trim().length > 0;

  return (
    <Modal open={open} onClose={onClose} title="跳过任务" width={420}>
      <div className={styles.content}>
        <p className={styles.description}>
          被跳过的任务会自动转给审核员复核；请选择主要原因。
        </p>
        {(Object.keys(REASON_LABELS) as SkipReason[]).map((r) => (
          <label
            key={r}
            className={cn(styles.reasonOption, reason === r && styles.reasonOptionSelected)}
            data-testid={`skip-reason-${r}`}
          >
            <input
              type="radio"
              name="skip-reason"
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
              className={styles.reasonInput}
            />
            <span>{REASON_LABELS[r]}</span>
          </label>
        ))}
        {reason === "other" && (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="补充说明…"
            rows={3}
            className={styles.note}
            data-testid="skip-reason-note"
          />
        )}
        <div className={styles.actions}>
          <Button onClick={onClose} disabled={isSubmitting}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!canConfirm || isSubmitting}
            onClick={() =>
              onConfirm(reason, reason === "other" ? note.trim() : undefined)
            }
            data-testid="skip-confirm"
          >
            {isSubmitting ? "提交中..." : "确认跳过"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

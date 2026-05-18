import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import styles from "./RejectReasonModal.module.css";
import {
  REJECT_REASON_TYPE_LABELS,
  REJECT_REASON_TYPE_ORDER,
  type RejectReasonType,
} from "./rejectReasonTypes";

export interface RejectPayload {
  reason_type: RejectReasonType;
  reason?: string;
}

interface RejectReasonModalProps {
  open: boolean;
  count: number;
  onClose: () => void;
  onConfirm: (payload: RejectPayload) => void;
  // v0.8.8 · 当退回的是被标注员跳过的任务时，显示一行说明 + 预填补充文本
  skipReasonHint?: string | null;
}

export function RejectReasonModal({
  open,
  count,
  onClose,
  onConfirm,
  skipReasonHint,
}: RejectReasonModalProps) {
  const [reasonType, setReasonType] = useState<RejectReasonType>(
    REJECT_REASON_TYPE_ORDER[0],
  );
  const [comment, setComment] = useState(
    skipReasonHint ? `标注员跳过：${skipReasonHint}` : "",
  );

  // v0.10.16: reason_type 必填，自由文本 comment 可空
  const handleConfirm = () => {
    const text = comment.trim();
    onConfirm({
      reason_type: reasonType,
      reason: text.length > 0 ? text : undefined,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`退回原因（${count} 个任务）`}
      width={460}
    >
      <div className={styles.body}>
        {skipReasonHint && (
          <div
            data-testid="reject-skip-hint"
            className={styles.skipHint}
          >
            此任务被标注员跳过：<strong>{skipReasonHint}</strong>。退回后会重新派给其他标注员；
            如果该任务确实无可标注目标，建议改为「通过」。
          </div>
        )}
        {REJECT_REASON_TYPE_ORDER.map((t) => (
          <label
            key={t}
            className={`${styles.option} ${reasonType === t ? styles.optionSelected : ""}`}
            data-testid={`reject-type-${t}`}
          >
            <input
              type="radio"
              name="reject-reason-type"
              value={t}
              checked={reasonType === t}
              onChange={() => setReasonType(t)}
              className={styles.accentInput}
            />
            <span>{REJECT_REASON_TYPE_LABELS[t]}</span>
          </label>
        ))}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="（可选）补充说明，例如具体目标 / 帧号 …"
          rows={3}
          className={styles.textarea}
          data-testid="reject-comment"
        />
        <div className={styles.actions}>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            data-testid="reject-confirm"
          >
            确认退回
          </Button>
        </div>
      </div>
    </Modal>
  );
}

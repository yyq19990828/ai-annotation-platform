import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import styles from "./RejectReasonModal.module.css";

const PRESETS = [
  "类别错误",
  "漏标",
  "位置不准",
  "框过大或过小",
];

interface RejectReasonModalProps {
  open: boolean;
  count: number;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  // v0.8.8 · 当退回的是被标注员跳过的任务时，显示一行说明 + 在「其他」预填
  skipReasonHint?: string | null;
}

export function RejectReasonModal({
  open,
  count,
  onClose,
  onConfirm,
  skipReasonHint,
}: RejectReasonModalProps) {
  const [selected, setSelected] = useState<string>(
    skipReasonHint ? "其他" : PRESETS[0],
  );
  const [custom, setCustom] = useState(
    skipReasonHint ? `标注员跳过：${skipReasonHint}` : "",
  );

  const reason = selected === "其他" ? custom.trim() : selected;
  const canConfirm = reason.length > 0;

  const handleConfirm = () => {
    if (canConfirm) onConfirm(reason);
  };

  return (
    <Modal open={open} onClose={onClose} title={`退回原因（${count} 个任务）`} width={460}>
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
        {[...PRESETS, "其他"].map((p) => (
          <label
            key={p}
            className={`${styles.option} ${selected === p ? styles.optionSelected : ""}`}
          >
            <input
              type="radio"
              name="reject-reason"
              value={p}
              checked={selected === p}
              onChange={() => setSelected(p)}
              className={styles.accentInput}
            />
            <span>{p}</span>
          </label>
        ))}
        {selected === "其他" && (
          <textarea
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="自定义原因…"
            rows={3}
            className={styles.textarea}
          />
        )}
        <div className={styles.actions}>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            disabled={!canConfirm}
            data-testid="reject-confirm"
          >
            确认退回
          </Button>
        </div>
      </div>
    </Modal>
  );
}

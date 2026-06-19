import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
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
      <div className="flex flex-col gap-2.5">
        {skipReasonHint && (
          <div
            data-testid="reject-skip-hint"
            className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2.5 py-2 text-xs text-violet-600 dark:text-violet-400"
          >
            此任务被标注员跳过：<strong>{skipReasonHint}</strong>。退回后会重新派给其他标注员；
            如果该任务确实无可标注目标，建议改为「通过」。
          </div>
        )}
        {REJECT_REASON_TYPE_ORDER.map((t) => (
          <label
            key={t}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-[13px] ${
              reasonType === t
                ? "border-rose-500/40 bg-rose-500/10"
                : "border-border bg-transparent"
            }`}
            data-testid={`reject-type-${t}`}
          >
            <input
              type="radio"
              name="reject-reason-type"
              value={t}
              checked={reasonType === t}
              onChange={() => setReasonType(t)}
              className="cursor-pointer accent-rose-500"
            />
            <span>{REJECT_REASON_TYPE_LABELS[t]}</span>
          </label>
        ))}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="（可选）补充说明，例如具体目标 / 帧号 …"
          rows={3}
          className="w-full resize-y appearance-none rounded-md border border-border bg-card p-2 text-[13px] text-foreground [font:inherit]"
          data-testid="reject-comment"
        />
        <div className="mt-1.5 flex justify-end gap-2">
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

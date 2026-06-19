import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { BatchResponse } from "@/api/batches";

const REASON_MAX = 500;

const TEXTAREA_BASE =
  "min-h-[88px] resize-y appearance-none rounded-sm border border-border bg-background px-2.5 py-2 text-[13px] text-foreground [font:inherit]";

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
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="m-0 text-muted-foreground">
          锁定后，自动状态推进将被冻结，不再向该批次派发新任务。锁定原因将记录在审计日志中，并通知被分派的标注员 / 审核员。
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            锁定原因（必填，{trimmed.length}/{REASON_MAX}）
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="请说明锁定原因，例如：发现数据质量问题，暂停标注，待确认后解锁…"
            rows={4}
            className={`${TEXTAREA_BASE} ${tooLong ? "border-rose-500" : ""}`}
            autoFocus
          />
          {tooLong && (
            <span className="text-[11px] text-rose-600 dark:text-rose-400">
              超出 {REASON_MAX} 字上限
            </span>
          )}
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="danger"
            onClick={() => canSubmit && onSubmit(trimmed)}
            disabled={!canSubmit}
          >
            {pending ? "锁定中…" : "确认锁定"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

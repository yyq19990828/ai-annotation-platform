import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/components/ui/Toast";
import { useTransitionBatch } from "@/hooks/useBatches";
import type { BatchResponse } from "@/api/batches";

const REASON_MAX = 500;

const TEXTAREA_BASE =
  "min-h-[80px] resize-y appearance-none rounded-sm border border-border bg-background px-2.5 py-2 text-[13px] text-foreground [font:inherit]";

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
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="m-0 text-muted-foreground">{copy.description}</p>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            操作原因（必填 · {trimmed.length}/{REASON_MAX}） · 会写入审计日志
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="请简要说明操作原因（运维需要 / 误判修正 / …）"
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
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {transition.isPending ? "提交中…" : "确认"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

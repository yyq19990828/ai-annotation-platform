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

const REASON_MIN = 10;
const REASON_MAX = 500;

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
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
        <div
          style={{
            padding: 10,
            background: "color-mix(in oklab, var(--color-warning) 10%, transparent)",
            borderLeft: "3px solid var(--color-warning)",
            color: "var(--color-fg)",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <strong>这是 owner 兜底操作。</strong>批次将从 <code>{batch.status}</code> 强制回到 <code>draft</code>：
          <ul style={{ margin: "6px 0 0 16px", padding: 0, color: "var(--color-fg-muted)", fontSize: 12 }}>
            <li>批次内 <strong>{batch.total_tasks}</strong> 个 task 全部回 pending</li>
            <li>已有标注记录 <strong>保留</strong>（不删 annotation，不改 is_active）</li>
            <li>会 <strong>释放</strong> 所有标注员锁，原审核反馈 / 审核人会被清空</li>
          </ul>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
            重置原因（必填 · 至少 {REASON_MIN} 字 · {trimmed.length}/{REASON_MAX}） · 会写入审计日志
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="说明为什么要把批次回退到草稿（迁移错误数据 / 整体重做 / …）"
            rows={4}
            style={{
              padding: "8px 10px",
              border: `1px solid ${tooLong || tooShort ? "var(--color-danger)" : "var(--color-border)"}`,
              borderRadius: "var(--radius-sm)",
              fontSize: 13,
              fontFamily: "inherit",
              background: "var(--color-bg)",
              color: "var(--color-fg)",
              resize: "vertical",
              minHeight: 80,
            }}
            autoFocus
          />
          {tooShort && (
            <span style={{ fontSize: 11, color: "var(--color-danger)" }}>
              至少 {REASON_MIN} 字
            </span>
          )}
          {tooLong && (
            <span style={{ fontSize: 11, color: "var(--color-danger)" }}>
              超出 {REASON_MAX} 字上限
            </span>
          )}
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              background: canSubmit ? "var(--color-warning)" : undefined,
              color: canSubmit ? "#fff" : undefined,
            }}
          >
            {reset.isPending ? "重置中…" : "确认重置"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

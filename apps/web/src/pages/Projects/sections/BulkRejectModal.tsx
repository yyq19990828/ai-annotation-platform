import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

const FEEDBACK_MAX = 500;

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
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
        <p style={{ margin: 0, color: "var(--color-fg-muted)" }}>
          所选「审核中」批次将全部变为「已退回」，已提交质检 / 已通过的任务回退到待标注，标注内容保留。同一条反馈留言将发送给各批次的被分派标注员。
        </p>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
            驳回原因 / 留言（必填，{trimmed.length}/{FEEDBACK_MAX}）
          </span>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="请说明需要标注员重做的具体问题…"
            rows={5}
            style={{
              padding: "8px 10px",
              border: `1px solid ${tooLong ? "var(--color-danger)" : "var(--color-border)"}`,
              borderRadius: "var(--radius-sm)",
              fontSize: 13,
              fontFamily: "inherit",
              background: "var(--color-bg)",
              color: "var(--color-fg)",
              resize: "vertical",
              minHeight: 100,
            }}
            autoFocus
          />
          {tooLong && (
            <span style={{ fontSize: 11, color: "var(--color-danger)" }}>
              超出 {FEEDBACK_MAX} 字上限
            </span>
          )}
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button
            onClick={() => canSubmit && onSubmit(trimmed)}
            disabled={!canSubmit}
            style={{
              background: canSubmit ? "var(--color-danger)" : undefined,
              color: canSubmit ? "#fff" : undefined,
            }}
          >
            {pending ? "驳回中…" : `确认驳回 ${count} 个批次`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

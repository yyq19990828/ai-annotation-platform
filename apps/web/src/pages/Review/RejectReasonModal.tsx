import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

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
}

export function RejectReasonModal({ open, count, onClose, onConfirm }: RejectReasonModalProps) {
  const [selected, setSelected] = useState<string>(PRESETS[0]);
  const [custom, setCustom] = useState("");

  const reason = selected === "其他" ? custom.trim() : selected;
  const canConfirm = reason.length > 0;

  const handleConfirm = () => {
    if (canConfirm) onConfirm(reason);
  };

  return (
    <Modal open={open} onClose={onClose} title={`退回原因（${count} 个任务）`} width={460}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[...PRESETS, "其他"].map((p) => (
          <label
            key={p}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 10px", borderRadius: "var(--radius-md)",
              background: selected === p ? "var(--color-bg-sunken)" : "transparent",
              border: "1px solid " + (selected === p ? "var(--color-border-strong)" : "var(--color-border)"),
              cursor: "pointer", fontSize: 13,
            }}
          >
            <input
              type="radio"
              name="reject-reason"
              value={p}
              checked={selected === p}
              onChange={() => setSelected(p)}
              style={{ accentColor: "var(--color-accent)" }}
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
            style={{
              width: "100%", padding: 8, fontSize: 13,
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-bg-elev)",
              fontFamily: "inherit", resize: "vertical",
            }}
          />
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
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

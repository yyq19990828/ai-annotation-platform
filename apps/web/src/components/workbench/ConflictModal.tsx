import { Icon } from "@/components/ui/Icon";

interface ConflictModalProps {
  open: boolean;
  onReload: () => void;
  onOverwrite: () => void;
  onClose: () => void;
}

export function ConflictModal({ open, onReload, onOverwrite, onClose }: ConflictModalProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--color-bg-elev)",
          borderRadius: "var(--radius-lg)",
          padding: "24px 28px",
          minWidth: 360,
          maxWidth: 420,
          boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Icon name="warning" size={20} style={{ color: "oklch(0.65 0.18 55)" }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-fg)" }}>编辑冲突</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--color-fg-muted)", lineHeight: 1.55, margin: "0 0 20px" }}>
          该标注已被其他用户修改。你可以重载以获取最新数据，或强制覆盖对方的修改。
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "7px 16px",
              fontSize: 12.5,
              fontWeight: 500,
              background: "var(--color-bg-sunken)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              color: "var(--color-fg)",
              cursor: "pointer",
            }}
          >
            取消
          </button>
          <button
            onClick={onOverwrite}
            style={{
              padding: "7px 16px",
              fontSize: 12.5,
              fontWeight: 500,
              background: "oklch(0.60 0.18 35)",
              border: "none",
              borderRadius: "var(--radius-md)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            强制覆盖
          </button>
          <button
            onClick={onReload}
            style={{
              padding: "7px 16px",
              fontSize: 12.5,
              fontWeight: 600,
              background: "var(--color-accent)",
              border: "none",
              borderRadius: "var(--radius-md)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            重载（放弃本地）
          </button>
        </div>
      </div>
    </div>
  );
}

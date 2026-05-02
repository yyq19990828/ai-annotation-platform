import { create } from "zustand";
import { Icon } from "./Icon";

type ToastKind = "success" | "warning" | "error" | "";

interface ToastData {
  id: number;
  msg: string;
  sub?: string;
  kind?: ToastKind;
}

interface ToastStore {
  toasts: ToastData[];
  push: (toast: Omit<ToastData, "id">) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = Date.now() + Math.random();
    const ttl = toast.kind === "error" ? 6000 : toast.kind === "warning" ? 4500 : 3500;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttl);
  },
}));

export function ToastRack() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(40px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      <div
        data-toast-rack
        style={{
          position: "fixed",
          top: 60,
          right: 20,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 200,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => {
          const palette = paletteOf(t.kind);
          return (
          <div
            key={t.id}
            style={{
              pointerEvents: "auto",
              minWidth: 280,
              padding: "10px 14px",
              background: "var(--color-bg-elev)",
              border: `1px solid ${palette.border}`,
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-lg)",
              fontSize: 13,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              animation: "toastIn 0.18s ease-out",
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                flex: "0 0 18px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                background: palette.bg,
                color: palette.fg,
              }}
            >
              <Icon name={palette.icon} size={11} />
            </div>
            <div>
              <div style={{ flex: 1, lineHeight: 1.4 }}>{t.msg}</div>
              {t.sub && <div style={{ color: "var(--color-fg-muted)", fontSize: 12, marginTop: 2 }}>{t.sub}</div>}
            </div>
          </div>
          );
        })}
      </div>
    </>
  );
}

function paletteOf(kind: ToastKind | undefined) {
  switch (kind) {
    case "success":
      return {
        bg: "var(--color-success-soft)",
        fg: "var(--color-success)",
        border: "var(--color-border)",
        icon: "check" as const,
      };
    case "warning":
      return {
        bg: "var(--color-warning-soft, #fef3c7)",
        fg: "var(--color-warning, #b45309)",
        border: "var(--color-warning, #b45309)",
        icon: "warning" as const,
      };
    case "error":
      return {
        bg: "var(--color-danger-soft, #fee2e2)",
        fg: "var(--color-danger, #b91c1c)",
        border: "var(--color-danger, #b91c1c)",
        icon: "warning" as const,
      };
    default:
      return {
        bg: "var(--color-ai-soft)",
        fg: "var(--color-ai)",
        border: "var(--color-border)",
        icon: "sparkles" as const,
      };
  }
}

import { create } from "zustand";
import { Icon } from "./Icon";

interface ToastData {
  id: number;
  msg: string;
  sub?: string;
  kind?: "success" | "";
}

interface ToastStore {
  toasts: ToastData[];
  push: (toast: Omit<ToastData, "id">) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500);
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
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              pointerEvents: "auto",
              minWidth: 280,
              padding: "10px 14px",
              background: "var(--color-bg-elev)",
              border: "1px solid var(--color-border)",
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
                background: t.kind === "success" ? "var(--color-success-soft)" : "var(--color-ai-soft)",
                color: t.kind === "success" ? "var(--color-success)" : "var(--color-ai)",
              }}
            >
              <Icon name={t.kind === "success" ? "check" : "sparkles"} size={11} />
            </div>
            <div>
              <div style={{ flex: 1, lineHeight: 1.4 }}>{t.msg}</div>
              {t.sub && <div style={{ color: "var(--color-fg-muted)", fontSize: 12, marginTop: 2 }}>{t.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

import { create } from "zustand";
import { Icon } from "./Icon";
import styles from "./Toast.module.css";

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
    <div data-toast-rack className={styles.rack}>
        {toasts.map((t) => {
          const palette = paletteOf(t.kind);
          return (
          <div
            key={t.id}
            className={`${styles.toast} ${styles[palette.kind]}`}
          >
            <div className={styles.iconWrap}>
              <Icon name={palette.icon} size={11} />
            </div>
            <div>
              <div className={styles.message}>{t.msg}</div>
              {t.sub && <div className={styles.sub}>{t.sub}</div>}
            </div>
          </div>
          );
        })}
    </div>
  );
}

function paletteOf(kind: ToastKind | undefined) {
  switch (kind) {
    case "success":
      return {
        kind: "success",
        icon: "check" as const,
      };
    case "warning":
      return {
        kind: "warning",
        icon: "warning" as const,
      };
    case "error":
      return {
        kind: "error",
        icon: "warning" as const,
      };
    default:
      return {
        kind: "info",
        icon: "sparkles" as const,
      };
  }
}

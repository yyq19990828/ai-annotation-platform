import { create } from "zustand";
import { toast } from "sonner";

import { Toaster } from "@/components/shadcn/ui/sonner";

/**
 * Toast —— sonner 适配层(v0.17.2)。
 * 保留 `useToastStore.push({msg,sub?,kind?})` API(~104 调用点零改动),内部委托 sonner 的 toast()。
 * `ToastRack` 改为渲染 sonner `<Toaster/>`(已接 useTheme 主题),App.tsx 挂载点零改动。
 * 位置/配色对齐旧 rack:top-right + richColors(success/warning/error 语义色)。
 */
type ToastKind = "success" | "warning" | "error" | "";

interface ToastData {
  msg: string;
  sub?: string;
  kind?: ToastKind;
}

interface ToastStore {
  push: (toast: ToastData) => void;
}

export const useToastStore = create<ToastStore>(() => ({
  push: ({ msg, sub, kind }) => {
    const duration = kind === "error" ? 6000 : kind === "warning" ? 4500 : 3500;
    const opts = { description: sub, duration };
    if (kind === "success") toast.success(msg, opts);
    else if (kind === "warning") toast.warning(msg, opts);
    else if (kind === "error") toast.error(msg, opts);
    else toast(msg, opts);
  },
}));

export function ToastRack() {
  return <Toaster position="top-right" richColors />;
}

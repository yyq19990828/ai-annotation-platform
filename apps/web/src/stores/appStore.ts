import { create } from "zustand";

interface AppStore {
  workspace: string;
}

export const useAppStore = create<AppStore>(() => ({
  workspace: "智能业务部 · 生产环境",
}));

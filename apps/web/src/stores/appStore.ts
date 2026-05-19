import { create } from "zustand";

interface AppStore {
  workspace: string;
}

export const useAppStore = create<AppStore>(() => ({
  workspace: "默认工作区",
}));

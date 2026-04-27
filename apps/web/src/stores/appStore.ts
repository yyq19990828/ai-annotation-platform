import { create } from "zustand";
import type { PageKey } from "@/types";
import type { ProjectResponse } from "@/api/projects";

interface AppStore {
  page: PageKey;
  setPage: (page: PageKey) => void;
  currentProject: ProjectResponse | null;
  setCurrentProject: (p: ProjectResponse | null) => void;
  workspace: string;
}

export const useAppStore = create<AppStore>((set) => ({
  page: "dashboard",
  setPage: (page) => set({ page }),
  currentProject: null,
  setCurrentProject: (p) => set({ currentProject: p }),
  workspace: "智能业务部 · 生产环境",
}));

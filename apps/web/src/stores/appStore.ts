import { create } from "zustand";
import type { PageKey, Project } from "@/types";
import { projects as mockProjects } from "@/data/mock";

interface AppStore {
  page: PageKey;
  setPage: (page: PageKey) => void;
  currentProject: Project;
  setCurrentProject: (p: Project) => void;
  workspace: string;
}

export const useAppStore = create<AppStore>((set) => ({
  page: "dashboard",
  setPage: (page) => set({ page }),
  currentProject: mockProjects[0],
  setCurrentProject: (p) => set({ currentProject: p }),
  workspace: "智能业务部 · 生产环境",
}));

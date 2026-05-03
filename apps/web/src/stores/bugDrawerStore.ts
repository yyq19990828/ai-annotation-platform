import { create } from "zustand";

interface BugDrawerStore {
  open: boolean;
  focusBugId: string | null;
  openDrawer: (focusBugId?: string) => void;
  close: () => void;
}

export const useBugDrawerStore = create<BugDrawerStore>((set) => ({
  open: false,
  focusBugId: null,
  openDrawer: (focusBugId) => set({ open: true, focusBugId: focusBugId ?? null }),
  close: () => set({ open: false, focusBugId: null }),
}));

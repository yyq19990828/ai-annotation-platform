import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MeResponse } from "../api/auth";

interface AuthStore {
  token: string | null;
  user: MeResponse | null;
  setToken: (token: string) => void;
  setUser: (user: MeResponse) => void;
  setAuth: (token: string, user: MeResponse) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setToken: (token) => {
        localStorage.setItem("token", token);
        set({ token });
      },
      setUser: (user) => set({ user }),
      setAuth: (token, user) => {
        localStorage.setItem("token", token);
        set({ token, user });
      },
      logout: () => {
        localStorage.removeItem("token");
        set({ token: null, user: null });
      },
    }),
    { name: "auth-storage", partialize: (s) => ({ token: s.token, user: s.user }) },
  ),
);

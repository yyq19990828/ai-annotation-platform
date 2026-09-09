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

/** A second tab may replace shared credentials before this tab updates its UI. */
export function isCurrentAuthOwner(userId: string): boolean {
  const current = useAuthStore.getState();
  return (
    current.user?.id === userId &&
    !!current.token &&
    current.token === localStorage.getItem("token")
  );
}

/** Adopt the complete token/user pair written by another tab, without writing it back. */
export function bindAuthStorage(): () => void {
  const sync = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return;
    if (event.key !== null && event.key !== "token" && event.key !== "auth-storage") return;
    try {
      const stored = JSON.parse(localStorage.getItem("auth-storage") ?? "null");
      const token = localStorage.getItem("token");
      // Login writes its token before fetching the user. Wait for the complete
      // persisted identity; authenticated requests reject this intermediate pair.
      if ((stored?.state?.token ?? null) !== token) return;
      void useAuthStore.persist.rehydrate();
    } catch {
      // Malformed storage cannot be adopted as an authenticated identity.
    }
  };
  window.addEventListener("storage", sync);
  return () => window.removeEventListener("storage", sync);
}

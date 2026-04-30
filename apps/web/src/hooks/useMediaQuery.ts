import { useSyncExternalStore } from "react";

const subscribe = (query: string) => (notify: () => void) => {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(query);
  mql.addEventListener("change", notify);
  return () => mql.removeEventListener("change", notify);
};

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () => (typeof window !== "undefined" ? window.matchMedia(query).matches : false),
    () => false,
  );
}

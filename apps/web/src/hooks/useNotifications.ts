import { useQuery } from "@tanstack/react-query";
import { notificationsApi } from "../api/notifications";

const LAST_READ_KEY = "notifications_last_read";

export function getLastRead(): number {
  const v = localStorage.getItem(LAST_READ_KEY);
  return v ? parseInt(v, 10) : 0;
}

export function markAllRead() {
  localStorage.setItem(LAST_READ_KEY, String(Date.now()));
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationsApi.list(),
    refetchInterval: 30_000,
    retry: false,
  });
}

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/authStore";

/**
 * v0.6.9 · 单用户通知 WS：登录后挂载，订阅 /api/v1/ws/notifications。
 * 收到 push → 让 React Query 重新拉 list / unread-count。
 * WS 断线时 useNotifications 30s refetchInterval 会兜底。
 */
export function useNotificationSocket() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/v1/ws/notifications?token=${encodeURIComponent(token)}`;

    let ws: WebSocket | null = null;
    let closedManually = false;
    let retryTimer: number | null = null;
    let backoff = 1000;

    function connect() {
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleRetry();
        return;
      }
      ws.onopen = () => {
        backoff = 1000;
      };
      ws.onmessage = () => {
        // 简单策略：任何消息都让 list / unread-count 重新拉
        qc.invalidateQueries({ queryKey: ["notifications"] });
      };
      ws.onclose = () => {
        if (!closedManually) scheduleRetry();
      };
      ws.onerror = () => {
        try { ws?.close(); } catch { /* noop */ }
      };
    }

    function scheduleRetry() {
      if (closedManually) return;
      if (retryTimer) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    }

    connect();

    return () => {
      closedManually = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      try { ws?.close(); } catch { /* noop */ }
    };
  }, [token, qc]);
}

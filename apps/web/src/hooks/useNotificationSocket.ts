import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/authStore";
import { authApi } from "@/api/auth";

// v0.8.8 · WS 鉴权过期重连。
// 后端 /api/v1/ws/notifications 鉴权失败用 1008（policy violation）关闭。
// 标注员长会话（开着标注页面 24h+）token 过期后无需手动刷页：
//   1) onclose code 1008/4001 → 调 /auth/refresh 拿新 token
//   2) 成功 → 写 authStore + 用新 token 重连
//   3) 失败 → ApiError 401 → client.ts 已自动 logout，路由层会跳 /login
const REAUTH_CLOSE_CODES = new Set([1008, 4001]);

/**
 * v0.6.9 · 单用户通知 WS：登录后挂载，订阅 /api/v1/ws/notifications。
 * 收到 push → 让 React Query 重新拉 list / unread-count。
 * WS 断线时 useNotifications 30s refetchInterval 会兜底。
 *
 * v0.8.8 · 关闭码 1008/4001 时主动 refresh token + 重连，长会话不被踢。
 */
export function useNotificationSocket() {
  const token = useAuthStore((s) => s.token);
  const setToken = useAuthStore((s) => s.setToken);
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;

    let ws: WebSocket | null = null;
    let closedManually = false;
    let retryTimer: number | null = null;
    let backoff = 1000;
    // 已对当前过期 token 触发过 refresh，避免单次过期触发多次 /auth/refresh
    let refreshing = false;

    function currentToken(): string | null {
      return useAuthStore.getState().token;
    }

    function connect() {
      const t = currentToken();
      if (!t) return;

      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}/api/v1/ws/notifications?token=${encodeURIComponent(t)}`;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleRetry();
        return;
      }
      ws.onopen = () => {
        backoff = 1000;
        refreshing = false;
      };
      ws.onmessage = (e) => {
        // v0.7.0：服务端 30s 心跳 ping 帧不应触发 invalidate
        let parsed: { type?: string } | null = null;
        try {
          parsed = JSON.parse(e.data as string);
          if (parsed && parsed.type === "ping") return;
        } catch {
          // 非 JSON（理论不会出现），忽略
        }
        // v0.8.6 F6 · retry.* 进度事件触发失败预测列表 invalidate
        if (parsed?.type?.startsWith?.("failed_prediction.retry.")) {
          qc.invalidateQueries({ queryKey: ["admin", "failed-predictions"] });
        }
        qc.invalidateQueries({ queryKey: ["notifications"] });
      };
      ws.onclose = (event) => {
        if (closedManually) return;
        // v0.8.8 · 鉴权过期：尝试 refresh token 后再重连
        if (REAUTH_CLOSE_CODES.has(event.code) && !refreshing) {
          refreshing = true;
          authApi
            .refresh()
            .then((resp) => {
              setToken(resp.access_token);
              backoff = 1000;
              scheduleRetry();
            })
            .catch(() => {
              // refresh 失败 → client.ts 401 拦截已 logout → 不再 retry
              closedManually = true;
            });
          return;
        }
        scheduleRetry();
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
  }, [token, qc, setToken]);
}

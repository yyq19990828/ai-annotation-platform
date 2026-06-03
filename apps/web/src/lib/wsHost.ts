/**
 * v0.9.13 · WS host / URL helper.
 *
 * 收口 4 处 hook 重复的 host 拼接逻辑 (useNotificationSocket / useGlobalPreannotationJobs /
 * usePreannotation / PerfHud/useMLBackendStats):
 *
 *   const proto = window.location.protocol === "https:" ? "wss" : "ws";
 *   const host = import.meta.env.DEV ? "localhost:8000" : window.location.host;
 *   const url = `${proto}://${host}/ws/...?token=${encodeURIComponent(t)}`;
 *
 * dev 直连后端端口是为绕开 vite proxy `/ws` 在 4+ 并发 WS upgrade 时偶尔卡死 server.upgrade
 * 回调的已知问题 (vite 上游 issue 待提). production 走 nginx 反向代理 (相对 host).
 *
 * v0.13.3 · dev host 默认 localhost:8000,但多 worktree 并行时各分支后端端口不同
 * (如点云隔离栈 8010,与 HTTP 的 API_PROXY_TARGET 同源),用 `VITE_WS_HOST` 覆盖。
 */

export function getWsHost(): string {
  if (!import.meta.env.DEV) return window.location.host;
  return import.meta.env.VITE_WS_HOST || "localhost:8000";
}

export function getWsProtocol(): "ws" | "wss" {
  return window.location.protocol === "https:" ? "wss" : "ws";
}

/**
 * 拼一个完整 ws://host/path?k=v 的 URL.
 *
 * - path 必须以 "/" 开头 (例: "/ws/notifications").
 * - params 的值会被 encodeURIComponent.
 */
export function buildWsUrl(
  path: string,
  params?: Record<string, string | undefined | null>,
): string {
  const proto = getWsProtocol();
  const host = getWsHost();
  let url = `${proto}://${host}${path}`;
  if (params) {
    const qs: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      qs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    if (qs.length) url += (path.includes("?") ? "&" : "?") + qs.join("&");
  }
  return url;
}

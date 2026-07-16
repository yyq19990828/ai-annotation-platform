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
 * 本机 DEV 直连后端端口，绕开 vite proxy `/ws` 在多连接并发 upgrade 时的已知问题。
 * 远程 DEV 浏览器不能把 `localhost:8000` 当成平台主机，因此改走页面同源 Vite `/ws`
 * 代理。production 同样走页面同源反向代理。
 *
 * v0.13.3 · dev host 默认 localhost:8000,但多 worktree 并行时各分支后端端口不同
 * (如点云隔离栈 8010,与 HTTP 的 API_PROXY_TARGET 同源),用 `VITE_WS_HOST` 覆盖。
 */

type WsLocation = Pick<Location, "host" | "hostname">;

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

export function getWsHost(
  location: WsLocation = window.location,
  configuredHost: string | undefined = import.meta.env.VITE_WS_HOST,
): string {
  if (!import.meta.env.DEV) return window.location.host;
  if (configuredHost) return configuredHost;
  return isLoopbackHostname(location.hostname) ? "localhost:8000" : location.host;
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

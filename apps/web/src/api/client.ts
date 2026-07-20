import { recordApiDuration } from "./_metrics";

const BASE = "/api/v1";

class ApiError extends Error {
  /** 后端 detail 原文：可能是 string 或结构化对象（如 409 + {reason, pending_task_count, ...}）。 */
  detailRaw?: unknown;
  /** v0.9.3 · 选择性透传响应头（小写键），用于 LoginPage 读 X-Login-Failed-Count 等。 */
  headers?: Record<string, string>;

  constructor(
    public status: number,
    message: string,
    detailRaw?: unknown,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.detailRaw = detailRaw;
    this.headers = headers;
  }
}

/** v0.9.3 · 仅透传少数白名单响应头（避免序列化无关大头），按需扩展。 */
const EXPOSED_HEADERS = ["x-login-failed-count", "retry-after"] as const;

async function request<T>(path: string, init?: RequestInit, opts?: { anonymous?: boolean; silent?: boolean }): Promise<T> {
  const token = opts?.anonymous ? null : localStorage.getItem("token");
  // v0.10.18 · PerfHud 浏览器侧 API p95 指标; recordApiDuration 内部包 try/catch 不会抛.
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  try {
    recordApiDuration(performance.now() - t0);
  } catch {
    // 监控不影响业务
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const rawDetail: unknown = (body as { detail?: unknown })?.detail;
    const detail: string | undefined =
      typeof rawDetail === "string"
        ? rawDetail
        : rawDetail && typeof rawDetail === "object" && "message" in rawDetail
        ? String((rawDetail as { message?: unknown }).message ?? "")
        : undefined;

    if (res.status === 401 && !opts?.anonymous) {
      const { useAuthStore } = await import("../stores/authStore");
      useAuthStore.getState().logout();
    } else if (!opts?.anonymous && !opts?.silent && (res.status === 403 || res.status >= 500)) {
      const { useToastStore } = await import("../components/ui/Toast");
      if (res.status === 403) {
        useToastStore.getState().push({
          msg: detail || "没有权限执行该操作",
          kind: "warning",
        });
      } else {
        useToastStore.getState().push({
          msg: detail || "服务器错误，请稍后重试",
          sub: `HTTP ${res.status}`,
          kind: "error",
        });
      }
    }
    const exposedHeaders: Record<string, string> = {};
    for (const k of EXPOSED_HEADERS) {
      const v = res.headers.get(k);
      if (v != null) exposedHeaders[k] = v;
    }
    throw new ApiError(
      res.status,
      detail ?? res.statusText,
      rawDetail,
      Object.keys(exposedHeaders).length ? exposedHeaders : undefined,
    );
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  /**
   * 探测式 GET：不弹全局 toast（调用方自带错误展示，例如能力目录的黄色降级提示）。
   * 5xx/403 仍正常抛 ApiError；只是不重复弹通知。用于按 backend 批量探测的端点
   * （/capabilities / /setup），避免一个不可达容器触发 N 个堆叠 toast。
   */
  silentGet: <T>(path: string) => request<T>(path, undefined, { silent: true }),
  post: <T>(path: string, body?: unknown, extra?: RequestInit) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}), ...extra }),
  /** 探测式 POST：不弹全局 toast（见 silentGet 说明）。 */
  silentPost: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }, { silent: true }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown, extra?: RequestInit) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, body !== undefined
      ? { method: "DELETE", body: JSON.stringify(body) }
      : { method: "DELETE" }),
  /** 公开请求：不携带 Authorization；401 不触发全局 logout（用于 /auth/register 等公开端点）。 */
  publicGet: <T>(path: string) => request<T>(path, undefined, { anonymous: true }),
  publicPost: <T>(path: string, body?: unknown) =>
    request<T>(
      path,
      { method: "POST", body: JSON.stringify(body ?? {}) },
      { anonymous: true },
    ),
};

export { ApiError };

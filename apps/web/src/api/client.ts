const BASE = "/api/v1";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit, opts?: { anonymous?: boolean }): Promise<T> {
  const token = opts?.anonymous ? null : localStorage.getItem("token");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail: string | undefined = typeof body?.detail === "string" ? body.detail : undefined;

    if (res.status === 401 && !opts?.anonymous) {
      const { useAuthStore } = await import("../stores/authStore");
      useAuthStore.getState().logout();
    } else if (!opts?.anonymous && (res.status === 403 || res.status >= 500)) {
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
    throw new ApiError(res.status, detail ?? res.statusText);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
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

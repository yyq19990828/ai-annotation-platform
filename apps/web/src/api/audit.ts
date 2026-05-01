import { apiClient } from "./client";
import type { AuditLogOut, AuditLogList as AuditLogListGen } from "./generated/types.gen";

export type AuditLogResponse = AuditLogOut;
export type AuditLogList = AuditLogListGen;

export interface AuditQuery {
  page?: number;
  page_size?: number;
  action?: string;
  target_type?: string;
  target_id?: string;
  actor_id?: string;
  from?: string;
  to?: string;
  /** A.3：detail_json 字段级 GIN 过滤——键名 + 键值（仅 super_admin）。 */
  detail_key?: string;
  detail_value?: string;
}

function toQuery(params?: AuditQuery): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  const sp = new URLSearchParams(entries as [string, string][]);
  return `?${sp.toString()}`;
}

export const auditApi = {
  list: (params?: AuditQuery) =>
    apiClient.get<AuditLogList>(`/audit-logs${toQuery(params)}`),

  export: async (params?: AuditQuery, format: "csv" | "json" = "csv"): Promise<void> => {
    const token = localStorage.getItem("token");
    const q = toQuery({ ...params, format } as AuditQuery & { format: string });
    const res = await fetch(`/api/v1/audit-logs/export${q}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.detail ?? `导出失败 (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit_logs.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  },
};

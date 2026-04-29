import { apiClient } from "./client";

export interface AuditLogResponse {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  method: string | null;
  path: string | null;
  status_code: number | null;
  ip: string | null;
  detail_json: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditLogList {
  items: AuditLogResponse[];
  total: number;
  page: number;
  page_size: number;
}

export interface AuditQuery {
  page?: number;
  page_size?: number;
  action?: string;
  target_type?: string;
  actor_id?: string;
  from?: string;
  to?: string;
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
};

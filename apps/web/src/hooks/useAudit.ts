import { useQuery } from "@tanstack/react-query";
import { auditApi, type AuditQuery } from "../api/audit";

export function useAuditLogs(params?: AuditQuery, enabled = true) {
  return useQuery({
    queryKey: ["audit-logs", params],
    queryFn: () => auditApi.list(params),
    enabled,
  });
}

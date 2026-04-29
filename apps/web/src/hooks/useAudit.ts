import { useQuery } from "@tanstack/react-query";
import { auditApi, type AuditQuery } from "../api/audit";

export function useAuditLogs(params?: AuditQuery, options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ["audit-logs", params],
    queryFn: () => auditApi.list(params),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
  });
}

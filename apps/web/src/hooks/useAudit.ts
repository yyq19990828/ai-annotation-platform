import { useQuery } from "@tanstack/react-query";
import { auditApi, type AuditQuery } from "../api/audit";

export function useAuditLogs(
  params?: AuditQuery,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ["audit-logs", params],
    queryFn: () => auditApi.list(params),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
  });
}

export function useAuditMonthlySummary(month: string, businessOnly: boolean) {
  return useQuery({
    queryKey: ["audit-monthly-summary", month, businessOnly],
    queryFn: () => auditApi.monthlySummary(month, businessOnly),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
}

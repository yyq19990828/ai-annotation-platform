import { useQuery } from "@tanstack/react-query";
import { auditApi, type AuditQuery } from "../api/audit";
import { useAuthStore } from "@/stores/authStore";

export function useAuditLogs(
  params?: AuditQuery,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  const ownerId = useAuthStore((state) => state.user?.id);
  return useQuery({
    queryKey: ["audit-logs", ownerId, params],
    queryFn: ({ signal }) => auditApi.list(params, signal),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
  });
}

export function useAuditMonthlySummary(month: string, businessOnly: boolean) {
  const ownerId = useAuthStore((state) => state.user?.id);
  return useQuery({
    queryKey: ["audit-monthly-summary", ownerId, month, businessOnly],
    queryFn: ({ signal }) => auditApi.monthlySummary(month, businessOnly, signal),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
}

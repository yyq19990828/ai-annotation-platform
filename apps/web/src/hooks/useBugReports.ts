import { useQuery } from "@tanstack/react-query";
import { bugReportsApi, type BugReportListParams } from "@/api/bug-reports";
import { useAuthStore } from "@/stores/authStore";

export function useBugReports(params: BugReportListParams) {
  const ownerId = useAuthStore((state) => state.user?.id);
  return useQuery({
    queryKey: ["bug-reports", "list", ownerId, params],
    queryFn: ({ signal }) => bugReportsApi.list(params, signal),
  });
}

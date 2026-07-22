import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  maskQcApi,
  type MaskQcIssueStatus,
  type MaskQcSeverity,
  type MaskRepairAction,
} from "@/api/maskQc";

export function useMaskQcIssues(params: {
  projectId: string;
  taskId?: string;
  status?: MaskQcIssueStatus;
  severity?: MaskQcSeverity;
  code?: string;
}) {
  return useInfiniteQuery({
    queryKey: ["mask-qc-issues", params.projectId, params.taskId ?? null, params.status ?? null, params.severity ?? null, params.code ?? null],
    queryFn: ({ pageParam, signal }) => maskQcApi.issues(
      params.projectId,
      { ...params, cursor: pageParam ?? undefined },
      signal,
    ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: !!params.projectId,
    staleTime: 10_000,
  });
}

export function useTaskMaskQcSummary(taskId: string) {
  return useQuery({
    queryKey: ["mask-qc-summary", taskId],
    queryFn: ({ signal }) => maskQcApi.summary(taskId, signal),
    enabled: !!taskId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "running" ? 2_000 : false;
    },
  });
}

export function useRunTaskMaskQc(projectId: string, taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => maskQcApi.runTask(projectId, taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mask-qc-summary", taskId] });
      void queryClient.invalidateQueries({ queryKey: ["mask-qc-issues", projectId] });
    },
  });
}

export function usePatchMaskQcIssue(projectId: string, taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, status }: {
      issueId: string;
      status: "open" | "resolved" | "wont_fix";
    }) => maskQcApi.patchIssue(issueId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mask-qc-summary", taskId] });
      void queryClient.invalidateQueries({ queryKey: ["mask-qc-issues", projectId] });
    },
  });
}

export function useDryRunMaskRepairs(projectId: string) {
  return useMutation({
    mutationFn: (actions: MaskRepairAction[]) => maskQcApi.dryRunRepairs(projectId, actions),
  });
}

export function useExecuteMaskRepairs(projectId: string) {
  return useMutation({
    mutationFn: ({ receipt, planDigest }: { receipt: string; planDigest: string }) =>
      maskQcApi.executeRepairs(projectId, receipt, planDigest),
  });
}

export function useMaskRepairBatch(projectId: string, repairId: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["mask-repair", repairId],
    queryFn: ({ signal }) => maskQcApi.repairBatch(repairId!, signal),
    enabled: !!repairId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && ["completed", "partial", "failed", "cancelled", "rolled_back", "rollback_failed"].includes(status)) {
        void queryClient.invalidateQueries({ queryKey: ["mask-qc-issues", projectId] });
        return false;
      }
      return 1_500;
    },
  });
}

export function useRollbackMaskRepairs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repairId, resultDigest }: { repairId: string; resultDigest: string }) =>
      maskQcApi.rollbackRepairs(repairId, resultDigest),
    onSuccess: (batch) => {
      queryClient.setQueryData(["mask-repair", batch.id], batch);
      void queryClient.invalidateQueries({ queryKey: ["mask-repair", batch.id] });
    },
  });
}

export function useResumeMaskRepairs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repairId: string) => maskQcApi.resumeRepairs(repairId),
    onSuccess: (batch) => {
      queryClient.setQueryData(["mask-repair", batch.id], batch);
      void queryClient.invalidateQueries({ queryKey: ["mask-repair", batch.id] });
    },
  });
}

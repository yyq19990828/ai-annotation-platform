import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { maskQcApi, type MaskQcIssueStatus, type MaskQcSeverity } from "@/api/maskQc";

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

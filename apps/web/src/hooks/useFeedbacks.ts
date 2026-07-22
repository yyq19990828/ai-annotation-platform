/**
 * I18 · AnnotationFeedback React Query hooks.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  feedbacksApi,
  type AnnotationFeedback,
  type CreateFeedbackPayload,
  type ListFeedbacksParams,
  type PatchFeedbackPayload,
} from "@/api/feedbacks";

/** 列表查询 key — 缓存按 (project, task, annotation, filters) 维度. */
function feedbacksKey(params: ListFeedbacksParams) {
  return [
    "feedbacks",
    params.project_id,
    params.task_id ?? null,
    params.annotation_id ?? null,
    params.kind ?? null,
    params.anchor_type ?? null,
    params.status ?? null,
  ] as const;
}

export function useFeedbacks(params: ListFeedbacksParams, enabled = true) {
  return useQuery({
    queryKey: feedbacksKey(params),
    queryFn: ({ signal }) => feedbacksApi.list(params, signal),
    enabled: enabled && !!params.project_id,
    staleTime: 30 * 1000,
  });
}

export function useInfiniteFeedbacks(params: ListFeedbacksParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...feedbacksKey(params), "infinite", params.limit ?? 100],
    queryFn: ({ pageParam, signal }) => feedbacksApi.list(
      { ...params, cursor: pageParam ?? undefined },
      signal,
    ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: enabled && !!params.project_id,
    staleTime: 30 * 1000,
  });
}

export function useCreateFeedback(invalidateParams: ListFeedbacksParams) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateFeedbackPayload) => feedbacksApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedbacks", invalidateParams.project_id] });
    },
  });
}

export function usePatchFeedback(invalidateParams: ListFeedbacksParams) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PatchFeedbackPayload }) =>
      feedbacksApi.patch(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedbacks", invalidateParams.project_id] });
    },
  });
}

export function useDeleteFeedback(invalidateParams: ListFeedbacksParams) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => feedbacksApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedbacks", invalidateParams.project_id] });
    },
  });
}

export function useReplyFeedback(invalidateParams: ListFeedbacksParams) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body, attachments }: { id: string; body: string; attachments?: Array<Record<string, unknown>> }) =>
      feedbacksApi.reply(id, { body, attachments }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedbacks", invalidateParams.project_id] });
    },
  });
}

export type { AnnotationFeedback };

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commentsApi, type CreateCommentPayload } from "@/api/comments";

export function useAnnotationComments(annotationId: string | null | undefined) {
  return useQuery({
    queryKey: ["annotation-comments", annotationId],
    queryFn: () => commentsApi.listByAnnotation(annotationId!),
    enabled: !!annotationId,
  });
}

export function useCreateComment(annotationId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: string | CreateCommentPayload) => {
      if (!annotationId) throw new Error("No annotation selected");
      const body = typeof payload === "string" ? { body: payload } : payload;
      return commentsApi.create(annotationId, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotation-comments", annotationId] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function usePatchComment(annotationId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { body?: string; is_resolved?: boolean } }) =>
      commentsApi.patch(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotation-comments", annotationId] });
    },
  });
}

export function useDeleteComment(annotationId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => commentsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotation-comments", annotationId] });
    },
  });
}

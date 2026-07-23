import { useMemo } from "react";

import type { AnnotationPayload, AnnotationUpdatePayload } from "@/api/tasks";
import type { AnnotationResponse } from "@/types";

import { useAnnotationHistory, type HistoryHandlers } from "../../state/useAnnotationHistory";

interface CreateMutation {
  mutate: (
    payload: AnnotationPayload,
    options?: {
      onSuccess?: (created: AnnotationResponse) => void;
      onError?: (error: unknown) => void;
    },
  ) => void;
}

interface DeleteMutation {
  mutate: (
    annotationId: string,
    options?: {
      onSuccess?: () => void;
      onError?: (error: unknown) => void;
    },
  ) => void;
}

interface UpdateMutation {
  mutate: (
    args: { annotationId: string; payload: AnnotationUpdatePayload },
    options?: {
      onSuccess?: () => void;
      onError?: (error: unknown) => void;
    },
  ) => void;
}

export function useThreeDHistory(
  taskId: string | null,
  mutations: {
    createAnnotation: CreateMutation;
    deleteAnnotation: DeleteMutation;
    updateAnnotation: UpdateMutation;
  },
) {
  const handlers = useMemo<HistoryHandlers>(
    () => ({
      createAnnotation: (payload) =>
        new Promise((resolve, reject) => {
          mutations.createAnnotation.mutate(payload, {
            onSuccess: resolve,
            onError: reject,
          });
        }),
      deleteAnnotation: (annotationId) =>
        new Promise((resolve, reject) => {
          mutations.deleteAnnotation.mutate(annotationId, {
            onSuccess: () => resolve(undefined),
            onError: reject,
          });
        }),
      updateAnnotation: (annotationId, payload) =>
        new Promise((resolve, reject) => {
          mutations.updateAnnotation.mutate(
            { annotationId, payload },
            {
              onSuccess: () => resolve(undefined),
              onError: reject,
            },
          );
        }),
    }),
    [mutations.createAnnotation, mutations.deleteAnnotation, mutations.updateAnnotation],
  );

  return useAnnotationHistory(taskId ?? undefined, handlers);
}

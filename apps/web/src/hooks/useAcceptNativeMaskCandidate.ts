import { useCallback, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";

import {
  aiMasksApi,
  type AiMaskAcceptResponse,
  type AiMaskAcceptTarget,
} from "@/api/aiMasks";
import type { AnnotationResponse } from "@/types";
import type { AnnotationUpdatePayload } from "@/api/tasks";
import type { PendingMaskCandidate } from "@/pages/Workbench/state/useInteractiveAI";

interface AnnotationHistoryWriter {
  push: (command:
    | {
        kind: "acceptPrediction";
        predictionId: string;
        createdAnnotationIds: string[];
      }
    | {
        kind: "update";
        annotationId: string;
        before: AnnotationUpdatePayload;
        after: AnnotationUpdatePayload;
      }
  ) => void;
}

export interface AcceptNativeMaskCandidateInput {
  candidate: PendingMaskCandidate;
  className: string;
  target: AiMaskAcceptTarget;
}

/**
 * Shared image/video native-candidate accept boundary.
 *
 * The same idempotency key is single-flight in the browser. A failed request
 * throws without mutating candidate state; callers consume it only after this
 * function returns a server result.
 */
export function useAcceptNativeMaskCandidate(args: {
  taskId: string | undefined;
  queryClient: QueryClient;
  history: AnnotationHistoryWriter;
}) {
  const { taskId, queryClient, history } = args;
  const inFlightRef = useRef(new Set<string>());

  return useCallback(async ({
    candidate,
    className,
    target,
  }: AcceptNativeMaskCandidateInput): Promise<AiMaskAcceptResponse | undefined> => {
    if (!taskId || inFlightRef.current.has(candidate.idempotencyKey)) return undefined;
    inFlightRef.current.add(candidate.idempotencyKey);
    try {
      const sourceBefore = target.mode === "refine"
        ? queryClient
            .getQueryData<AnnotationResponse[]>(["annotations", taskId])
            ?.find((annotation) => annotation.id === target.source_annotation_id)
        : undefined;
      const accepted = await aiMasksApi.accept(taskId, {
        idempotency_key: candidate.idempotencyKey,
        candidate: {
          candidate: {
            type: "mask",
            value: { rle: candidate.rle, masklabels: [className] },
            score: candidate.score,
            candidate_id: candidate.candidateId,
          },
          candidate_index: candidate.candidateIndex,
          prompt_revision: candidate.promptRevision,
          receipt: candidate.receipt,
        },
        class_name: className,
        target,
        prompt_summary: candidate.promptSummary,
        routing: candidate.routing,
        inference: candidate.inference,
      });
      queryClient.setQueryData<AnnotationResponse[]>(
        ["annotations", taskId],
        (current) => {
          const existing = current ?? [];
          return existing.some((annotation) => annotation.id === accepted.annotation.id)
            ? existing.map((annotation) =>
                annotation.id === accepted.annotation.id ? accepted.annotation : annotation,
              )
            : [...existing, accepted.annotation];
        },
      );
      if (target.mode === "refine" && sourceBefore) {
        history.push({
          kind: "update",
          annotationId: accepted.annotation.id,
          before: { geometry: sourceBefore.geometry, class_name: sourceBefore.class_name },
          after: {
            geometry: accepted.annotation.geometry,
            class_name: accepted.annotation.class_name,
          },
        });
      } else if (target.mode === "create") {
        history.push({
          kind: "acceptPrediction",
          predictionId: accepted.prediction.id,
          createdAnnotationIds: [accepted.annotation.id],
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["predictions", taskId] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      return accepted;
    } finally {
      inFlightRef.current.delete(candidate.idempotencyKey);
    }
  }, [history, queryClient, taskId]);
}

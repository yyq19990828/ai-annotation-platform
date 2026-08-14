import type { AnnotationResponse, PredictionResponse } from "@/types";
import type { InteractiveInferenceLineage } from "./ml-backends";
import type { CocoRle } from "@/pages/Workbench/stage/shared/geometry/maskRle";
import { apiClient } from "./client";

export interface AiMaskAcceptCandidate {
  candidate: {
    type: "mask";
    value: { rle: CocoRle; masklabels: [string] };
    score: number | null;
    candidate_id: string;
  };
  candidate_index: number;
  prompt_revision: string;
  receipt: string;
}

export interface AiMaskPromptSummary {
  family: "point" | "interactive_box" | "exemplar" | "mask" | "scribble" | "correction_frame";
  positive_points: number;
  negative_points: number;
  boxes: number;
  positive_scribbles: number;
  negative_scribbles: number;
  multimask: boolean;
  parameters_digest?: string | null;
}

export interface AiMaskRoutingLineage {
  requested_backend_id: string;
  backend_pool_id: string | null;
  backend_instance_id: string;
  model_id: string;
}

export type AiMaskAcceptTarget =
  | { mode: "create"; frame_index?: number | null }
  | {
      mode: "refine";
      source_annotation_id: string;
      source_version: number;
      frame_index?: number | null;
    };

export interface AiMaskAcceptRequest {
  idempotency_key: string;
  candidate: AiMaskAcceptCandidate;
  class_name: string;
  video_segment_id?: string | null;
  target: AiMaskAcceptTarget;
  prompt_summary: AiMaskPromptSummary;
  routing: AiMaskRoutingLineage;
  inference: InteractiveInferenceLineage;
}

export interface AiMaskAcceptResponse {
  prediction: PredictionResponse;
  annotation: AnnotationResponse;
  source_version: number | null;
  result_version: number;
  content_digest: string;
  replayed: boolean;
}

export const aiMasksApi = {
  accept: (taskId: string, payload: AiMaskAcceptRequest) => {
    const expectedVersion = payload.target.mode === "refine" ? payload.target.source_version : null;
    return apiClient.post<AiMaskAcceptResponse>(
      `/tasks/${taskId}/ai-mask-candidates/accept`,
      payload,
      expectedVersion == null ? undefined : { headers: { "If-Match": `W/"${expectedVersion}"` } },
    );
  },
};

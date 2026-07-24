import type { AnnotationResponse } from "@/types";
import { apiClient } from "./client";

export type AnnotationConversionTarget = "mask" | "polygon" | "bbox";
export type AnnotationConversionOperation = "copy" | "replace";
export type AnnotationConversionScope = "image" | "current_frame" | "keyframes";

export interface AnnotationConversionDryRunRequest {
  annotation_ids: string[];
  target: AnnotationConversionTarget;
  operation: AnnotationConversionOperation;
  scope: AnnotationConversionScope;
  frame_index?: number | null;
  materialize_held?: boolean;
}

export interface AnnotationConversionItemReport {
  source_annotation_id: string;
  source_type: string;
  target_type: string;
  source_version: number;
  frame_indexes: number[];
  result_count: number;
  source_area_pixels: number;
  target_area_pixels: number;
  changed_pixels: number;
  source_components: number;
  target_components: number;
  source_holes: number;
  target_holes: number;
  source_vertices: number;
  target_vertices: number;
  materialized_held_frames: number;
  lossy: boolean;
  reasons: string[];
}

export interface AnnotationConversionSummary {
  source_count: number;
  result_count: number;
  materialized_held_frames: number;
  lossy_count: number;
}

export interface AnnotationConversionDryRunResponse {
  plan_token: string;
  expires_at: string;
  target: AnnotationConversionTarget;
  operation: AnnotationConversionOperation;
  scope: AnnotationConversionScope;
  items: AnnotationConversionItemReport[];
  summary: AnnotationConversionSummary;
}

export interface AnnotationConversionExecuteRequest {
  plan_token: string;
  idempotency_key: string;
  confirm_replace?: boolean;
  confirm_lossy?: boolean;
}

export interface AnnotationConversionExecuteResponse {
  operation_id: string;
  updated_annotations: AnnotationResponse[];
  created_annotations: AnnotationResponse[];
  deleted_annotation_ids: string[];
  lineage_edges: Array<{
    source_annotation_id: string | null;
    result_annotation_id: string | null;
    source_version: number | null;
    result_version: number | null;
    frame_index: number | null;
  }>;
  report: AnnotationConversionSummary;
  idempotent_replay: boolean;
}

export const annotationConversionsApi = {
  dryRun: (taskId: string, payload: AnnotationConversionDryRunRequest) =>
    apiClient.silentPost<AnnotationConversionDryRunResponse>(
      `/tasks/${taskId}/annotation-conversions:dry-run`,
      payload,
    ),
  execute: (taskId: string, payload: AnnotationConversionExecuteRequest) =>
    apiClient.silentPost<AnnotationConversionExecuteResponse>(
      `/tasks/${taskId}/annotation-conversions:execute`,
      payload,
    ),
};

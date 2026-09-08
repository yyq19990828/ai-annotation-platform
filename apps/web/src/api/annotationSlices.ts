import { apiClient } from "./client";

export interface PolygonSliceCommitRequest {
  annotation_id: string;
  expected_version: number;
  idempotency_key: string;
  cut_path: [number, number][];
}

export interface AnnotationSliceRestoreRequest {
  target: "before" | "after";
  expected_versions: Record<string, number>;
  idempotency_key: string;
}

export interface AnnotationSliceResponse {
  operation_id: string;
  slice_operation_id: string;
  source_annotation_id: string;
  created_annotation_id: string;
  result_versions: Record<string, number>;
  active_annotation_ids: string[];
  target: "before" | "after";
  restore_expires_at: string;
  idempotent_replay: boolean;
  no_op: boolean;
}

export const annotationSlicesApi = {
  commitPolygon: (taskId: string, payload: PolygonSliceCommitRequest) =>
    apiClient.silentPost<AnnotationSliceResponse>(
      `/tasks/${taskId}/annotations/polygon-slices:commit`,
      payload,
    ),
  restore: (taskId: string, operationId: string, payload: AnnotationSliceRestoreRequest) =>
    apiClient.silentPost<AnnotationSliceResponse>(
      `/tasks/${taskId}/annotations/slices/${operationId}:restore`,
      payload,
    ),
};

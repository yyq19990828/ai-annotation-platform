import type { RasterMaskGeometry, VideoTrackMaskGeometry } from "@/types";
import { apiClient } from "./client";

export type MaskMutationOperation =
  | "split_components"
  | "copy_component"
  | "copy_keyframe"
  | "join_masks"
  | "overlap";
export type MaskMutationGeometry = RasterMaskGeometry | VideoTrackMaskGeometry;

export interface MaskMutationScope {
  media: "image" | "video";
  frame_index: number | null;
  segment_id: string | null;
  instance_filter: "same_class" | "all";
  class_name: string | null;
  overlap_policy: "allow" | "erase_same_class" | "erase_all";
  strict_non_overlap: boolean;
}

export type MaskMutation =
  | { kind: "update"; annotation_id: string; geometry: MaskMutationGeometry }
  | { kind: "create"; source_annotation_ids: string[]; geometry: MaskMutationGeometry }
  | { kind: "delete"; annotation_id: string };

export interface MaskMutationReport {
  source_areas?: number[];
  result_areas?: number[];
  before_area?: number;
  after_area?: number;
  changed_pixels?: number;
  before_components?: number;
  after_components?: number;
  before_holes?: number;
  after_holes?: number;
  bounds?: [number, number, number, number] | null;
  connectivity?: 4 | 8;
  affected_annotations?: Array<{
    annotation_id: string;
    version: number;
    changed_pixels: number;
    unresolved?: boolean;
  }>;
}

export interface MaskMutationCommitRequest {
  idempotency_key: string;
  operation: MaskMutationOperation;
  scope: MaskMutationScope;
  source_frame_index?: number | null;
  scope_fingerprint: string;
  expected_versions: Array<{ annotation_id: string; version: number }>;
  mutations: MaskMutation[];
  report?: MaskMutationReport;
}

export interface MaskMutationCommitResponse {
  operation_id: string;
  updated_annotations: Array<{ id: string; version: number }>;
  created_annotations: Array<{ id: string; version: number }>;
  deleted_annotation_ids: string[];
  result_versions: Record<string, number>;
  lineage_edges: Array<{
    source_annotation_id: string | null;
    result_annotation_id: string | null;
    relation: string;
    source_version: number | null;
    result_version: number | null;
    frame_index: number | null;
  }>;
  before_digest: string;
  after_digest: string;
  audit_id: number;
  idempotent_replay: boolean;
}

export const maskMutationsApi = {
  commit: (taskId: string, payload: MaskMutationCommitRequest) =>
    apiClient.silentPost<MaskMutationCommitResponse>(
      `/tasks/${taskId}/annotations/mask-mutations:commit`,
      payload,
    ),
};

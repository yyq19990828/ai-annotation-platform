import { apiClient } from "./client";
import type { ExportOptions, ExportTarget } from "./projects";

export type MaskFormatLossClass = "lossless" | "lossy" | "unsupported";

export interface MaskFormatCode {
  code: string;
  message: string;
  detail: Record<string, unknown>;
}

export interface MaskFormatPlanItem {
  item_id: string;
  task_id: string | null;
  media_path: string | null;
  source_index: number | null;
  loss_class: MaskFormatLossClass;
  estimated_objects: number;
  estimated_files: number;
  estimated_bytes: number;
  losses: MaskFormatCode[];
  skips: MaskFormatCode[];
  warnings: MaskFormatCode[];
}

export interface MaskFormatPlan {
  format_id: string;
  direction: "import" | "export";
  adapter_version: string;
  manifest_version: string;
  media_type: string;
  loss_class: MaskFormatLossClass;
  staged_object_key: string | null;
  staged_sha256: string | null;
  mapping_digest: string;
  options_digest: string;
  items: MaskFormatPlanItem[];
  unknown_labels: string[];
  size_conflicts: Array<Record<string, unknown>>;
  overlap_conflicts: Array<Record<string, unknown>>;
  id_mapping: Record<string, unknown>;
  frame_mapping: Record<string, unknown>;
  estimated_objects: number;
  estimated_files: number;
  estimated_bytes: number;
  losses: MaskFormatCode[];
  skips: MaskFormatCode[];
  warnings: MaskFormatCode[];
  plan_digest: string;
}

export interface MaskFormatExportPreflight {
  plans: MaskFormatPlan[];
  loss_class: MaskFormatLossClass;
  estimated_objects: number;
  estimated_files: number;
  estimated_bytes: number;
  losses: MaskFormatCode[];
  warnings: MaskFormatCode[];
  preflight_digest: string;
}

export const maskFormatsApi = {
  preflightExport: (
    projectId: string,
    targets: ExportTarget[],
    opts?: ExportOptions,
  ) =>
    apiClient.post<MaskFormatExportPreflight>(
      `/projects/${projectId}/mask-formats/exports:preflight`,
      {
        targets,
        include_attributes: opts?.includeAttributes !== false,
        video_frame_mode: opts?.videoFrameMode ?? "keyframes",
        axis_frame: "iso",
        options: {},
      },
    ),
};

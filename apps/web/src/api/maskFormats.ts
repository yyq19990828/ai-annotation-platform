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

export interface MaskFormatCapability {
  supported: boolean;
  verified: boolean;
  enabled_for_ui: boolean;
}

export interface MaskFormatDescriptor {
  format_id: string;
  label: string;
  adapter_version: string;
  manifest_version: string;
  media_types: string[];
  import_capability: MaskFormatCapability;
  export_capability: MaskFormatCapability;
  option_schema: Record<string, unknown>;
}

export interface MaskFormatUploadInit {
  object_key: string;
  upload_url: string;
  expires_in: number;
}

export interface MaskFormatImportPreflight {
  import_id: string;
  receipt: string;
  receipt_expires_at: string;
  plan: MaskFormatPlan;
}

export interface MaskFormatImportBatch {
  id: string;
  project_id: string;
  async_job_id: string | null;
  format_id: string;
  status: string;
  result: Record<string, unknown>;
}

export const maskFormatsApi = {
  list: (projectId: string) =>
    apiClient.get<MaskFormatDescriptor[]>(`/projects/${projectId}/mask-formats`),
  initImportUpload: (projectId: string, file: File) =>
    apiClient.post<MaskFormatUploadInit>(
      `/projects/${projectId}/mask-formats/imports:upload-init`,
      {
        file_name: file.name,
        content_type: file.type || "application/octet-stream",
      },
    ),
  preflightImport: (
    projectId: string,
    body: {
      format_id: string;
      staged_object_key: string;
      staged_sha256: string;
      mapping: Record<string, unknown>;
      options: Record<string, unknown>;
    },
  ) =>
    apiClient.post<MaskFormatImportPreflight>(
      `/projects/${projectId}/mask-formats/imports:preflight`,
      body,
    ),
  executeImport: (
    projectId: string,
    receipt: string,
    planDigest: string,
    confirmLossy: boolean,
  ) =>
    apiClient.post<MaskFormatImportBatch>(
      `/projects/${projectId}/mask-formats/imports`,
      {
        receipt,
        plan_digest: planDigest,
        confirm_lossy: confirmLossy,
      },
    ),
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
        options: {
          ...(opts?.indexedOverlapPolicy
            ? { indexed_overlap_policy: opts.indexedOverlapPolicy }
            : {}),
          ...(opts?.videoOverlapPolicy
            ? { video_overlap_policy: opts.videoOverlapPolicy }
            : {}),
          ...(opts?.motsFrameBase !== undefined
            ? { mots_frame_base: opts.motsFrameBase }
            : {}),
        },
      },
    ),
};

import { apiClient } from "./client";
import type {
  ProjectOut,
  ProjectCreate,
  ProjectUpdate,
  ProjectStats,
  ProjectMemberOut,
  AttributeField as GenAttributeField,
  AttributeFieldOption as GenAttributeFieldOption,
  AttributeSchema as GenAttributeSchema,
  ClassConfigEntry as GenClassConfigEntry,
  ToolBinding as GenToolBinding,
  ToolClassEntry as GenToolClassEntry,
  VideoSamplingConfig as GenVideoSamplingConfig,
} from "./generated/types.gen";
import type { ToolUnitId } from "@/constants/toolUnits";

// ── 类型再导出（向后兼容旧 import 名） ─────────────────────────────
//
// v0.6.4 起后端 Pydantic JSONB 字段已结构化，OpenAPI codegen 直接出强类型，
// 不再需要 `Omit + 富类型` workaround。下面只是把生成出来的类型按旧导出
// 名重新导出，避免 30+ 调用方被迫一起改。

export type AttributeField = GenAttributeField;
export type AttributeFieldOption = GenAttributeFieldOption;
export type AttributeFieldType = GenAttributeField["type"];
export type AttributeSchema = GenAttributeSchema;
export type ClassConfigEntry = GenClassConfigEntry;
export type ClassesConfig = Record<string, ClassConfigEntry>;

// v0.10.29 · 项目级视频帧采样配置 (逻辑采样, 见 docs/plans/.../video-frame-sampling.md §2).
export type VideoSamplingConfig = GenVideoSamplingConfig;

// v0.10.17 · 工具维度类别 / 属性绑定. codegen 派生 dict<string, ToolBinding>, 这里
// 用 ToolUnitId Literal 收窄 key, 供前端编辑器强类型.
export type ToolClassEntry = GenToolClassEntry;
// v0.10.28 · keypoint 单元骨骼模板. 后端 ToolBinding.keypoint_schema 就位前, 前端先在
// 此处扩展可选字段贯通配置 UI ↔ 工作台渲染. 注意: 当前 codegen ToolBinding 无此字段,
// 故 PATCH 时后端会忽略 keypoint_schema (不落库) — 详见提交说明的「未竟部分」.
export type ToolBinding = GenToolBinding & {
  keypoint_schema?: import("@/types").KeypointSchema | null;
};
export type ToolBindings = Partial<Record<ToolUnitId, ToolBinding>>;

// v0.10.10 · I17.3 · ProjectRenderingConfig — 与后端 ProjectRenderingConfig 同形；
// 字段 = null/undefined 表示「项目不覆盖该字段」，沿用用户级 preferences。
export interface ProjectRenderingConfig {
  smoothImage?: boolean | null;
  cssImageFilter?: string | null;
  controlPointsSize?: number | null;
  snapToGrid?: boolean | null;
}

/** v0.6.4 起 ProjectOut 已强类型，ProjectResponse 仅作为旧导出名保留。 */
// v0.10.10 · 待 codegen 重跑前手动扩 rendering_config 字段。
export type ProjectResponse = ProjectOut & {
  rendering_config?: ProjectRenderingConfig;
};
export type ProjectStatsResponse = ProjectStats;
export type ProjectMemberResponse = ProjectMemberOut;
// v0.9.6 · codegen 旧版 ProjectCreate 缺 text_output_default; 手动扩到 codegen 重跑.
// v0.9.7 · 加 ml_backend_source_id (Wizard step 4 复用全局 backend), 同样待 codegen 重跑.
// v0.10.11 · 加 source_project_id (从已有项目复制配置), 同样待 codegen 重跑.
export type ProjectCreatePayload = ProjectCreate & {
  text_output_default?: "box" | "mask" | "both" | null;
  ml_backend_source_id?: string | null;
  source_project_id?: string | null;
  // v0.10.13 · E1 · 同时复制源项目 annotation_guide + guide_assets (storage key 共享).
  copy_annotation_guide?: boolean;
  // v0.10.14 · E2 · 从 ProjectTemplate 应用模板创建项目; 与 source_project_id 互斥.
  template_id?: string | null;
};
// v0.10.10 · I17.3 · 加 rendering_config 字段；待 codegen 重跑。
// v0.10.13 · E1 · 加 annotation_guide / guide_assets; 待 codegen 重跑。
export type ProjectUpdatePayload = ProjectUpdate & {
  rendering_config?: ProjectRenderingConfig | null;
  annotation_guide?: string | null;
  guide_assets?: GuideAssetEntry[] | null;
};

// v0.10.13 · E1 · 项目标注指引图片资源 entry, 与后端 guide_asset.py 同构.
export interface GuideAssetEntry {
  key: string;
  original_name: string;
  content_type: string;
  size: number;
  uploaded_at: string;
}

export interface GuideAssetUploadInitResponse {
  key: string;
  upload_url: string;
  expires_in: number;
}

export interface GuideAssetSignedUrlResponse {
  url: string;
  expires_in: number;
}

// v0.10.31 · Phase 4.7 · 视频项目导出格式 video_json/mot/kitti（aap_json 图像视频共用）。
export type ExportFormat = "coco" | "voc" | "yolo" | "aap_json" | "video_json" | "mot" | "kitti";
export type VideoFrameMode = "keyframes" | "all_frames";
export interface ExportOptions {
  includeAttributes?: boolean;
  videoFrameMode?: VideoFrameMode;
}

export interface ProjectListParams {
  status?: string;
  search?: string;
  /** v0.7.2 · 高级筛选 */
  type_key?: string[];
  /** v0.10.28 · 媒体维度筛选 (image / video / lidar) */
  data_type?: string[];
  member_id?: string;
  created_from?: string;
  created_to?: string;
}

export const projectsApi = {
  list: (params?: ProjectListParams) => {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      if (Array.isArray(v)) {
        v.forEach((vi) => q.append(k, String(vi)));
      } else {
        q.append(k, String(v));
      }
    });
    const qs = q.toString();
    return apiClient.get<ProjectResponse[]>(`/projects${qs ? `?${qs}` : ""}`);
  },

  stats: () => apiClient.get<ProjectStatsResponse>("/projects/stats"),

  get: (id: string) => apiClient.get<ProjectResponse>(`/projects/${id}`),

  create: (payload: ProjectCreatePayload) =>
    apiClient.post<ProjectResponse>("/projects", payload),

  update: (id: string, payload: ProjectUpdatePayload) =>
    apiClient.patch<ProjectResponse>(`/projects/${id}`, payload),

  remove: (id: string) => apiClient.delete<void>(`/projects/${id}`),

  transfer: (id: string, new_owner_id: string) =>
    apiClient.post<ProjectResponse>(`/projects/${id}/transfer`, { new_owner_id }),

  // B-13 · 重命名类别 (后端原子更新 classes / classes_config / annotations.class_name)
  // v0.10.17 · 加可选 tool_unit_id 限定工具单位; 不传时跨所有 unit 同名一起改 (兼容旧客户端).
  renameClass: (
    id: string,
    old_name: string,
    new_name: string,
    tool_unit_id?: string,
  ) =>
    apiClient.post<ProjectResponse>(`/projects/${id}/classes/rename`, {
      old_name,
      new_name,
      ...(tool_unit_id ? { tool_unit_id } : {}),
    }),

  listMembers: (id: string) =>
    apiClient.get<ProjectMemberResponse[]>(`/projects/${id}/members`),

  addMember: (id: string, payload: { user_id: string; role: "annotator" | "reviewer" }) =>
    apiClient.post<ProjectMemberResponse>(`/projects/${id}/members`, payload),

  removeMember: (id: string, memberId: string) =>
    apiClient.delete<void>(`/projects/${id}/members/${memberId}`),

  // v0.6.7 二修 B-10：清理无源 task（v0.6.0~v0.6.6 期间 link 留下的孤儿）
  previewOrphanTasks: (id: string) =>
    apiClient.get<{ orphan_tasks: number; orphan_annotations: number }>(`/projects/${id}/orphan-tasks/preview`),
  cleanupOrphanTasks: (id: string) =>
    apiClient.post<{ deleted_tasks: number; deleted_annotations: number }>(`/projects/${id}/orphan-tasks/cleanup`),

  // v0.10.13 · E1 · 标注指引图片资源
  guideAssets: {
    uploadInit: (projectId: string, payload: { filename: string; content_type: string; size: number }) =>
      apiClient.post<GuideAssetUploadInitResponse>(
        `/projects/${projectId}/guide-assets/upload-init`,
        payload,
      ),
    uploadComplete: (
      projectId: string,
      payload: { key: string; original_name: string; content_type: string },
    ) =>
      apiClient.post<GuideAssetEntry>(
        `/projects/${projectId}/guide-assets/upload-complete`,
        payload,
      ),
    remove: (projectId: string, key: string) =>
      apiClient.delete<{ deleted: string }>(
        `/projects/${projectId}/guide-assets?key=${encodeURIComponent(key)}`,
      ),
    signUrl: (projectId: string, key: string) =>
      apiClient.get<GuideAssetSignedUrlResponse>(
        `/projects/${projectId}/guide-assets/sign-url?key=${encodeURIComponent(key)}`,
      ),
  },

  // v0.10.27 · 导出异步化：POST 创建 async_job(kind=export)，返回 {job_id}。
  // 不再直接 blob 下载；产物完成后在 JobsBell 里用预签名 URL 下载。
  exportProject: (id: string, format: ExportFormat, opts?: ExportOptions) => {
    const includeAttr = opts?.includeAttributes !== false;
    const params = new URLSearchParams({ format, include_attributes: String(includeAttr) });
    if (opts?.videoFrameMode) params.set("video_frame_mode", opts.videoFrameMode);
    return apiClient.post<{ job_id: string }>(
      `/projects/${id}/export?${params.toString()}`,
    );
  },
};

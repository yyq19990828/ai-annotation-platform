// v0.10.14 · E2 · ProjectTemplate API 客户端.
//
// 列表 / 创建 / 详情 / 更新 / 删除 / 克隆.
// 与后端 apps/api/app/api/v1/project_templates.py 路由对齐.

import { apiClient } from "./client";
import type {
  AttributeSchema,
  ClassesConfig,
  ProjectRenderingConfig,
} from "./projects";

export type TemplateScope = "private" | "organization" | "public";

export interface ProjectTemplateOut {
  id: string;
  display_id: string;
  name: string;
  description: string | null;
  type_label: string;
  type_key: string;

  classes: string[];
  classes_config: ClassesConfig;
  attribute_schema: AttributeSchema;
  label_config: Record<string, unknown>;
  ai_enabled: boolean;
  ai_model: string | null;
  sampling: string;
  maximum_annotations: number;
  show_overlap_first: boolean;
  iou_dedup_threshold: number;
  box_threshold: number;
  text_threshold: number;
  text_output_default: "box" | "mask" | "both" | null;
  rendering_config: ProjectRenderingConfig;
  annotation_guide: string | null;

  scope: TemplateScope;
  organization_id: string | null;
  created_by: string;
  created_by_name: string | null;
  source_project_id: string | null;
  usage_count: number;

  created_at: string;
  updated_at: string;
}

export interface ProjectTemplateCreatePayload {
  name: string;
  description?: string | null;
  type_label: string;
  type_key: string;
  classes?: string[];
  classes_config?: ClassesConfig | null;
  attribute_schema?: AttributeSchema | null;
  label_config?: Record<string, unknown> | null;
  ai_enabled?: boolean;
  ai_model?: string | null;
  sampling?: string;
  maximum_annotations?: number;
  show_overlap_first?: boolean;
  iou_dedup_threshold?: number;
  box_threshold?: number;
  text_threshold?: number;
  text_output_default?: "box" | "mask" | "both" | null;
  rendering_config?: ProjectRenderingConfig | null;
  annotation_guide?: string | null;
  scope?: TemplateScope;
  organization_id?: string | null;
  source_project_id?: string | null;
}

export type ProjectTemplateUpdatePayload = Partial<
  Omit<ProjectTemplateCreatePayload, "type_label" | "type_key" | "source_project_id">
> & {
  type_label?: string;
  type_key?: string;
};

export interface ProjectTemplateListParams {
  scope?: TemplateScope;
  type_key?: string[];
  search?: string;
}

export const projectTemplatesApi = {
  list: (params?: ProjectTemplateListParams) => {
    const q = new URLSearchParams();
    if (params?.scope) q.set("scope", params.scope);
    if (params?.search) q.set("search", params.search);
    if (params?.type_key && params.type_key.length > 0) {
      params.type_key.forEach((tk) => q.append("type_key", tk));
    }
    const qs = q.toString();
    return apiClient.get<ProjectTemplateOut[]>(
      `/project-templates${qs ? `?${qs}` : ""}`,
    );
  },

  get: (id: string) => apiClient.get<ProjectTemplateOut>(`/project-templates/${id}`),

  create: (payload: ProjectTemplateCreatePayload) =>
    apiClient.post<ProjectTemplateOut>("/project-templates", payload),

  update: (id: string, payload: ProjectTemplateUpdatePayload) =>
    apiClient.patch<ProjectTemplateOut>(`/project-templates/${id}`, payload),

  remove: (id: string) => apiClient.delete<void>(`/project-templates/${id}`),

  duplicate: (id: string) =>
    apiClient.post<ProjectTemplateOut>(`/project-templates/${id}/duplicate`),
};

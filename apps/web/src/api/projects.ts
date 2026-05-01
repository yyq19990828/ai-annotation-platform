import { apiClient } from "./client";
import type { ProjectOut } from "./generated/types.gen";

// ── attribute schema DSL ───────────────────────────────────────────────────

export type AttributeFieldType = "text" | "number" | "boolean" | "select" | "multiselect" | "range";

export interface AttributeFieldOption {
  value: string;
  label: string;
}

export interface AttributeField {
  key: string;
  label: string;
  type: AttributeFieldType;
  required?: boolean;
  default?: unknown;
  options?: AttributeFieldOption[];
  min?: number;
  max?: number;
  regex?: string;
  /** "*" = 全局；string[] = 仅这些 class 显示。 */
  applies_to?: "*" | string[];
  /** 简单条件级联：当 other_key 等于该值时才显示。 */
  visible_if?: { key: string; equals: unknown };
  /** 数字键 1-9，仅 boolean / select 字段。选中标注后按下切换该属性。 */
  hotkey?: string;
  /** 字段说明 / 标注规范提示。AttributeForm 在 label 旁渲染 info 图标，hover 弹出。 */
  description?: string;
}

export interface AttributeSchema {
  fields: AttributeField[];
}

export interface ClassConfigEntry {
  color?: string;
  order?: number;
}

export type ClassesConfig = Record<string, ClassConfigEntry>;

/** 与后端 ProjectOut schema 对应（snake_case）。
 *  基于 generated `ProjectOut`，把弱类型字段（classes / classes_config / attribute_schema）
 *  收紧为前端 DSL 的强类型；其余字段自动跟随后端 schema 演进。 */
export type ProjectResponse = Omit<
  ProjectOut,
  "classes" | "classes_config" | "attribute_schema"
> & {
  classes: string[];
  classes_config: ClassesConfig;
  attribute_schema: AttributeSchema;
};

export interface ProjectStatsResponse {
  total_data: number;
  completed: number;
  ai_rate: number;
  pending_review: number;
}

export interface ProjectCreatePayload {
  name: string;
  type_label: string;
  type_key: string;
  classes?: string[];
  ai_enabled?: boolean;
  ai_model?: string | null;
  due_date?: string | null;
}

export interface ProjectUpdatePayload {
  name?: string;
  type_label?: string;
  type_key?: string;
  status?: string;
  classes?: string[];
  classes_config?: ClassesConfig;
  attribute_schema?: AttributeSchema;
  ai_enabled?: boolean;
  ai_model?: string | null;
  due_date?: string | null;
  sampling?: string;
  maximum_annotations?: number;
  show_overlap_first?: boolean;
  iou_dedup_threshold?: number;
}

export interface ProjectMemberResponse {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role: "annotator" | "reviewer";
  assigned_at: string;
}

export type ExportFormat = "coco" | "voc" | "yolo";

export const projectsApi = {
  list: (params?: { status?: string; search?: string }) => {
    const q = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params ?? {}).filter(([, v]) => v !== undefined),
      ) as Record<string, string>,
    ).toString();
    return apiClient.get<ProjectResponse[]>(`/projects${q ? `?${q}` : ""}`);
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

  listMembers: (id: string) =>
    apiClient.get<ProjectMemberResponse[]>(`/projects/${id}/members`),

  addMember: (id: string, payload: { user_id: string; role: "annotator" | "reviewer" }) =>
    apiClient.post<ProjectMemberResponse>(`/projects/${id}/members`, payload),

  removeMember: (id: string, memberId: string) =>
    apiClient.delete<void>(`/projects/${id}/members/${memberId}`),

  exportProject: async (id: string, format: ExportFormat, opts?: { includeAttributes?: boolean }) => {
    const token = localStorage.getItem("token");
    const includeAttr = opts?.includeAttributes !== false; // 默认携带
    const params = new URLSearchParams({ format, include_attributes: String(includeAttr) });
    const res = await fetch(`/api/v1/projects/${id}/export?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = disposition.match(/filename=(.+)/);
    const filename = match ? match[1] : `export.${format === "coco" ? "json" : "zip"}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};

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
} from "./generated/types.gen";

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

/** v0.6.4 起 ProjectOut 已强类型，ProjectResponse 仅作为旧导出名保留。 */
export type ProjectResponse = ProjectOut;
export type ProjectStatsResponse = ProjectStats;
export type ProjectMemberResponse = ProjectMemberOut;
export type ProjectCreatePayload = ProjectCreate;
export type ProjectUpdatePayload = ProjectUpdate;

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
    const includeAttr = opts?.includeAttributes !== false;
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

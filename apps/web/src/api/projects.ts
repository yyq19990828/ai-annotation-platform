import { apiClient } from "./client";

/** 与后端 ProjectOut schema 对应（snake_case） */
export interface ProjectResponse {
  id: string;
  display_id: string;
  name: string;
  type_label: string;
  type_key: string;
  owner_id: string;
  owner_name: string | null;
  member_count: number;
  status: string;
  ai_enabled: boolean;
  ai_model: string | null;
  classes: string[];
  total_tasks: number;
  completed_tasks: number;
  review_tasks: number;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

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
  ai_enabled?: boolean;
  ai_model?: string | null;
  due_date?: string | null;
  sampling?: string;
  maximum_annotations?: number;
  show_overlap_first?: boolean;
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

  exportProject: async (id: string, format: ExportFormat) => {
    const token = localStorage.getItem("token");
    const res = await fetch(`/api/v1/projects/${id}/export?format=${format}`, {
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

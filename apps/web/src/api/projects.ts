import { apiClient } from "./client";

/** 与后端 ProjectOut schema 对应（snake_case） */
export interface ProjectResponse {
  id: string;
  display_id: string;
  name: string;
  type_label: string;
  type_key: string;
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

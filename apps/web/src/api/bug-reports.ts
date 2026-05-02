import { apiClient } from "./client";

export interface BugReportPayload {
  title: string;
  description: string;
  severity?: "low" | "medium" | "high" | "critical";
  route?: string;
  browser_ua?: string;
  viewport?: string;
  project_id?: string;
  task_id?: string;
  recent_api_calls?: Array<{ method: string; url: string; status: number; ms: number }>;
  recent_console_errors?: Array<{ msg: string; stack?: string }>;
  screenshot_url?: string | null;
}

export interface BugReportResponse {
  id: string;
  display_id: string;
  reporter_id: string;
  route: string;
  user_role: string;
  project_id: string | null;
  task_id: string | null;
  title: string;
  description: string;
  severity: string;
  status: string;
  duplicate_of_id: string | null;
  browser_ua: string | null;
  viewport: string | null;
  recent_api_calls: unknown;
  recent_console_errors: unknown;
  screenshot_url: string | null;
  resolution: string | null;
  fixed_in_version: string | null;
  assigned_to_id: string | null;
  created_at: string;
  triaged_at: string | null;
  fixed_at: string | null;
}

export interface BugReportDetail extends BugReportResponse {
  comments: BugCommentResponse[];
}

export interface BugCommentResponse {
  id: string;
  bug_report_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface BugReportListResponse {
  items: BugReportResponse[];
  total: number;
}

export interface BugReportUpdatePayload {
  status?: string;
  severity?: string;
  title?: string;
  description?: string;
  duplicate_of_id?: string;
  assigned_to_id?: string;
  fixed_in_version?: string;
  resolution?: string;
}

export const bugReportsApi = {
  create: (payload: BugReportPayload) =>
    apiClient.post<BugReportResponse>("/bug_reports", payload),

  list: (params?: { status?: string; severity?: string; route?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.severity) q.set("severity", params.severity);
    if (params?.route) q.set("route", params.route);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    return apiClient.get<BugReportListResponse>(`/bug_reports?${q}`);
  },

  listMine: (limit = 50, offset = 0) =>
    apiClient.get<BugReportListResponse>(`/bug_reports/mine?limit=${limit}&offset=${offset}`),

  get: (id: string) =>
    apiClient.get<BugReportDetail>(`/bug_reports/${id}`),

  update: (id: string, payload: BugReportUpdatePayload) =>
    apiClient.patch<BugReportResponse>(`/bug_reports/${id}`, payload),

  delete: (id: string) =>
    apiClient.delete<void>(`/bug_reports/${id}`),

  addComment: (id: string, body: string) =>
    apiClient.post<BugCommentResponse>(`/bug_reports/${id}/comments`, { body }),

  // v0.6.6 · 截图上传 init：签发 PUT URL，前端再调 PUT 真正上传
  initScreenshotUpload: (file_name = "screenshot.png", content_type = "image/png") =>
    apiClient.post<{ storage_key: string; upload_url: string; expires_in: number }>(
      "/bug_reports/screenshot/upload-init",
      { file_name, content_type },
    ),
};

/** 高阶：先 init 拿 PUT URL，再前端 fetch PUT 上传，返回 storage_key */
export async function uploadBugScreenshot(blob: Blob): Promise<string> {
  const init = await bugReportsApi.initScreenshotUpload();
  const res = await fetch(init.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: blob,
  });
  if (!res.ok) throw new Error(`上传失败 (${res.status})`);
  return init.storage_key;
}

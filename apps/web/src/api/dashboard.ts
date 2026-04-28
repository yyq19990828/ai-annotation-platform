import { apiClient } from "./client";

export interface AdminDashboardStats {
  total_users: number;
  active_users: number;
  total_projects: number;
  projects_in_progress: number;
  projects_completed: number;
  projects_pending_review: number;
  projects_archived: number;
  total_tasks: number;
  total_annotations: number;
  ml_backends_total: number;
  ml_backends_connected: number;
  role_distribution: Record<string, number>;
}

export interface ReviewTaskItem {
  task_id: string;
  task_display_id: string;
  file_name: string;
  project_id: string;
  project_name: string;
  total_annotations: number;
  total_predictions: number;
  updated_at: string | null;
}

export interface ReviewerDashboardStats {
  pending_review_count: number;
  today_reviewed: number;
  approval_rate: number;
  total_reviewed: number;
  pending_tasks: ReviewTaskItem[];
}

export interface AnnotatorDashboardStats {
  assigned_tasks: number;
  today_completed: number;
  weekly_completed: number;
  total_completed: number;
  personal_accuracy: number;
  daily_counts: number[];
}

export const dashboardApi = {
  getAdminStats: () => apiClient.get<AdminDashboardStats>("/dashboard/admin"),
  getReviewerStats: () => apiClient.get<ReviewerDashboardStats>("/dashboard/reviewer"),
  getAnnotatorStats: () => apiClient.get<AnnotatorDashboardStats>("/dashboard/annotator"),
};

import { apiClient } from "./client";
import type { UserBrief } from "@/types";

export interface RegistrationDayPoint {
  date: string;
  invite_count: number;
  open_count: number;
}

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
  registration_by_day?: RegistrationDayPoint[];
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

export interface ReviewingBatchItem {
  batch_id: string;
  batch_display_id: string;
  batch_name: string;
  project_id: string;
  project_name: string;
  total_tasks: number;
  review_tasks: number;
  completed_tasks: number;
  /** v0.7.2 · 这批的标注员（单值；让 reviewer 知道是谁标的） */
  annotator: UserBrief | null;
}

export interface ReviewerDashboardStats {
  pending_review_count: number;
  today_reviewed: number;
  approval_rate: number;
  approval_rate_24h: number;
  total_reviewed: number;
  pending_tasks: ReviewTaskItem[];
  reviewing_batches?: ReviewingBatchItem[];
}

export interface RecentReviewItem {
  task_id: string;
  task_display_id: string;
  file_name: string;
  project_id: string;
  project_name: string;
  status: string;
  reviewed_at: string | null;
}

export interface AnnotatorDashboardStats {
  assigned_tasks: number;
  today_completed: number;
  weekly_completed: number;
  total_completed: number;
  personal_accuracy: number;
  daily_counts: number[];
}

export interface MyBatchItem {
  batch_id: string;
  batch_display_id: string;
  batch_name: string;
  project_id: string;
  project_name: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  review_tasks: number;
  approved_tasks: number;
  rejected_tasks: number;
  progress_pct: number;
  review_feedback: string | null;
  reviewed_at: string | null;
  /** v0.7.2 · 这批的审核员（单值；让标注员知道谁会审） */
  reviewer: UserBrief | null;
}

export const dashboardApi = {
  getAdminStats: () => apiClient.get<AdminDashboardStats>("/dashboard/admin"),
  getReviewerStats: () => apiClient.get<ReviewerDashboardStats>("/dashboard/reviewer"),
  getAnnotatorStats: () => apiClient.get<AnnotatorDashboardStats>("/dashboard/annotator"),
  getMyBatches: () => apiClient.get<MyBatchItem[]>("/dashboard/annotator/batches"),
  getMyRecentReviews: (limit = 20) =>
    apiClient.get<RecentReviewItem[]>(`/dashboard/me/recent-reviews?limit=${limit}`),
};

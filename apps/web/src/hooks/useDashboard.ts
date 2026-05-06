import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard";

export function useAdminStats() {
  return useQuery({
    queryKey: ["dashboard", "admin"],
    queryFn: dashboardApi.getAdminStats,
  });
}

export function useReviewerStats() {
  return useQuery({
    queryKey: ["dashboard", "reviewer"],
    queryFn: dashboardApi.getReviewerStats,
  });
}

export function useAnnotatorStats() {
  return useQuery({
    queryKey: ["dashboard", "annotator"],
    queryFn: dashboardApi.getAnnotatorStats,
  });
}

export function useMyBatches() {
  return useQuery({
    queryKey: ["dashboard", "annotator", "batches"],
    queryFn: dashboardApi.getMyBatches,
  });
}

export function useMyRecentReviews(limit = 20) {
  return useQuery({
    queryKey: ["dashboard", "me-recent-reviews", limit],
    queryFn: () => dashboardApi.getMyRecentReviews(limit),
  });
}

// v0.8.4 · 管理员人员看板
export function useAdminPeople(params: {
  role?: string;
  project?: string;
  period?: string;
  sort?: string;
  q?: string;
}) {
  return useQuery({
    queryKey: ["dashboard", "admin", "people", params],
    queryFn: () => dashboardApi.getAdminPeople(params),
  });
}

export function useAdminPersonDetail(userId: string | null, period: string = "4w") {
  return useQuery({
    queryKey: ["dashboard", "admin", "people", "detail", userId, period],
    queryFn: () => dashboardApi.getAdminPersonDetail(userId!, period),
    enabled: Boolean(userId),
  });
}

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

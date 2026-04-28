import type { UserRole, ProjectStatus, TaskStatus } from "@/types";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "超级管理员",
  project_admin: "项目管理员",
  reviewer: "质检员",
  annotator: "标注员",
  viewer: "观察者",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  in_progress: "进行中",
  completed: "已完成",
  pending_review: "待审核",
  archived: "已归档",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  uploading: "上传中",
  pending: "待标注",
  in_progress: "标注中",
  completed: "已完成",
  review: "待审核",
};

import type { UserRole, ProjectStatus, TaskStatus } from "@/types";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "超级管理员",
  project_admin: "项目管理员",
  reviewer: "质检员",
  annotator: "标注员",
  viewer: "观察者",
};

export const ROLE_DESC: Record<UserRole, string> = {
  super_admin: "全局权限，可访问所有功能、审计日志和系统设置",
  project_admin: "创建并管理项目，邀请成员，查看报表，配置 AI 模型",
  reviewer: "质检复核，判定通过 / 驳回，导出样本",
  annotator: "执行标注任务，提交质检",
  viewer: "只读浏览项目数据与标注结果",
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

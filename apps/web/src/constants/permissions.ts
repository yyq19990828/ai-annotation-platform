import type { UserRole, PageKey } from "@/types";

export const ROLE_PAGE_ACCESS: Record<UserRole, PageKey[]> = {
  super_admin: ["dashboard", "annotate", "review", "users", "datasets", "storage", "ai-pre", "model-market", "training", "audit", "settings"],
  project_admin: ["dashboard", "annotate", "review", "users", "datasets", "storage", "ai-pre", "model-market", "training", "settings"],
  reviewer: ["dashboard", "review", "datasets"],
  annotator: ["dashboard", "annotate"],
  viewer: ["dashboard", "datasets"],
};

export type Permission =
  | "project.create"
  | "project.edit"
  | "project.delete"
  | "project.export"
  | "task.assign"
  | "task.annotate"
  | "task.review"
  | "task.approve"
  | "task.reject"
  | "user.list"
  | "user.invite"
  | "user.edit-role"
  | "dataset.create"
  | "dataset.delete"
  | "dataset.link"
  | "storage.manage"
  | "audit.view"
  | "settings.edit"
  | "ai.trigger"
  | "ml-backend.manage";

const ALL_PERMISSIONS: Permission[] = [
  "project.create", "project.edit", "project.delete", "project.export",
  "task.assign", "task.annotate", "task.review", "task.approve", "task.reject",
  "user.list", "user.invite", "user.edit-role",
  "dataset.create", "dataset.delete", "dataset.link",
  "storage.manage", "audit.view", "settings.edit",
  "ai.trigger", "ml-backend.manage",
];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: ALL_PERMISSIONS,
  project_admin: [
    "project.create", "project.edit", "project.export",
    "task.assign", "task.annotate", "task.review", "task.approve", "task.reject",
    "user.list", "user.invite",
    "dataset.create", "dataset.delete", "dataset.link",
    "ai.trigger", "ml-backend.manage",
  ],
  reviewer: ["task.review", "task.approve", "task.reject", "project.export"],
  annotator: ["task.annotate"],
  viewer: [],
};

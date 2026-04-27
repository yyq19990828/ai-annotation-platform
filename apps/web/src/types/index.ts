export interface Project {
  id: string;
  displayId: string;
  name: string;
  type: string;
  typeKey: ProjectTypeKey;
  owner: string;
  ownerInitial: string;
  members: number;
  total: number;
  done: number;
  review: number;
  pending: number;
  ai: boolean;
  aiModel: string | null;
  classes: string[];
  updated: string;
  status: ProjectStatus;
  due: string;
}

export type ProjectTypeKey =
  | "image-det"
  | "image-seg"
  | "image-kp"
  | "lidar"
  | "video-mm"
  | "video-track"
  | "mm";

export type ProjectStatus = "进行中" | "已完成" | "待审核";

export interface TaskImage {
  id: string;
  name: string;
  tags: string[];
  assignee: string;
  aiBoxes: AIBox[];
}

export interface AIBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cls: string;
  conf: number;
}

export interface Annotation extends AIBox {
  source: "human" | "ai" | "ai-accepted";
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  group: string;
  status: "在线" | "离线" | "忙碌";
  tasks: number;
  accuracy: number | null;
  joined: string;
  initial: string;
}

export interface Role {
  key: string;
  desc: string;
  count: number;
  perms: string[];
}

export type PageKey =
  | "dashboard"
  | "annotate"
  | "users"
  | "datasets"
  | "storage"
  | "ai-pre"
  | "model-market"
  | "training"
  | "audit"
  | "settings";

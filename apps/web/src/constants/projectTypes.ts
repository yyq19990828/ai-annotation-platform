import type { IconName } from "@/components/ui/Icon";

export interface ProjectTypeOption {
  key: string;
  label: string;
  icon: IconName;
  hint: string;
}

/** 与 DashboardPage TYPE_ICONS 对齐，新增项请同步 */
export const PROJECT_TYPES: ReadonlyArray<ProjectTypeOption> = [
  { key: "image-det", label: "图像 · 目标检测", icon: "rect", hint: "矩形框圈选物体" },
  { key: "image-seg", label: "图像 · 实例分割", icon: "polygon", hint: "多边形/掩码分割" },
  { key: "image-kp", label: "图像 · 关键点", icon: "point", hint: "关键点定位" },
  { key: "lidar", label: "3D 点云 · 立体框", icon: "cube", hint: "激光点云立体框" },
  { key: "video-mm", label: "视频 · 多模态", icon: "video", hint: "视频帧 + 多模态标签" },
  { key: "video-track", label: "视频 · 时序追踪", icon: "video", hint: "跨帧目标追踪" },
  { key: "mm", label: "多模态 · 图文对", icon: "mm", hint: "图文匹配/描述" },
];

export const PRESET_AI_MODELS: ReadonlyArray<string> = [
  "YOLO v8",
  "GroundingDINO + SAM",
  "SAM-HQ",
  "GPT-4V",
  "Qwen2-VL",
  "PointPillars",
];

export const CUSTOM_MODEL_KEY = "__custom__";

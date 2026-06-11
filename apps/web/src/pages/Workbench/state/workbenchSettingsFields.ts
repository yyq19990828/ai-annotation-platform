// v0.15.3 · 工作台设置字段注册表(单一来源):工作台设置抽屉与 Settings 页「标注偏好」
// 共用本数组渲染,杜绝两处 UI 漂移。新增字段流程:后端子树加字段 → auth.ts 类型同步 →
// 这里加一行 → 消费点读配置。
import type { WorkbenchPreferences } from "@/api/auth";
import type { LockableField, WorkbenchConfigPatch } from "./useWorkbenchConfig";

export type WorkbenchSettingCategory = "common" | "image" | "video" | "pointcloud";

export type WorkbenchSettingValue = boolean | number | string;

export type WorkbenchSettingControl =
  | { type: "toggle"; onText?: string; offText?: string }
  | { type: "slider"; min: number; max: number; step: number; format?: (v: number) => string }
  | { type: "select"; options: Array<{ value: string; label: string }> }
  | { type: "text"; maxLength: number; placeholder?: string };

export interface WorkbenchSettingField {
  /** "image.controlPointsSize" — 与 WorkbenchPreferences 子树路径一致(category.字段名)。 */
  key: `${WorkbenchSettingCategory}.${string}`;
  category: WorkbenchSettingCategory;
  label: string;
  description?: string;
  control: WorkbenchSettingControl;
  /** 是否参与项目锁定(ProjectRenderingConfig 平铺同名字段可覆盖,v0.10.10)。 */
  lockable?: boolean;
  /** 注册但不渲染。v0.15.3 红线:不新增用户可感知项(snapToGrid 现状无设置 UI)。 */
  hidden?: boolean;
}

export const WORKBENCH_SETTING_CATEGORY_LABELS: Record<WorkbenchSettingCategory, string> = {
  common: "通用",
  image: "图片",
  video: "视频",
  pointcloud: "点云",
};

export const WORKBENCH_SETTING_FIELDS: WorkbenchSettingField[] = [
  {
    key: "common.longTaskSampleRate",
    category: "common",
    label: "性能采样率",
    description: "PerformanceObserver longtask 采样率，0–1",
    control: { type: "slider", min: 0, max: 1, step: 0.05, format: (v) => v.toFixed(2) },
  },
  {
    key: "image.smoothImage",
    category: "image",
    label: "图像平滑",
    description: "关闭后像素清晰，适合医学影像 / 像素艺术",
    control: {
      type: "toggle",
      onText: "已开启 — 默认双线性插值",
      offText: "已关闭 — 像素 nearest-neighbor",
    },
    lockable: true,
  },
  {
    key: "image.cssImageFilter",
    category: "image",
    label: "CSS 图像滤镜",
    description: "例：brightness(1.2) contrast(1.1) invert(0)；留空恢复原图",
    control: { type: "text", maxLength: 255, placeholder: "brightness(1.2) contrast(1.1)" },
    lockable: true,
  },
  {
    key: "image.controlPointsSize",
    category: "image",
    label: "控制点大小",
    description: "顶点拖拽手柄半径",
    control: { type: "slider", min: 2, max: 20, step: 1, format: (v) => `${v}px` },
    lockable: true,
  },
  {
    key: "image.snapToGrid",
    category: "image",
    label: "网格吸附",
    control: { type: "toggle" },
    lockable: true,
    // 现状只有项目级覆盖入口,用户侧无 UI;本版不新增可感知项,先注册不渲染。
    hidden: true,
  },
];

/** 按 key 的子树路径从配置中取当前值。 */
export function getFieldValue(
  config: WorkbenchPreferences,
  field: WorkbenchSettingField,
): WorkbenchSettingValue {
  const name = field.key.slice(field.category.length + 1);
  return (config[field.category] as Record<string, WorkbenchSettingValue>)[name];
}

/** 把单字段新值包装成子树级 patch(useWorkbenchConfig.update / setFields 入参)。 */
export function buildFieldPatch(
  field: WorkbenchSettingField,
  value: WorkbenchSettingValue,
): WorkbenchConfigPatch {
  const name = field.key.slice(field.category.length + 1);
  return { [field.category]: { [name]: value } } as WorkbenchConfigPatch;
}

/** lockable 字段对应的 LockableField 名(平铺命名,与 lockedFields 比对);非 lockable 返回 null。 */
export function lockableFieldName(field: WorkbenchSettingField): LockableField | null {
  if (!field.lockable) return null;
  return field.key.slice(field.category.length + 1) as LockableField;
}

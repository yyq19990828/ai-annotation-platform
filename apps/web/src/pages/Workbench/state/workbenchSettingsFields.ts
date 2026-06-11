// v0.15.3 · 工作台设置字段注册表(单一来源):工作台设置抽屉与 Settings 页「标注偏好」
// 共用本数组渲染,杜绝两处 UI 漂移。新增字段流程:后端子树加字段 → auth.ts 类型同步 →
// 这里加一行 → 消费点读配置。
import type { WorkbenchPreferences } from "@/api/auth";
import { WEBCODECS_FLAG_STORAGE_KEY } from "../stage/useVideoChunkDecoder";
import type { LockableField, WorkbenchConfigPatch } from "./useWorkbenchConfig";

export type WorkbenchPreferenceSettingCategory = "common" | "image" | "video" | "pointcloud";
export type WorkbenchSettingCategory = WorkbenchPreferenceSettingCategory | "experiment";

export type WorkbenchSettingValue = boolean | number | string;

export type WorkbenchSettingControl =
  | { type: "toggle"; onText?: string; offText?: string }
  | { type: "slider"; min: number; max: number; step: number; format?: (v: number) => string }
  | { type: "select"; options: Array<{ value: WorkbenchSettingValue; label: string }> }
  | { type: "text"; maxLength: number; placeholder?: string };

interface WorkbenchSettingFieldBase {
  /** "image.controlPointsSize" — 与 WorkbenchPreferences 子树路径一致(category.字段名)。 */
  key: `${WorkbenchSettingCategory}.${string}`;
  category: WorkbenchSettingCategory;
  label: string;
  description?: string;
  control: WorkbenchSettingControl;
  /** 注册但不渲染。v0.15.3 红线:不新增用户可感知项(snapToGrid 现状无设置 UI)。 */
  hidden?: boolean;
}

export interface WorkbenchPreferenceSettingField extends WorkbenchSettingFieldBase {
  key: `${WorkbenchPreferenceSettingCategory}.${string}`;
  category: WorkbenchPreferenceSettingCategory;
  storage?: "preferences";
  /** 是否参与项目锁定(ProjectRenderingConfig 平铺同名字段可覆盖,v0.10.10)。 */
  lockable?: boolean;
}

export interface WorkbenchLocalSettingField extends WorkbenchSettingFieldBase {
  key: `experiment.${string}`;
  category: "experiment";
  storage: "local";
  read: () => WorkbenchSettingValue;
  write: (value: WorkbenchSettingValue) => void;
}

export type WorkbenchSettingField =
  | WorkbenchPreferenceSettingField
  | WorkbenchLocalSettingField;

export const WORKBENCH_SETTING_CATEGORY_LABELS: Record<WorkbenchSettingCategory, string> = {
  common: "通用",
  image: "图片",
  video: "视频",
  pointcloud: "点云",
  experiment: "实验特性",
};

function readLocalBoolean(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

function writeLocalBoolean(key: string, value: WorkbenchSettingValue): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* local device flag is best-effort */
  }
}

export const WORKBENCH_SETTING_FIELDS: WorkbenchSettingField[] = [
  {
    key: "common.longTaskSampleRate",
    category: "common",
    label: "性能采样率",
    description: "PerformanceObserver longtask 采样率，0–1",
    control: { type: "slider", min: 0, max: 1, step: 0.05, format: (v) => v.toFixed(2) },
  },
  {
    key: "common.confirmDelete",
    category: "common",
    label: "删除确认",
    control: {
      type: "select",
      options: [
        { value: "never", label: "不确认" },
        { value: "multi_only", label: "仅多选确认" },
        { value: "always", label: "始终确认" },
      ],
    },
  },
  {
    key: "common.recentClassesLimit",
    category: "common",
    label: "最近类别数量",
    control: { type: "slider", min: 3, max: 20, step: 1, format: (v) => `${v}` },
  },
  {
    key: "common.crossFrameOverlayK",
    category: "common",
    label: "邻帧叠加",
    description: "前后各显示几帧参考框，0 为关闭",
    control: {
      type: "select",
      options: [
        { value: 0, label: "关闭" },
        { value: 1, label: "前后 1 帧" },
        { value: 3, label: "前后 3 帧" },
        { value: 5, label: "前后 5 帧" },
        { value: 7, label: "前后 7 帧" },
      ],
    },
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
    key: "image.autoFitOnResize",
    category: "image",
    label: "自动适应大小",
    description: "展开或收起边栏后自动让图片重新适应画布",
    control: { type: "toggle", onText: "已开启", offText: "已关闭" },
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
  {
    key: "image.afterBoxCreate",
    category: "image",
    label: "画框后行为",
    control: {
      type: "select",
      options: [
        { value: "pick_class", label: "选择类别" },
        { value: "reuse_active", label: "沿用当前类别" },
      ],
    },
  },
  {
    key: "image.snapThresholdPx",
    category: "image",
    label: "吸附阈值",
    control: { type: "slider", min: 4, max: 16, step: 1, format: (v) => `${v}px` },
  },
  {
    key: "image.zoomStepFactor",
    category: "image",
    label: "滚轮缩放步长",
    control: {
      type: "select",
      options: [
        { value: 1.05, label: "5%" },
        { value: 1.1, label: "10%" },
        { value: 1.15, label: "15%" },
        { value: 1.2, label: "20%" },
      ],
    },
  },
  {
    key: "image.fadedOpacity",
    category: "image",
    label: "淡化透明度",
    control: { type: "slider", min: 0.1, max: 0.8, step: 0.05, format: (v) => v.toFixed(2) },
  },
  {
    key: "image.showBoxLabels",
    category: "image",
    label: "显示框标签",
    control: { type: "toggle" },
  },
  {
    key: "image.maskOverlayOpacity",
    category: "image",
    label: "Mask 覆盖透明度",
    control: { type: "slider", min: 0.2, max: 0.8, step: 0.05, format: (v) => v.toFixed(2) },
  },
  {
    key: "video.defaultPlaybackRate",
    category: "video",
    label: "默认播放速率",
    description: "打开视频任务时的初始播放速率",
    control: {
      type: "select",
      options: [
        { value: 0.25, label: "0.25x" },
        { value: 0.5, label: "0.5x" },
        { value: 1, label: "1x" },
        { value: 2, label: "2x" },
        { value: 4, label: "4x" },
      ],
    },
  },
  {
    key: "video.largeFrameStep",
    category: "video",
    label: "大步进帧数",
    description: "时间轴聚焦时 Shift+←/→ 使用",
    control: {
      type: "select",
      options: [
        { value: 5, label: "5 帧" },
        { value: 10, label: "10 帧" },
        { value: 30, label: "30 帧" },
        { value: "grid", label: "采样网格" },
      ],
    },
  },
  {
    key: "pointcloud.pointSize",
    category: "pointcloud",
    label: "点大小",
    description: "点云渲染点径",
    control: { type: "slider", min: 0.01, max: 0.3, step: 0.01, format: (v) => v.toFixed(2) },
  },
  {
    key: "pointcloud.persistCameraView",
    category: "pointcloud",
    label: "持久化 3D 视角",
    description: "记住点云主视角，下次打开时恢复上次相机位置",
    control: { type: "toggle", onText: "已开启", offText: "已关闭" },
  },
  {
    key: "pointcloud.colorizeWithCamera",
    category: "pointcloud",
    label: "相机上色",
    description: "用标定相机图像给点云采样 RGB",
    control: { type: "toggle", onText: "已开启", offText: "已关闭" },
  },
  {
    key: "pointcloud.colorizeContrast",
    category: "pointcloud",
    label: "上色对比度",
    description: "相机上色后的 RGB 对比度",
    control: { type: "slider", min: 0.5, max: 2.5, step: 0.05, format: (v) => v.toFixed(2) },
  },
  {
    key: "pointcloud.colorizeBrightness",
    category: "pointcloud",
    label: "上色亮度",
    description: "相机上色后的 RGB 亮度偏移",
    control: { type: "slider", min: -0.5, max: 0.5, step: 0.05, format: (v) => v.toFixed(2) },
  },
  {
    key: "pointcloud.colorizeGamma",
    category: "pointcloud",
    label: "上色 Gamma",
    description: "相机上色后的中间调曲线",
    control: { type: "slider", min: 0.5, max: 3, step: 0.05, format: (v) => v.toFixed(2) },
  },
  {
    key: "pointcloud.showDepthHint",
    category: "pointcloud",
    label: "深度提示",
    description: "相机视图显示深度热力与悬停距离",
    control: { type: "toggle", onText: "已开启", offText: "已关闭" },
  },
  {
    key: "pointcloud.pointMaskSelectMode",
    category: "pointcloud",
    label: "点选模式",
    control: {
      type: "select",
      options: [
        { value: "rect", label: "矩形" },
        { value: "lasso", label: "套索" },
        { value: "polygon", label: "多边形" },
      ],
    },
  },
  {
    key: "pointcloud.showGrid",
    category: "pointcloud",
    label: "显示地面网格",
    control: { type: "toggle" },
  },
  {
    key: "pointcloud.showAxisGizmo",
    category: "pointcloud",
    label: "显示坐标轴",
    control: { type: "toggle" },
  },
  {
    key: "pointcloud.cameraDamping",
    category: "pointcloud",
    label: "相机灵敏度",
    description: "值越小惯性越强",
    control: { type: "slider", min: 0.05, max: 0.3, step: 0.05, format: (v) => v.toFixed(2) },
  },
  {
    key: "experiment.webcodecs",
    category: "experiment",
    storage: "local",
    label: "WebCodecs 精确解码",
    description: "实验性,刷新后生效",
    control: { type: "toggle" },
    read: () => readLocalBoolean(WEBCODECS_FLAG_STORAGE_KEY),
    write: (value) => writeLocalBoolean(WEBCODECS_FLAG_STORAGE_KEY, value),
  },
];

export function isLocalSettingField(
  field: WorkbenchSettingField,
): field is WorkbenchLocalSettingField {
  return field.storage === "local";
}

/** 按 key 的子树路径从配置中取当前值。 */
export function getFieldValue(
  config: WorkbenchPreferences,
  field: WorkbenchSettingField,
): WorkbenchSettingValue {
  if (isLocalSettingField(field)) return field.read();
  const name = field.key.slice(field.category.length + 1);
  return (config[field.category] as unknown as Record<string, WorkbenchSettingValue>)[name];
}

/** 把单字段新值包装成子树级 patch(useWorkbenchConfig.update / setFields 入参)。 */
export function buildFieldPatch(
  field: WorkbenchSettingField,
  value: WorkbenchSettingValue,
): WorkbenchConfigPatch {
  if (isLocalSettingField(field)) {
    throw new Error("Local workbench setting fields do not build preference patches");
  }
  const name = field.key.slice(field.category.length + 1);
  return { [field.category]: { [name]: value } } as WorkbenchConfigPatch;
}

/** lockable 字段对应的 LockableField 名(平铺命名,与 lockedFields 比对);非 lockable 返回 null。 */
export function lockableFieldName(field: WorkbenchSettingField): LockableField | null {
  if (isLocalSettingField(field)) return null;
  if (!field.lockable) return null;
  return field.key.slice(field.category.length + 1) as LockableField;
}

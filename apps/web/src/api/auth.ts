import { apiClient } from "./client";

export interface LoginPayload {
  email: string;
  password: string;
  // v0.9.3 · progressive CAPTCHA：达到失败阈值后必填
  captcha_token?: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

/** v0.15.3 · 偏好四分树:跨模态通用项。 */
export interface WorkbenchCommonPreferences {
  longTaskSampleRate: number;
  confirmDelete: "never" | "multi_only" | "always";
  recentClassesLimit: number;
  /** v0.15.19 · 邻帧框叠加独立开关;历史 crossFrameOverlayK=0 仍按关闭兼容。 */
  crossFrameOverlayEnabled: boolean;
  /** v0.15.6 · 邻帧框叠加帧数档位(1/3/5/7;0 仅兼容旧关闭值)。 */
  crossFrameOverlayK: number;
  /** v0.15.17 · 邻帧框叠加范围:selected=仅选中对象的 group(现状);all=不选对象也叠邻帧全部框。 */
  crossFrameOverlayScope: "selected" | "all";
  performanceTier: "light" | "standard" | "aggressive";
}

/** v0.15.3 · 图像工作台渲染偏好(原顶层平铺字段归位)。 */
export interface WorkbenchImagePreferences {
  smoothImage: boolean;
  cssImageFilter: string;
  controlPointsSize: number;
  autoFitOnResize: boolean;
  snapToGrid: boolean;
  afterBoxCreate: "pick_class" | "reuse_active";
  snapThresholdPx: number;
  zoomStepFactor: 1.05 | 1.1 | 1.15 | 1.2;
  fadedOpacity: number;
  showBoxLabels: boolean;
  maskOverlayOpacity: number;
}

export type VideoDefaultPlaybackRate = 0.25 | 0.5 | 1 | 2 | 4;
export type VideoLargeFrameStep = 5 | 10 | 30 | "grid";

/** v0.15.5 · 视频工作台播放 / 步进偏好。 */
export interface WorkbenchVideoPreferences {
  defaultPlaybackRate: VideoDefaultPlaybackRate;
  largeFrameStep: VideoLargeFrameStep;
  autoFitOnResize: boolean;
}

/** v0.15.6 · 点云工作台渲染 / 导航偏好。 */
export interface WorkbenchPointcloudPreferences {
  pointSize: number;
  persistCameraView: boolean;
  colorizeWithCamera: boolean;
  colorizeContrast: number;
  colorizeBrightness: number;
  colorizeGamma: number;
  showDepthHint: boolean;
  pointMaskSelectMode: "rect" | "lasso" | "polygon";
  showGrid: boolean;
  showAxisGizmo: boolean;
  cameraDamping: number;
  /** v0.15.18 · 邻帧点云叠加(ego 补偿对齐前后帧点云,静止背景加密/动态拖影)。需 ego 轨迹。 */
  neighborPointOverlay: boolean;
  /** v0.15.19 · 邻帧点云叠加帧数,独立于邻帧框叠加;点云较重,限制为 1-3。 */
  neighborPointOverlayK: 1 | 2 | 3;
  /**
   * v0.15.22 · §C.8-B / v0.15.23 · §C.8-A 邻帧点云动态点处理:
   * keep=保留拖影 / cull=剔除落在当前帧 box 内的邻帧点 / align=逐目标把邻帧点搬到当前位置。
   */
  neighborPointCull: "keep" | "cull" | "align";
}

/** v0.15.3 · common/image/video/pointcloud 四子树;layout 保持顶层(壳层/设备维度)。 */
export interface WorkbenchPreferences {
  common: WorkbenchCommonPreferences;
  image: WorkbenchImagePreferences;
  video: WorkbenchVideoPreferences;
  pointcloud: WorkbenchPointcloudPreferences;
  layout: WorkbenchLayoutPreferences;
}

export interface FloatingPanelState {
  detached: boolean;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
}

export type FloatingInspectorState = FloatingPanelState;

export interface TriViewFloatState {
  collapsed: boolean;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
}

/** v0.15.x · 3D 悬浮相机面板位置 + 折叠态,按相机 role 分桶。x/y 为 null = 未拖动,用默认贴边位。 */
export interface CameraPanelState {
  x: number | null;
  y: number | null;
  collapsed?: boolean;
}

export interface PointcloudCameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  mode: "orbit" | "bev";
}

export interface WorkbenchLayoutPreferences {
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: number;
  rightWidth: number;
  floatingTaskQueue: FloatingPanelState;
  floatingClassPalette: FloatingPanelState;
  floatingInspector: FloatingPanelState;
  floatingDiscussion: FloatingPanelState;
  triViewFloat: TriViewFloatState;
  cameraPanels: Record<string, CameraPanelState>;
  pointcloudCamera: PointcloudCameraState | null;
}

/** 每用户的 AI 工具推理参数偏好，按 ML backend id 分桶（不同后端参数 schema 不同）。 */
export interface AIToolPreferences {
  params_by_backend: Record<string, Record<string, unknown>>;
}

/** v0.15.25 · 主题偏好:light/dark 固定，system 跟随 OS prefers-color-scheme。 */
export type ThemePref = "light" | "dark" | "system";

/** v0.15.25 · 全局 UI 偏好(工作台之外);主题从 localStorage 升到服务端,跟随账号跨设备。 */
export interface UIPreferences {
  theme: ThemePref;
}

export interface UserPreferences {
  workbench: WorkbenchPreferences;
  ai: AIToolPreferences;
  ui: UIPreferences;
}

export const DEFAULT_WORKBENCH_PREFERENCES: WorkbenchPreferences = {
  common: {
    longTaskSampleRate: 0.05,
    confirmDelete: "never",
    recentClassesLimit: 5,
    crossFrameOverlayEnabled: false,
    crossFrameOverlayK: 1,
    crossFrameOverlayScope: "selected",
    performanceTier: "standard",
  },
  image: {
    smoothImage: true,
    cssImageFilter: "",
    controlPointsSize: 6,
    autoFitOnResize: true,
    snapToGrid: false,
    afterBoxCreate: "pick_class",
    snapThresholdPx: 8,
    zoomStepFactor: 1.1,
    fadedOpacity: 0.35,
    showBoxLabels: true,
    maskOverlayOpacity: 0.45,
  },
  video: {
    defaultPlaybackRate: 1,
    largeFrameStep: 10,
    autoFitOnResize: true,
  },
  pointcloud: {
    pointSize: 0.06,
    persistCameraView: false,
    colorizeWithCamera: false,
    colorizeContrast: 1,
    colorizeBrightness: 0,
    colorizeGamma: 1,
    showDepthHint: false,
    pointMaskSelectMode: "rect",
    showGrid: true,
    showAxisGizmo: true,
    cameraDamping: 0.1,
    neighborPointOverlay: false,
    neighborPointOverlayK: 1,
    neighborPointCull: "keep",
  },
  layout: {
    leftOpen: true,
    rightOpen: true,
    leftWidth: 260,
    rightWidth: 280,
    floatingTaskQueue: {
      detached: false,
      x: null,
      y: null,
      w: null,
      h: null,
    },
    floatingClassPalette: {
      detached: false,
      x: null,
      y: null,
      w: null,
      h: null,
    },
    floatingInspector: {
      detached: false,
      x: null,
      y: null,
      w: null,
      h: null,
    },
    floatingDiscussion: {
      detached: false,
      x: null,
      y: null,
      w: null,
      h: null,
    },
    triViewFloat: {
      collapsed: false,
      x: null,
      y: null,
      w: null,
      h: null,
    },
    cameraPanels: {},
    pointcloudCamera: null,
  },
};

export interface MeResponse {
  id: string;
  email: string;
  name: string;
  role: string;
  group_name: string | null;
  status: string;
  created_at: string;
  // v0.8.1
  password_admin_reset_at?: string | null;
  deactivation_requested_at?: string | null;
  deactivation_scheduled_at?: string | null;
  // v0.9.41 · 标注偏好（workbench 渲染配置等）。空对象表示未设置，按客户端默认。
  preferences?: Partial<UserPreferences>;
}

export const authApi = {
  login: (payload: LoginPayload) =>
    apiClient.post<TokenResponse>("/auth/login", payload),
  me: () => apiClient.get<MeResponse>("/auth/me"),
  logout: () => apiClient.post<void>("/auth/logout", {}),
  logoutAll: () => apiClient.post<TokenResponse>("/auth/logout-all", {}),
  // v0.8.8 · 用现有（即将 / 已过期）token 换新 token，7 天 grace 内有效。
  // useNotificationSocket onclose 1008/4001 时触发，长会话标注员永不被踢。
  refresh: () => apiClient.post<TokenResponse>("/auth/refresh", {}),
  // v0.9.41 · 工作台偏好读写
  getPreferences: () => apiClient.get<UserPreferences>("/auth/me/preferences"),
  // 后端按顶层子树合并（exclude_unset），故可只提交单个子树（workbench 或 ai）。
  updatePreferences: (payload: Partial<UserPreferences>) =>
    apiClient.patch<UserPreferences>("/auth/me/preferences", payload),
};

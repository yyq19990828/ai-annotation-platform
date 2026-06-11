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
  /** v0.15.6 · 邻帧叠加 K(0=关,档位 0/1/3/5/7)。当前 3D 点云消费,放 common 供视频侧后续复用。 */
  crossFrameOverlayK: number;
}

/** v0.15.3 · 图像工作台渲染偏好(原顶层平铺字段归位)。 */
export interface WorkbenchImagePreferences {
  smoothImage: boolean;
  cssImageFilter: string;
  controlPointsSize: number;
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
}

/** v0.15.6 · 点云工作台渲染 / 导航偏好。 */
export interface WorkbenchPointcloudPreferences {
  pointSize: number;
  pointMaskSelectMode: "rect" | "lasso" | "polygon";
  showGrid: boolean;
  showAxisGizmo: boolean;
  cameraDamping: number;
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
}

/** 每用户的 AI 工具推理参数偏好，按 ML backend id 分桶（不同后端参数 schema 不同）。 */
export interface AIToolPreferences {
  params_by_backend: Record<string, Record<string, unknown>>;
}

export interface UserPreferences {
  workbench: WorkbenchPreferences;
  ai: AIToolPreferences;
}

export const DEFAULT_WORKBENCH_PREFERENCES: WorkbenchPreferences = {
  common: {
    longTaskSampleRate: 0.05,
    confirmDelete: "never",
    recentClassesLimit: 5,
    crossFrameOverlayK: 0,
  },
  image: {
    smoothImage: true,
    cssImageFilter: "",
    controlPointsSize: 6,
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
  },
  pointcloud: {
    pointSize: 0.06,
    pointMaskSelectMode: "rect",
    showGrid: true,
    showAxisGizmo: true,
    cameraDamping: 0.1,
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

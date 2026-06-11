/**
 * v0.13.2 · 点云查看器(只读 MVP)。
 *
 * 拉 point-cloud manifest → 用裸 Three.js(PointCloudScene)渲染主点云 + OrbitControls,
 * 旁边平铺各相机图(只读,不画投影框 —— 投影联动是 v0.13.4)。与 Konva 2D 工作台双栈隔离。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import type { CameraPanelState, TriViewFloatState } from "@/api/auth";
import type { AnnotationPayload, AnnotationUpdatePayload } from "@/api/tasks";
import {
  useAnnotations,
  useCreateAnnotation,
  useDeleteAnnotation,
  useTask,
  useUpdateAnnotation,
} from "@/hooks/useTasks";
import { useProject } from "@/hooks/useProjects";
import { useFrameNeighbors } from "@/hooks/useFrameNeighbors";
import { useNeighborAnnotations } from "@/hooks/useNeighborAnnotations";
import { useSceneTrajectory } from "@/hooks/useSceneTrajectory";
import { alignPsrToFrame } from "./geometry/egoAlign";
import { useToastStore } from "@/components/ui/Toast";
import { classColorForCanvas } from "@/pages/Workbench/stage/colors";
import type { ThreeDTool } from "@/pages/Workbench/state/useWorkbenchState";
import type { WorkbenchLayoutPatch } from "@/pages/Workbench/state/useWorkbenchConfig";
import type { Box3DGeometry, PointMaskGeometry, SensorCalibration } from "@/types";

import { AttributeForm } from "../../shell/AttributeForm";
import { FloatingPanelShell, type FloatingPanelRect } from "../../shell/FloatingPanelShell";
import type { FloatingPanelBounds } from "../../shell/useDragMove";
import { usePointCloudManifest } from "./usePointCloudManifest";
import {
  PointCloudScene,
  type PointCloudStats,
  type PointMaskSelection,
  type SceneBox,
  type ReferenceBox,
} from "./PointCloudScene";
import { CrossFrameOverlayToggle } from "../../components/CrossFrameOverlayToggle";
import { CrossFrameInterpolateBar } from "../../components/CrossFrameInterpolateBar";
import CameraProjectionView from "./CameraProjectionView";
import FloatingCameraPanel from "./FloatingCameraPanel";
import TriViewPanel from "./TriViewPanel";
import type { TriSelected } from "./TriOrthoView";
import type { Psr } from "./geometry/triview";
import { psrToCorners } from "./geometry/box3d";
import { cameraAnchor, type Anchor } from "./geometry/cameraAnchor";
import type { CameraSample } from "./geometry/colorize";
import { colorizePointsAsync } from "./geometry/pointcloudCompute";
import { projectPoints } from "./geometry/projection";
import type { ScreenPoint } from "./geometry/pointInPolygon";
import {
  fitSize,
  fitBottom,
  fitYaw,
  fitSizeAndBottom,
  psrFromPoints,
} from "./geometry/autofit";
import {
  applyConventionToPsr,
  applyConventionToExtrinsic,
  type LidarAxisConvention,
  unapplyConventionToPsr,
} from "./geometry/axisConvention";
import {
  box3dAttributeSchema,
  LIDAR_BOX_3D_TOOL_UNIT,
} from "./geometry/box3dAttributes";
import {
  pasteOffsetPayload,
  serializeBox3D,
  type ClipboardBox3D,
} from "./geometry/box3dClipboard";
import { useThreeDHistory } from "./useThreeDHistory";
import styles from "./ThreeDWorkbench.module.css";

interface ThreeDWorkbenchProps {
  taskId: string | null;
  /** v0.13.3 · 锁定 task / viewer 角色时只读:不放置 / 不编辑 / 无 gizmo,仅看 + 选中查看数值。 */
  readOnly?: boolean;
  /** v0.13.3-5 · 壳层共享选中态(与标注列表 / 右栏面板同一份),驱动选中高亮 / gizmo / 数值面板。 */
  selectedId: string | null;
  selectedIds: string[];
  onSelectBox: (id: string | null, opts?: { shift?: boolean }) => void;
  /** v0.13.3-5 · 壳层激活类别(左栏 ClassPalette 选);放置新框的 class_name 取它。 */
  activeClass: string;
  /** v0.13.3-5 · 3D 工具态(左栏 ToolDock 选,壳层共享):select 拾取 / box 点地面放置。 */
  threeDTool: ThreeDTool;
  onSetThreeDTool: (t: ThreeDTool) => void;
  /** v0.14.1 · 跨帧目标延续 (Shift+→ / Shift+←): 把选中框 propagate 到同 scene 邻帧。 */
  onCrossFramePropagate: (direction: "next" | "prev") => void;
  /** v0.15.1 · 批量延续 (Ctrl+Shift+→/←): 当前帧全部 box_3d 延续到邻帧。 */
  onCrossFramePropagateBatch: (direction: "next" | "prev") => void;
  /** v0.15.1 · 把选中框延续到 scene 内指定帧(插值工作流建链)。 */
  onCrossFramePropagateToTask: (targetTaskId: string, targetFrameIndex: number) => void;
  /** v0.15.1 · 区间插值填充(当前 task 为起点帧)。 */
  onCrossFrameInterpolate: (groupId: number, toTaskId: string) => void;
  /** v0.13.10 · 右栏避让与三视图浮窗持久化。 */
  rightSidebarOpen: boolean;
  rightSidebarWidth: number;
  triViewFloat: TriViewFloatState;
  /** v0.15.x · 悬浮相机面板位置 + 折叠态(按相机 role 分桶,迁自旧 localStorage)。 */
  cameraPanels: Record<string, CameraPanelState>;
  onWorkbenchLayoutChange: (patch: WorkbenchLayoutPatch) => void;
}

// v0.13.3 · 新框默认尺寸(米,长宽高;约一辆轿车),放置后用面板/gizmo 精修。
const DEFAULT_BOX_SIZE: [number, number, number] = [4.0, 1.8, 1.6];
// v0.14.1 · 邻帧叠加 K 值持久化键(全局, 切 task 不重置)。
const CROSS_FRAME_OVERLAY_K_KEY = "workbench.crossFrameOverlayK";
const POINT_MASK_MODE_KEY = "workbench.pointMaskSelectMode";
const CAMERA_AUTO_COLLAPSE_WIDTH = 1366;
const CAMERA_STACK_VISIBLE = 2;
const TRI_FLOAT_DEFAULT_W = 240;
const TRI_FLOAT_DEFAULT_H = 440;
type PointMaskSelectMode = "rect" | "lasso" | "polygon";
// v0.13.9 · 框选预览矩形位置/尺寸经 CSS custom property 注入(逐帧动态值)。
type BoxSelectRectVars = CSSProperties & {
  "--rect-l": string;
  "--rect-t": string;
  "--rect-w": string;
  "--rect-h": string;
};

function readPointMaskMode(): PointMaskSelectMode {
  try {
    const raw = localStorage.getItem(POINT_MASK_MODE_KEY);
    if (raw === "rect" || raw === "lasso" || raw === "polygon") return raw;
  } catch {
    /* ignore */
  }
  return "rect";
}

function sortedIndices(indices: Iterable<number>): number[] {
  return [...indices].sort((a, b) => a - b);
}

function resolveTriViewFloatRect(
  state: TriViewFloatState,
  rightSidebarWidth: number,
): FloatingPanelRect {
  const w = state.w ?? TRI_FLOAT_DEFAULT_W;
  const h = state.h ?? TRI_FLOAT_DEFAULT_H;
  const viewportW = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 800 : window.innerHeight;
  return {
    x: state.x ?? Math.max(24, viewportW - w - rightSidebarWidth - 12),
    y: state.y ?? Math.max(24, viewportH - h - 12),
    w,
    h,
  };
}
// 点云项目的 3D 框工具单位(类别 / 属性绑定都挂在它下面)。
const LIDAR_TOOL_UNIT = LIDAR_BOX_3D_TOOL_UNIT;
const POINT_MASK_TOOL_UNIT = "point_mask_3d";

function boxGeometryFromPsr(psr: Psr, convention: LidarAxisConvention): Box3DGeometry {
  return {
    type: "box_3d",
    center: [psr.center[0], psr.center[1], psr.center[2]],
    size: [psr.size[0], psr.size[1], psr.size[2]],
    rotation: [psr.rotation[0], psr.rotation[1], psr.rotation[2]],
    convention_at_create: convention,
  };
}

function geometryConvention(
  geometry: unknown,
  fallback: LidarAxisConvention,
): LidarAxisConvention {
  const g = geometry as { convention_at_create?: LidarAxisConvention | null } | null;
  return g?.convention_at_create ?? fallback;
}

/**
 * v0.13.6 · 把相机图加载成 CameraSample(原图分辨率 RGBA buffer),供点云上色逐点采样。
 * crossOrigin="anonymous" 让 canvas 不被跨域污染(MinIO 已为点云 GET 放行 CORS);
 * 加载失败 / getImageData 仍被污染(SecurityError)→ 返回 null(该相机降级跳过,不阻断其余)。
 */
function loadCameraSample(
  imageUrl: string,
  calib: SensorCalibration,
): Promise<CameraSample | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0);
      try {
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve({ calib, width: canvas.width, height: canvas.height, data });
      } catch {
        resolve(null); // 跨域污染
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

// v0.13.3 · PSR 数值面板字段(中心 cx/cy/cz、尺寸 l/w/h、朝向 yaw/pitch/roll)。
// v0.13.5 · 朝向补齐三轴: yaw=rotation[2](绕Z)、pitch=rotation[1](绕Y)、roll=rotation[0](绕X),
//   与三视图方向线(Top/Side/Front)一致, 避免数值编辑抹掉 pitch/roll。
type PsrField = "cx" | "cy" | "cz" | "l" | "w" | "h" | "yaw" | "pitch" | "roll";
const PSR_FIELDS: PsrField[] = ["cx", "cy", "cz", "l", "w", "h", "yaw", "pitch", "roll"];
const SIZE_FIELDS = new Set<PsrField>(["l", "w", "h"]);
const PSR_GROUPS: {
  label: string;
  keys: PsrField[];
  step: number;
  min?: number;
  reset?: boolean;
}[] = [
  { label: "中心 (m)", keys: ["cx", "cy", "cz"], step: 0.1 },
  { label: "尺寸 长宽高 (m)", keys: ["l", "w", "h"], step: 0.1, min: 0.1 },
  { label: "朝向 偏航/俯仰/翻滚 (°)", keys: ["yaw", "pitch", "roll"], step: 1, reset: true },
];
const fmtNum = (n: number) => String(+n.toFixed(3));
function psrToForm(b: {
  center: readonly number[];
  size: readonly number[];
  rotation: readonly number[];
}): Record<PsrField, string> {
  return {
    cx: fmtNum(b.center[0]),
    cy: fmtNum(b.center[1]),
    cz: fmtNum(b.center[2]),
    l: fmtNum(b.size[0]),
    w: fmtNum(b.size[1]),
    h: fmtNum(b.size[2]),
    yaw: fmtNum((b.rotation[2] * 180) / Math.PI),
    pitch: fmtNum((b.rotation[1] * 180) / Math.PI),
    roll: fmtNum((b.rotation[0] * 180) / Math.PI),
  };
}

// v0.13.7 · 取 front 相机光轴的水平「前方」(归一化 [x,y]),供 resetView 跟随车头朝向。
// front = anchor 推为 top 的相机;无标定 / 退化 → null(回退默认 +Y)。
function frontCameraForward(
  cams: { calibration?: SensorCalibration | null; role: string; name: string }[],
): [number, number] | null {
  const front = cams.find((c) => cameraAnchor(c.calibration, c.role || c.name) === "top");
  const e = front?.calibration?.extrinsic;
  if (!e) return null;
  const x = e[8];
  const y = e[9];
  const n = Math.hypot(x, y);
  return n < 1e-3 ? null : [x / n, y / n];
}

// v0.13.7 · 朝向 → 悬浮定位容器 CSS 类(贴主视图对应边缘)。
const ANCHOR_CLASS: Record<Anchor, string> = {
  top: styles.camAnchorTop,
  bottom: styles.camAnchorBottom,
  left: styles.camAnchorLeft,
  right: styles.camAnchorRight,
  "top-left": styles.camAnchorTopLeft,
  "top-right": styles.camAnchorTopRight,
  "bottom-left": styles.camAnchorBottomLeft,
  "bottom-right": styles.camAnchorBottomRight,
  overflow: styles.camAnchorOverflow,
};

export function ThreeDWorkbench({
  taskId,
  readOnly = false,
  selectedId,
  selectedIds,
  onSelectBox,
  activeClass,
  threeDTool,
  onSetThreeDTool,
  onCrossFramePropagate,
  onCrossFramePropagateBatch,
  onCrossFramePropagateToTask,
  onCrossFrameInterpolate,
  rightSidebarOpen,
  rightSidebarWidth,
  triViewFloat,
  cameraPanels,
  onWorkbenchLayoutChange,
}: ThreeDWorkbenchProps) {
  const { data: manifest, isLoading, error } = usePointCloudManifest(taskId, true);
  const pushToast = useToastStore((st) => st.push);
  // v0.13.11 · dataset 声明的 lidar 系约定;前端把点云 positions + 相机 extrinsic 一次性
  // 旋转到 ISO 8855 (+X 前 / +Y 左 / +Z 上),上层几何代码继续锁死 ISO。null / 缺省 = iso_8855。
  const axisConvention: LidarAxisConvention = manifest?.axis_convention ?? "iso_8855";
  // v0.14.0 · scene 字段(跨 task 帧序列地基)仅做调试透出,本期 UX 不消费;
  // v0.14.1 会上 useFrameNeighbors hook + Shift+→ propagate 等。
  useEffect(() => {
    if (manifest?.scene_id) {
      console.debug("[3D] scene info", {
        scene_id: manifest.scene_id,
        scene_name: manifest.scene_name,
        frame_index: manifest.frame_index,
        scene_total_frames: manifest.scene_total_frames,
      });
    }
  }, [
    manifest?.scene_id,
    manifest?.scene_name,
    manifest?.frame_index,
    manifest?.scene_total_frames,
  ]);
  const axisConventionRef = useRef<LidarAxisConvention>(axisConvention);
  axisConventionRef.current = axisConvention;
  const viewportWrapRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PointCloudScene | null>(null);
  const [triFloatBounds, setTriFloatBounds] = useState<FloatingPanelBounds | null>(null);
  const [stats, setStats] = useState<PointCloudStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pointSize, setPointSize] = useState(0.06);
  const [pointCloudViewMode, setPointCloudViewMode] = useState<"orbit" | "bev">("orbit");
  // v0.13.6 · 相机 RGB 上色开关(默认关:无标定相机降级,且省一次性投影采样开销)。
  const [colorizeOn, setColorizeOn] = useState(false);
  const [colorizing, setColorizing] = useState(false);
  // v0.13.6 · 深度提示开关(默认关):相机图叠深度热力图 + hover 读最近点深度/3D。
  const [depthOn, setDepthOn] = useState(false);
  // v0.13.7 · 放大查看的相机 role(L3);null = 无放大。点⛶开,ESC/遮罩/关闭钮收。
  const [enlargedRole, setEnlargedRole] = useState<string | null>(null);
  const [autoCollapseCameras, setAutoCollapseCameras] = useState(false);
  const [pointMaskSelectMode, setPointMaskSelectMode] = useState<PointMaskSelectMode>(() =>
    readPointMaskMode(),
  );
  const [pointMaskPolygonPoints, setPointMaskPolygonPoints] = useState<ScreenPoint[]>([]);
  const [pointMaskCursor, setPointMaskCursor] = useState<ScreenPoint | null>(null);
  const finishPointMaskPolygonRef = useRef<(subtract: boolean) => void>(() => undefined);
  // 选中态来自壳层(selectedId / onSelectBox props),与标注列表 / 右栏面板共享同一份。

  const { data: annotations } = useAnnotations(taskId ?? undefined);
  const updateAnnotation = useUpdateAnnotation(taskId ?? undefined);
  const deleteAnnotation = useDeleteAnnotation(taskId ?? undefined);
  const createAnnotation = useCreateAnnotation(taskId ?? undefined);
  const history = useThreeDHistory(taskId, {
    createAnnotation,
    deleteAnnotation,
    updateAnnotation,
  });
  const clipboardRef = useRef<ClipboardBox3D | null>(null);
  const pasteCountRef = useRef(0);
  const annotationsRef = useRef<typeof annotations>(annotations);
  annotationsRef.current = annotations;
  // scene 的拖拽回调只设一次,用 ref 取最新 mutate,避免闭包旧值。
  const updateMutateRef = useRef(updateAnnotation.mutate);
  updateMutateRef.current = updateAnnotation.mutate;
  const historyPushRef = useRef(history.push);
  historyPushRef.current = history.push;

  // 创建新 3D 标注需要对应工具单位的类别(后端按 tool_bindings 校验 class_name)。
  const { data: task } = useTask(taskId ?? "");
  const { data: project } = useProject(task?.project_id ?? "");
  const toolBindings = project?.tool_bindings;
  const hasToolBindings = !!toolBindings && Object.keys(toolBindings).length > 0;
  const boxClasses = useMemo(
    () => {
      const binding = toolBindings?.[LIDAR_TOOL_UNIT];
      if (hasToolBindings && !binding?.enabled) return [];
      return (binding?.classes ?? []).map((c) => c.name);
    },
    [hasToolBindings, toolBindings],
  );
  const pointMaskOwnClasses = useMemo(
    () => {
      const binding = toolBindings?.[POINT_MASK_TOOL_UNIT];
      if (hasToolBindings && !binding?.enabled) return [];
      return (binding?.classes ?? []).map((c) => c.name);
    },
    [hasToolBindings, toolBindings],
  );
  const pointMaskClasses = pointMaskOwnClasses.length > 0 ? pointMaskOwnClasses : boxClasses;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // 工具态 / 待放置类别全来自壳层(ToolDock 的 threeDTool + 左栏 ClassPalette 的 activeClass);
  // canPlace 兜底:只读 / 未配类别时不允许放置。class 在 activeClass 不在类集合时回落首个。
  const canPlaceBox = !readOnly && boxClasses.length > 0;
  const canPlacePointMask = !readOnly && pointMaskClasses.length > 0;
  const placing = threeDTool === "box" && canPlaceBox;
  const pointMasking = threeDTool === "point-mask" && canPlacePointMask;
  const pointMaskPolygonMode = pointMasking && pointMaskSelectMode === "polygon";
  const pointMaskDragMode = pointMasking && pointMaskSelectMode !== "polygon";
  const drawingSelection = placing || pointMasking;
  const boxPlaceClass =
    activeClass && boxClasses.includes(activeClass) ? activeClass : (boxClasses[0] ?? null);
  const pointMaskPlaceClass =
    activeClass && pointMaskClasses.includes(activeClass)
      ? activeClass
      : (pointMaskClasses[0] ?? null);
  const effectiveRightSidebarWidth = rightSidebarOpen ? rightSidebarWidth : 0;
  const triFloatPosition = useMemo(
    () => resolveTriViewFloatRect(triViewFloat, effectiveRightSidebarWidth),
    [
      effectiveRightSidebarWidth,
      triViewFloat,
    ],
  );
  const updateTriViewFloat = useCallback(
    (patch: Partial<FloatingPanelRect> & { collapsed?: boolean }) => {
      onWorkbenchLayoutChange({
        triViewFloat: {
          ...triViewFloat,
          ...patch,
        },
      });
    },
    [onWorkbenchLayoutChange, triViewFloat],
  );

  // v0.15.x · 相机面板位置/折叠态落库:多面板可连续拖动,故用 ref 取最新整份 Record,
  // 避免相邻回调读到 props 旧值互相覆盖。复位则删该 role 键。
  const cameraPanelsRef = useRef(cameraPanels);
  cameraPanelsRef.current = cameraPanels;
  const handleCameraPanelPosition = useCallback(
    (role: string, pos: { x: number; y: number } | null) => {
      const next = { ...cameraPanelsRef.current };
      const prev = next[role];
      if (pos === null) {
        // 归位:仅清位置;若仍有非默认折叠态则保留该 role 键,否则整键删除。
        if (prev?.collapsed) {
          next[role] = { x: null, y: null, collapsed: true };
        } else {
          delete next[role];
        }
      } else {
        next[role] = { ...prev, x: pos.x, y: pos.y };
      }
      cameraPanelsRef.current = next;
      onWorkbenchLayoutChange({ cameraPanels: next });
    },
    [onWorkbenchLayoutChange],
  );
  const handleCameraPanelCollapsed = useCallback(
    (role: string, collapsed: boolean) => {
      const prev = cameraPanelsRef.current[role];
      const next = { ...cameraPanelsRef.current };
      // 折叠态独立于位置;回到默认(展开)且无自定义位置时整键删除,保持 Record 干净。
      if (!collapsed && prev?.x == null && prev?.y == null) {
        delete next[role];
      } else {
        next[role] = { x: prev?.x ?? null, y: prev?.y ?? null, collapsed };
      }
      cameraPanelsRef.current = next;
      onWorkbenchLayoutChange({ cameraPanels: next });
    },
    [onWorkbenchLayoutChange],
  );

  // v0.15.x · 一次性迁移兜底:user config 的 cameraPanels 为空但本地仍有旧
  // pcwb:cam-pos / pcwb:cam-collapsed 键时,读出灌入 config 后清掉旧键(避免双写)。
  useEffect(() => {
    if (Object.keys(cameraPanelsRef.current).length > 0) return;
    let migrated: Record<string, CameraPanelState> | null = null;
    const staleKeys: string[] = [];
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        const posMatch = key.match(/^pcwb:cam-pos:(.+)$/);
        const collMatch = key.match(/^pcwb:cam-collapsed:(.+)$/);
        const role = posMatch?.[1] ?? collMatch?.[1];
        if (!role) continue;
        staleKeys.push(key);
        migrated ??= {};
        const entry = (migrated[role] ??= { x: null, y: null });
        if (posMatch) {
          const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");
          if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
            entry.x = Number(parsed.x);
            entry.y = Number(parsed.y);
          }
        } else {
          entry.collapsed = window.localStorage.getItem(key) === "1";
        }
      }
    } catch {
      /* 隐私模式 / 解析失败:放弃迁移,不影响功能 */
    }
    if (migrated && Object.keys(migrated).length > 0) {
      cameraPanelsRef.current = migrated;
      onWorkbenchLayoutChange({ cameraPanels: migrated });
    }
    for (const key of staleKeys) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
    // 仅首挂载跑一次;onWorkbenchLayoutChange 稳定(useCallback),不进依赖避免重复迁移。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    const viewport = viewportWrapRef.current;
    if (!controls || !viewport) return;
    const setToolbarHeight = (height: number) => {
      viewport.style.setProperty("--top-toolbar-height", `${Math.round(height)}px`);
    };
    setToolbarHeight(controls.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setToolbarHeight(entry.contentRect.height);
    });
    observer.observe(controls);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportWrapRef.current;
    if (!viewport) return;
    const syncBounds = () => {
      const rect = viewport.getBoundingClientRect();
      const next: FloatingPanelBounds = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        margin: 12,
      };
      setTriFloatBounds((prev) => (
        prev
        && prev.left === next.left
        && prev.top === next.top
        && prev.right === next.right
        && prev.bottom === next.bottom
        && prev.margin === next.margin
          ? prev
          : next
      ));
    };
    syncBounds();
    window.addEventListener("resize", syncBounds);
    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", syncBounds);
    }
    const observer = new ResizeObserver(syncBounds);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, []);

  useLayoutEffect(() => {
    const sync = () => {
      const width = viewportWrapRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      setAutoCollapseCameras(width < CAMERA_AUTO_COLLAPSE_WIDTH);
    };
    sync();
    window.addEventListener("resize", sync);
    if (typeof ResizeObserver === "undefined" || !viewportWrapRef.current) {
      return () => window.removeEventListener("resize", sync);
    }
    const observer = new ResizeObserver(sync);
    observer.observe(viewportWrapRef.current);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(POINT_MASK_MODE_KEY, pointMaskSelectMode);
    } catch {
      /* ignore */
    }
  }, [pointMaskSelectMode]);

  useEffect(() => {
    if (pointMasking) return;
    setPointMaskPolygonPoints([]);
    setPointMaskCursor(null);
  }, [pointMasking]);

  // 选中框的 PSR 编辑表单(字符串值,允许清空 / 中间态如 "-" / "1.";解析有效时才提交)。
  // PATCH 防抖 250ms;yaw 以度展示。
  const [form, setForm] = useState<Record<PsrField, string> | null>(null);
  const patchTimer = useRef<number | null>(null);

  // v0.13.5 · 三视图拖拽中的本地草稿 PSR (覆盖选中框, 实时四方同步; 松手 PATCH 后清空)。
  const [draftPsr, setDraftPsr] = useState<{ id: string; psr: Psr } | null>(null);

  // 标注里的 3D 框(geometry.type==="box_3d")→ 渲染层输入(PSR + 类别色 + 选中态)。
  const boxes = useMemo<SceneBox[]>(() => {
    const list: SceneBox[] = [];
    for (const a of annotations ?? []) {
      if (a.is_hidden) continue; // 隐藏的框(列表 H 切换)不渲染,与 2D 画布同语义
      const g = a.geometry as {
        type?: string;
        center?: number[];
        size?: number[];
        rotation?: number[];
      };
      if (g?.type !== "box_3d" || !g.center || !g.size || !g.rotation) continue;
      // 三视图拖拽中:用本地草稿覆盖该框的 PSR(实时预览, 不发请求)。
      const dp = draftPsr && draftPsr.id === a.id ? draftPsr.psr : null;
      list.push({
        id: a.id,
        center: dp
          ? [dp.center[0], dp.center[1], dp.center[2]]
          : (g.center as [number, number, number]),
        // 尺寸取绝对值兜底:历史/缩放翻转可能写入负 size,负值会让框翻转、且卡住数值面板
        // 的 size>0 提交校验。渲染与面板初始化统一按正尺寸。
        size: dp
          ? [Math.abs(dp.size[0]), Math.abs(dp.size[1]), Math.abs(dp.size[2])]
          : (g.size.map((v) => Math.abs(v)) as [number, number, number]),
        rotation: dp
          ? [dp.rotation[0], dp.rotation[1], dp.rotation[2]]
          : (g.rotation as [number, number, number]),
        color: classColorForCanvas(a.class_name),
        selected: selectedIdSet.has(a.id),
      });
    }
    return list;
  }, [annotations, selectedIdSet, draftPsr]);

  const selectedBox = boxes.find((b) => b.id === selectedId) ?? null;
  const selectedAnn = (annotations ?? []).find((a) => a.id === selectedId) ?? null;
  const selectedBoxIds = useMemo(
    () => selectedIds.filter((id) => boxes.some((b) => b.id === id)),
    [selectedIds, boxes],
  );
  const multiBoxSelected = selectedBoxIds.length > 1;
  const boxAttributeSchema = useMemo(
    () => box3dAttributeSchema(toolBindings),
    [toolBindings],
  );
  // v0.14.1 · 给 Shift+→ keydown 闭包读最新选中 annotation 的几何类型(避免频繁重绑监听)。
  const selectedAnnRef = useRef(selectedAnn);
  selectedAnnRef.current = selectedAnn;
  const selectedClass = selectedAnn?.class_name ?? null;
  const pointMasks = useMemo(
    () => (annotations ?? []).filter((a) => !a.is_hidden && a.geometry?.type === "point_mask_3d"),
    [annotations],
  );
  const selectedPointMask = selectedAnn?.geometry?.type === "point_mask_3d"
    ? selectedAnn.geometry
    : null;
  const conventionMismatches = useMemo(() => {
    const mismatches = [];
    for (const ann of annotations ?? []) {
      const g = ann.geometry;
      if (!g || (g.type !== "box_3d" && g.type !== "point_mask_3d")) continue;
      const created = (g as { convention_at_create?: LidarAxisConvention | null }).convention_at_create;
      if (created && created !== axisConvention) mismatches.push({ ann, convention: created });
    }
    return mismatches;
  }, [annotations, axisConvention]);
  const selectedConventionMismatch =
    selectedAnn?.geometry?.type === "box_3d"
    && selectedAnn.geometry.convention_at_create
    && selectedAnn.geometry.convention_at_create !== axisConvention
      ? selectedAnn.geometry.convention_at_create
      : null;
  // 单框锁定(列表 L 切换)→ 不可编辑(无 gizmo / 面板禁用 / 不可删),但仍可选中查看。
  const selectedLocked = !!selectedAnn?.is_locked;
  // 可编辑 = 任务级非只读 且 该框未锁定。
  const selectedEditable = !readOnly && !selectedLocked;
  const selectedPsrEditable = selectedEditable && !multiBoxSelected;
  const selectedPointMaskEditable = selectedEditable && !!selectedPointMask && !multiBoxSelected;

  // 实例化 / 销毁 Scene(随容器挂载一次)。
  useEffect(() => {
    if (!viewportRef.current) return;
    const scene = new PointCloudScene(viewportRef.current);
    sceneRef.current = scene;
    // 拖拽结束:回写表单 + PATCH 持久化(与数值面板共用持久化管线)。
    scene.setTransformHandler((id, psr) => {
      setForm(psrToForm(psr));
      const ann = annotationsRef.current?.find((a) => a.id === id);
      const geometry = boxGeometryFromPsr(
        psr,
        geometryConvention(ann?.geometry, axisConventionRef.current),
      );
      updateMutateRef.current({
        annotationId: id,
        payload: {
          geometry,
        },
      });
      if (ann?.geometry?.type === "box_3d") {
        historyPushRef.current({
          kind: "update",
          annotationId: id,
          before: { geometry: ann.geometry },
          after: { geometry },
        });
      }
    });
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(viewportRef.current);
    return () => {
      ro.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // manifest 到位后加载点云。
  // v0.13.11 · 传入 axisConvention,scene 内部加载完 PCD 立即把 positions 旋到 ISO 系。
  useEffect(() => {
    const scene = sceneRef.current;
    const url = manifest?.point_cloud_url;
    if (!scene || !url) return;
    let cancelled = false;
    setLoadError(null);
    scene
      .loadPcd(url, axisConvention)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [manifest?.point_cloud_url, axisConvention]);

  // 同步 3D 框图层(标注 / 选中变化)。scene 在挂载 effect 里先建,本 effect 后跑。
  useEffect(() => {
    sceneRef.current?.setBoxes(boxes);
  }, [boxes]);

  // 选中框时挂变换 gizmo,取消选中时脱离(依赖 boxes 以确保 setBoxes 已建好该组);只读/锁定不挂。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (selectedId && selectedPsrEditable) scene.attachTransform(selectedId);
    else scene.detachTransform();
  }, [selectedId, boxes, selectedPsrEditable]);

  // W/E/R 切 gizmo 模式(仅选中且可编辑时;焦点在输入框时不拦截)。
  useEffect(() => {
    if (!selectedId || !selectedPsrEditable) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const mode =
        e.key === "w" || e.key === "W"
          ? "translate"
          : e.key === "e" || e.key === "E"
            ? "rotate"
            : e.key === "r" || e.key === "R"
              ? "scale"
              : null;
      if (mode) sceneRef.current?.setTransformMode(mode);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedPsrEditable]);

  // v0.14.1 · Shift+→ / Shift+← 跨帧目标延续: 选中 box_3d 时 propagate 到同 scene
  // 邻帧并跳过去自动选中(orchestration 在壳层 onCrossFramePropagate)。
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      // v0.14.1 · 阻断按住 Shift+→ 的 auto-repeat: 否则连发多个 propagate POST,
      // 在目标帧造出共享同一新 group_id 的重复 annotation。
      if (e.repeat) return;
      if (!e.shiftKey || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      // 命中 Shift+左右(跨帧 propagate 组合)即抢占该按键: 即便后续因无选中 /
      // 非 box_3d 提前 return, 也要阻止壳层 arrowNudge 同键误处理(否则会把
      // NaN 写进 nudgeMap)。
      e.preventDefault();
      e.stopPropagation();
      const dir = e.key === "ArrowRight" ? "next" : "prev";
      // v0.15.1 · Ctrl+Shift+→/←: 批量延续当前帧全部 box_3d(不要求选中)。
      if (e.ctrlKey || e.metaKey) {
        void onCrossFramePropagateBatch(dir);
        return;
      }
      if (!selectedId) {
        pushToast({ msg: "请先选中一个 3D 框", kind: "" });
        return;
      }
      const selType = (
        selectedAnnRef.current?.geometry as { type?: string } | undefined
      )?.type;
      if (selType !== "box_3d") {
        pushToast({ msg: "跨帧延续仅支持 3D 框", kind: "" });
        return;
      }
      void onCrossFramePropagate(dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly, selectedId, onCrossFramePropagate, onCrossFramePropagateBatch, pushToast]);

  // 切任务回到选择工具(选中态由壳层在切任务时统管,3D 不再本地清)。
  useEffect(() => {
    onSetThreeDTool("select");
    setPointCloudViewMode("orbit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // 进入放置模式时清选中,避免 gizmo 挡在点地面的路上。
  useEffect(() => {
    if (placing || (pointMasking && selectedAnn?.geometry?.type !== "point_mask_3d")) {
      onSelectBox(null);
    }
  }, [placing, pointMasking, selectedAnn?.geometry, onSelectBox]);

  // B 进放置 / V / Esc 回选择(焦点在输入框时不拦截;无可用类别时 B 无效)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Enter" && pointMaskPolygonMode) {
        e.preventDefault();
        finishPointMaskPolygonRef.current(e.altKey);
      } else if (e.key === "Escape" || e.key === "v" || e.key === "V") {
        setPointMaskPolygonPoints([]);
        setPointMaskCursor(null);
        onSetThreeDTool("select");
      } else if ((e.key === "b" || e.key === "B") && canPlaceBox) onSetThreeDTool("box");
      else if ((e.key === "p" || e.key === "P") && canPlacePointMask) onSetThreeDTool("point-mask");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    canPlaceBox,
    canPlacePointMask,
    onSetThreeDTool,
    pointMaskPolygonMode,
  ]);

  // 选中目标切换时用其 PSR 初始化表单(编辑期间不被服务端回写覆盖,故仅依赖 selectedId)。
  useEffect(() => {
    setForm(selectedBox ? psrToForm(selectedBox) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // 卸载时清防抖定时器。
  useEffect(
    () => () => {
      if (patchTimer.current) window.clearTimeout(patchTimer.current);
    },
    [],
  );

  // 全部字段解析有效(尺寸>0)时防抖 PATCH;有空 / 非法字段则暂不提交(等用户输完)。
  const schedulePatch = useCallback(
    (f: Record<PsrField, string>) => {
      if (!selectedId) return;
      const v = {} as Record<PsrField, number>;
      for (const k of PSR_FIELDS) v[k] = Number(f[k]);
      const valid =
        PSR_FIELDS.every((k) => f[k].trim() !== "" && Number.isFinite(v[k])) &&
        v.l > 0 &&
        v.w > 0 &&
        v.h > 0;
      if (!valid) return;
      if (patchTimer.current) window.clearTimeout(patchTimer.current);
      patchTimer.current = window.setTimeout(() => {
        const deg = Math.PI / 180;
        const geometry = boxGeometryFromPsr(
          {
            center: [v.cx, v.cy, v.cz],
            size: [v.l, v.w, v.h],
            // rotation = [rx=roll, ry=pitch, rz=yaw] (弧度), 三轴齐全, 不再抹掉 pitch/roll。
            rotation: [v.roll * deg, v.pitch * deg, v.yaw * deg],
          },
          geometryConvention(selectedAnn?.geometry, axisConvention),
        );
        updateAnnotation.mutate({ annotationId: selectedId, payload: { geometry } });
        if (selectedAnn?.geometry?.type === "box_3d") {
          history.push({
            kind: "update",
            annotationId: selectedId,
            before: { geometry: selectedAnn.geometry },
            after: { geometry },
          });
        }
      }, 250);
    },
    [selectedId, updateAnnotation, selectedAnn?.geometry, axisConvention, history],
  );

  const handleField = useCallback(
    (k: PsrField, value: string) => {
      setForm((prev) => {
        if (!prev) return prev;
        const next = { ...prev, [k]: value };
        schedulePatch(next);
        return next;
      });
    },
    [schedulePatch],
  );

  // 失焦:该字段空 / 非法时从选中框当前值恢复,避免留下空字段。
  const handleFieldBlur = useCallback(
    (k: PsrField) => {
      if (!selectedBox) return;
      setForm((prev) => {
        if (!prev) return prev;
        const n = Number(prev[k]);
        const bad =
          prev[k].trim() === "" || !Number.isFinite(n) || (SIZE_FIELDS.has(k) && n <= 0);
        return bad ? { ...prev, [k]: psrToForm(selectedBox)[k] } : prev;
      });
    },
    [selectedBox],
  );

  const updateAnnotationWithHistory = useCallback(
    (annotationId: string, before: AnnotationUpdatePayload, after: AnnotationUpdatePayload) => {
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      updateAnnotation.mutate({ annotationId, payload: after });
      history.push({ kind: "update", annotationId, before, after });
    },
    [history, updateAnnotation],
  );

  const editableSelectedBoxAnnotations = useCallback(() => {
    const ids = selectedBoxIds.length > 0 ? selectedBoxIds : (selectedId ? [selectedId] : []);
    return (annotationsRef.current ?? []).filter(
      (a) => ids.includes(a.id) && a.geometry?.type === "box_3d" && !a.is_locked,
    );
  }, [selectedBoxIds, selectedId]);

  const handleDeleteSelected = useCallback(() => {
    if (readOnly) return;
    const targets = editableSelectedBoxAnnotations();
    if (targets.length === 0) return;
    for (const ann of targets) deleteAnnotation.mutate(ann.id);
    history.pushBatch(targets.map((annotation) => ({ kind: "delete", annotation })));
    onSelectBox(null);
  }, [readOnly, editableSelectedBoxAnnotations, deleteAnnotation, history, onSelectBox]);

  // 改选中框类别(3D 原生:面板下拉;2D 的画布锚定 popover 不适用 3D)。
  const handleChangeClass = useCallback(
    (cls: string) => {
      if (readOnly || !cls) return;
      if (selectedPointMask && selectedId && selectedAnn && !selectedAnn.is_locked) {
        updateAnnotationWithHistory(
          selectedId,
          { class_name: selectedAnn.class_name },
          { class_name: cls },
        );
        return;
      }
      const targets = editableSelectedBoxAnnotations();
      const commands = targets
        .filter((ann) => ann.class_name !== cls)
        .map((ann) => {
          updateAnnotation.mutate({ annotationId: ann.id, payload: { class_name: cls } });
          return {
            kind: "update" as const,
            annotationId: ann.id,
            before: { class_name: ann.class_name },
            after: { class_name: cls },
          };
        });
      history.pushBatch(commands);
    },
    [
      readOnly,
      selectedPointMask,
      selectedId,
      selectedAnn,
      updateAnnotationWithHistory,
      editableSelectedBoxAnnotations,
      updateAnnotation,
      history,
    ],
  );

  const handleChangeAttributes = useCallback(
    (next: Record<string, unknown>) => {
      if (!selectedId || !selectedAnn || readOnly || selectedAnn.is_locked || multiBoxSelected) return;
      updateAnnotationWithHistory(
        selectedId,
        { attributes: selectedAnn.attributes ?? {} },
        { attributes: next },
      );
    },
    [selectedId, selectedAnn, readOnly, multiBoxSelected, updateAnnotationWithHistory],
  );

  // v0.13.5 · 朝向归零:把三轴旋转复位为 [0,0,0](保留中心/尺寸),并同步表单。
  const handleResetRotation = useCallback(() => {
    if (!selectedId || !selectedBox) return;
    setForm((prev) => (prev ? { ...prev, yaw: "0", pitch: "0", roll: "0" } : prev));
    const geometry = boxGeometryFromPsr(
      {
        center: selectedBox.center,
        size: selectedBox.size,
        rotation: [0, 0, 0],
      },
      geometryConvention(selectedAnn?.geometry, axisConvention),
    );
    updateAnnotationWithHistory(
      selectedId,
      selectedAnn?.geometry?.type === "box_3d" ? { geometry: selectedAnn.geometry } : {},
      { geometry },
    );
  }, [selectedId, selectedBox, selectedAnn?.geometry, axisConvention, updateAnnotationWithHistory]);

  // v0.13.8 · 自动贴合:把选中框按点云 box-local AABB 收尺寸 / 贴地 / 朝向。
  // 共用 helper:拿当前点云 positions + 选中框 PSR → 跑 transform → 立即提交 + 同步表单。
  // 不走 schedulePatch 250ms 防抖(一键操作期望即时生效)。
  const applyFit = useCallback(
    (transform: (positions: Float32Array, psr: Psr) => Psr) => {
      if (!selectedId || !selectedBox || !selectedPsrEditable) return;
      const positions = sceneRef.current?.getPointPositions();
      if (!positions) return;
      const current: Psr = {
        center: selectedBox.center,
        size: selectedBox.size,
        rotation: selectedBox.rotation,
      };
      const next = transform(positions, current);
      setForm(psrToForm(next));
      const geometry = boxGeometryFromPsr(
        next,
        geometryConvention(selectedAnn?.geometry, axisConvention),
      );
      updateAnnotationWithHistory(
        selectedId,
        selectedAnn?.geometry?.type === "box_3d" ? { geometry: selectedAnn.geometry } : {},
        { geometry },
      );
    },
    [selectedId, selectedBox, selectedPsrEditable, selectedAnn?.geometry, axisConvention, updateAnnotationWithHistory],
  );
  const handleFitSize = useCallback(() => applyFit(fitSize), [applyFit]);
  const handleFitBottom = useCallback(() => applyFit(fitBottom), [applyFit]);
  const handleFitYaw = useCallback(() => applyFit(fitYaw), [applyFit]);
  const handleFitDefault = useCallback(() => applyFit(fitSizeAndBottom), [applyFit]);

  // Q (默认连击=收尺寸+贴地) / Shift+Q (仅收尺寸) / Alt+Q (仅贴地)。
  // 焦点在输入框时不拦截;未选中 / 不可编辑时跳过。Ctrl+Q 让给浏览器/系统。
  useEffect(() => {
    if (!selectedId || !selectedPsrEditable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "q" && e.key !== "Q") return;
      if (e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) handleFitSize();
      else if (e.altKey) handleFitBottom();
      else handleFitDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedPsrEditable, handleFitSize, handleFitBottom, handleFitDefault]);

  // v0.13.8 · Delete/Backspace 删选中框:全局 dispatchKey 通路在 3D 台实测未触发,
  // 故 3D 本地接管(同 useWorkbenchShellModel.threeDOwnedKeys 把这俩键交给本地)。
  // 焦点在输入框时不拦截(避免 PSR 数值面板里 Backspace 删字误删框)。
  useEffect(() => {
    if (readOnly || selectedBoxIds.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      handleDeleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly, selectedBoxIds.length, handleDeleteSelected]);

  // 锁定 / 解锁选中框(与列表 L 切换同源 is_locked;锁定后不可编辑,解锁需此按钮 / 列表)。
  const handleToggleLock = useCallback(() => {
    if (!selectedId) return;
    updateAnnotation.mutate({
      annotationId: selectedId,
      payload: { is_locked: !selectedLocked },
    });
  }, [selectedId, selectedLocked, updateAnnotation]);

  // 放置:点地面 → 默认尺寸框(落在地面上)→ 持久化 → 选中新框精修;单次放置后退出。
  const handlePlace = useCallback(
    (clientX: number, clientY: number) => {
      const scene = sceneRef.current;
      if (!scene || !boxPlaceClass) return;
      const ground = scene.placeOnGround(clientX, clientY);
      if (!ground) return;
      const [l, w, h] = DEFAULT_BOX_SIZE;
      const geometry = boxGeometryFromPsr(
        {
          center: [ground[0], ground[1], ground[2] + h / 2],
          size: [l, w, h],
          rotation: [0, 0, 0],
        },
        axisConvention,
      );
      const payload: AnnotationPayload = {
        annotation_type: "box_3d",
        tool_unit_id: LIDAR_TOOL_UNIT,
        class_name: boxPlaceClass,
        geometry,
      };
      createAnnotation.mutate(
        payload,
        {
          onSuccess: (created) => {
            history.push({ kind: "create", annotationId: created.id, payload });
            onSelectBox(created.id);
          },
        },
      );
      onSetThreeDTool("select"); // 单次放置后回到选择工具
    },
    [boxPlaceClass, axisConvention, createAnnotation, history, onSelectBox, onSetThreeDTool],
  );

  // v0.13.9 · 框选画框 (frustum 选点): 在 box 工具下按住拖出屏幕矩形 → 选中投影落在矩形内的真实
  // 点 → 取其 world AABB 建框 (psrFromPoints)。用屏幕投影选点而非投地面平面 → 对物体高度/视角零
  // 视差 (SUSTechPOINTS 范式)。拖动 < 阈值退化为旧的「点击放置固定框」(向后兼容)。
  // 仍建议在俯视(BEV)下框, 框选体验最佳; 但本法不再依赖视角无视差性。
  const handleBoxSelect = useCallback(
    (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const scene = sceneRef.current;
      if (!scene || !boxPlaceClass) return;
      const selected = scene.selectPointsInScreenRect(a.x, a.y, b.x, b.y);
      if (!selected) return; // 框内无点 → 不建框
      const psr = psrFromPoints(selected);
      const geometry = boxGeometryFromPsr(psr, axisConvention);
      const payload: AnnotationPayload = {
        annotation_type: "box_3d",
        tool_unit_id: LIDAR_TOOL_UNIT,
        class_name: boxPlaceClass,
        geometry,
      };
      createAnnotation.mutate(
        payload,
        {
          onSuccess: (created) => {
            history.push({ kind: "create", annotationId: created.id, payload });
            onSelectBox(created.id);
          },
        },
      );
      onSetThreeDTool("select"); // 单次画框后回到选择工具
    },
    [boxPlaceClass, axisConvention, createAnnotation, history, onSelectBox, onSetThreeDTool],
  );

  const applyPointMaskSelection = useCallback(
    (selected: PointMaskSelection | null, subtract: boolean) => {
      if (!selected) return;
      const scene = sceneRef.current;
      if (selectedPointMaskEditable && selectedId && selectedPointMask) {
        const next = new Set(selectedPointMask.point_indices);
        if (subtract) {
          for (const index of selected.pointIndices) next.delete(index);
        } else {
          for (const index of selected.pointIndices) next.add(index);
        }
        const nextIndices = sortedIndices(next);
        const geometry: PointMaskGeometry = {
          ...selectedPointMask,
          point_indices: nextIndices,
        };
        scene?.highlightPointMask(nextIndices);
        updateAnnotationWithHistory(
          selectedId,
          { geometry: selectedPointMask },
          { geometry },
        );
        return;
      }
      if (!pointMaskPlaceClass) return;
      const geometry: PointMaskGeometry = {
        type: "point_mask_3d",
        point_indices: selected.pointIndices,
        convention_at_create: axisConvention,
        decimate_stride: selected.decimateStride,
        source_point_count: selected.sourcePointCount,
      };
      createAnnotation.mutate(
        {
          annotation_type: "point_mask_3d",
          tool_unit_id: POINT_MASK_TOOL_UNIT,
          class_name: pointMaskPlaceClass,
          geometry,
        },
        { onSuccess: (created) => onSelectBox(created.id) },
      );
      onSetThreeDTool("select");
    },
    [
      selectedPointMaskEditable,
      selectedId,
      selectedPointMask,
      updateAnnotationWithHistory,
      pointMaskPlaceClass,
      axisConvention,
      createAnnotation,
      onSelectBox,
      onSetThreeDTool,
    ],
  );

  const handlePointMaskRectSelect = useCallback(
    (a: ScreenPoint, b: ScreenPoint, subtract: boolean) => {
      const scene = sceneRef.current;
      if (!scene) return;
      applyPointMaskSelection(
        scene.selectPointMaskInScreenRect(a.x, a.y, b.x, b.y),
        subtract,
      );
    },
    [applyPointMaskSelection],
  );

  const handlePointMaskPolygonSelect = useCallback(
    (polygon: readonly ScreenPoint[], subtract: boolean) => {
      const scene = sceneRef.current;
      if (!scene || polygon.length < 3) return;
      applyPointMaskSelection(scene.selectPointMaskInScreenPolygon(polygon), subtract);
    },
    [applyPointMaskSelection],
  );

  const finishPointMaskPolygon = useCallback(
    (subtract: boolean) => {
      if (pointMaskPolygonPoints.length < 3) return;
      handlePointMaskPolygonSelect(pointMaskPolygonPoints, subtract);
      setPointMaskPolygonPoints([]);
      setPointMaskCursor(null);
    },
    [handlePointMaskPolygonSelect, pointMaskPolygonPoints],
  );
  finishPointMaskPolygonRef.current = finishPointMaskPolygon;

  const createPastedBox = useCallback(
    (clip: ClipboardBox3D) => {
      if (readOnly) return;
      pasteCountRef.current += 1;
      const offset = 2 * pasteCountRef.current;
      const payload = pasteOffsetPayload(clip, [offset, offset, 0]);
      createAnnotation.mutate(payload, {
        onSuccess: (created) => {
          history.push({ kind: "create", annotationId: created.id, payload });
          onSelectBox(created.id);
        },
      });
    },
    [readOnly, createAnnotation, history, onSelectBox],
  );

  const copySelected = useCallback(() => {
    const clip = serializeBox3D(selectedAnn);
    if (!clip) return;
    clipboardRef.current = clip;
    pasteCountRef.current = 0;
  }, [selectedAnn]);

  const pasteClipboard = useCallback(() => {
    if (!clipboardRef.current) return;
    createPastedBox(clipboardRef.current);
  }, [createPastedBox]);

  const duplicateSelected = useCallback(() => {
    const clip = serializeBox3D(selectedAnn);
    if (!clip) return;
    clipboardRef.current = clip;
    pasteCountRef.current = 0;
    createPastedBox(clip);
  }, [selectedAnn, createPastedBox]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        void history.undo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        void history.redo();
      } else if (key === "c") {
        e.preventDefault();
        copySelected();
      } else if (key === "v") {
        e.preventDefault();
        pasteClipboard();
      } else if (key === "d") {
        e.preventDefault();
        duplicateSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history, copySelected, pasteClipboard, duplicateSelected]);

  // mousedown 落点(像素): click 时若位移超阈值判为「转视角拖拽」, 不改选中/不放置。
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const DRAG_CLICK_TOL = 4; // px
  // v0.13.9 · 框选拖拽起点(client px)与屏上预览矩形(相对 viewportWrap px)。
  const boxSelectStartRef = useRef<{ x: number; y: number } | null>(null);
  const lassoPointsRef = useRef<ScreenPoint[]>([]);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [previewRect, setPreviewRect] = useState<{
    l: number;
    t: number;
    w: number;
    h: number;
  } | null>(null);
  const [previewPath, setPreviewPath] = useState<ScreenPoint[]>([]);

  const handleViewportMouseDown = (e: React.MouseEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
    if (placing || pointMaskDragMode) {
      // 框选: 禁 orbit, 记起点; 实际 move/up 走 window 监听(见下方 effect), 拖出视口也能收尾。
      sceneRef.current?.setBoxSelecting(true);
      boxSelectStartRef.current = { x: e.clientX, y: e.clientY };
      lassoPointsRef.current = pointMaskSelectMode === "lasso" ? [{ x: e.clientX, y: e.clientY }] : [];
      setIsBoxSelecting(true);
    }
  };

  // v0.13.9 · 框选期 window 级 move/up: move 画预览矩形; up 收尾(拖动大 → 框选, 否则 → 点击放置)。
  useEffect(() => {
    if (!isBoxSelecting) return;
    const onMove = (e: MouseEvent) => {
      const start = boxSelectStartRef.current;
      const wrap = viewportRef.current;
      if (!start || !wrap) return;
      const r = wrap.getBoundingClientRect();
      if (pointMasking && pointMaskSelectMode === "lasso") {
        const points = lassoPointsRef.current;
        const last = points[points.length - 1] ?? start;
        if (Math.hypot(e.clientX - last.x, e.clientY - last.y) >= 3) {
          points.push({ x: e.clientX, y: e.clientY });
          setPreviewPath(points.map((p) => ({ x: p.x - r.left, y: p.y - r.top })));
        }
        return;
      }
      setPreviewRect({
        l: Math.min(start.x, e.clientX) - r.left,
        t: Math.min(start.y, e.clientY) - r.top,
        w: Math.abs(e.clientX - start.x),
        h: Math.abs(e.clientY - start.y),
      });
    };
    const onUp = (e: MouseEvent) => {
      const start = boxSelectStartRef.current;
      boxSelectStartRef.current = null;
      sceneRef.current?.setBoxSelecting(false);
      setIsBoxSelecting(false);
      setPreviewRect(null);
      setPreviewPath([]);
      if (!start) return;
      const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (dist <= DRAG_CLICK_TOL) {
        if (placing) handlePlace(e.clientX, e.clientY); // 退化为点击放置
      } else if (placing) {
        handleBoxSelect(start, { x: e.clientX, y: e.clientY });
      } else if (pointMasking && pointMaskSelectMode === "lasso") {
        const points = lassoPointsRef.current;
        lassoPointsRef.current = [];
        handlePointMaskPolygonSelect(points, e.altKey);
      } else if (pointMasking) {
        handlePointMaskRectSelect(start, { x: e.clientX, y: e.clientY }, e.altKey);
      }
    };
    // v0.13.12 · 拖拽期取消: Escape / 右键 → 丢弃这一笔(清起点+预览+scene 状态),
    // 避免 preview 矩形挂着、或落进 up 收尾的全 false 分支被静默丢弃。
    const cancel = () => {
      boxSelectStartRef.current = null;
      sceneRef.current?.setBoxSelecting(false);
      setIsBoxSelecting(false);
      setPreviewRect(null);
      setPreviewPath([]);
      lassoPointsRef.current = [];
    };
    const onCancelKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      cancel();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onCancelKey);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onCancelKey);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, [
    isBoxSelecting,
    placing,
    pointMasking,
    pointMaskSelectMode,
    handlePlace,
    handleBoxSelect,
    handlePointMaskRectSelect,
    handlePointMaskPolygonSelect,
  ]);

  const handleViewportMouseMove = (e: React.MouseEvent) => {
    if (!pointMaskPolygonMode || pointMaskPolygonPoints.length === 0) return;
    const r = viewportRef.current?.getBoundingClientRect();
    if (!r) return;
    setPointMaskCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const handleViewportDoubleClick = (e: React.MouseEvent) => {
    if (!pointMaskPolygonMode) return;
    e.preventDefault();
    finishPointMaskPolygon(e.altKey);
  };

  const handleViewportClick = (e: React.MouseEvent) => {
    if (pointMaskPolygonMode) {
      const down = pointerDownRef.current;
      pointerDownRef.current = null;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_CLICK_TOL) return;
      setPointMaskPolygonPoints((prev) => [...prev, { x: e.clientX, y: e.clientY }]);
      return;
    }
    // 拖拽 gizmo 结束的 click 不应改选中。
    if (sceneRef.current?.shouldIgnoreClick()) return;
    // 放置/框选已全程由 mousedown→window mouseup 接管, click 不再处理放置。
    if (drawingSelection) {
      pointerDownRef.current = null;
      return;
    }
    // OrbitControls 转视角拖拽松手也会触发 click: 位移超阈值视为拖拽, 保持当前选中。
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_CLICK_TOL) return;
    onSelectBox(sceneRef.current?.pickBox(e.clientX, e.clientY) ?? null, { shift: e.shiftKey });
  };

  const handlePointSize = (v: number) => {
    setPointSize(v);
    sceneRef.current?.setPointSize(v);
  };
  const handleResetView = useCallback(() => {
    sceneRef.current?.resetView();
    setPointCloudViewMode("orbit");
  }, []);
  const handleBevView = useCallback(() => {
    sceneRef.current?.bevView();
    setPointCloudViewMode("bev");
  }, []);

  // v0.13.11 · 相机列表的 extrinsic 在 hook 出口处归一化,下游 (frontCameraForward /
  // cameraAnchor / projectPoints / loadCameraSample) 无感知 convention。
  const cameras = useMemo(() => {
    const raw = manifest?.cameras ?? [];
    return raw.map((c) =>
      c.calibration
        ? {
            ...c,
            calibration: {
              ...c.calibration,
              extrinsic: applyConventionToExtrinsic(
                c.calibration.extrinsic,
                axisConvention,
              ) as SensorCalibration["extrinsic"],
            },
          }
        : c,
    );
  }, [manifest?.cameras, axisConvention]);
  // v0.13.7 · 相机按物理朝向分组(悬浮环绕):每个 anchor 一个定位容器,同朝向沿边堆叠。
  const cameraGroups = useMemo(() => {
    const groups = new Map<Anchor, typeof cameras>();
    for (const cam of cameras) {
      const anchor = cameraAnchor(cam.calibration, cam.role || cam.name);
      const arr = groups.get(anchor) ?? [];
      arr.push(cam);
      groups.set(anchor, arr);
    }
    return [...groups.entries()].map(([anchor, cams]) => [
      anchor,
      [...cams].sort((a, b) => (a.role || a.name).localeCompare(b.role || b.name)),
    ] as const);
  }, [cameras]);
  const enlargedIndex = useMemo(
    () => cameras.findIndex((c) => c.role === enlargedRole),
    [cameras, enlargedRole],
  );
  const enlargedCam = useMemo(
    () => (enlargedIndex >= 0 ? cameras[enlargedIndex] : null),
    [cameras, enlargedIndex],
  );
  const cycleEnlargedCamera = useCallback(
    (dir: -1 | 1) => {
      if (cameras.length === 0) return;
      setEnlargedRole((prev) => {
        const idx = cameras.findIndex((c) => c.role === prev);
        const base = idx >= 0 ? idx : (dir > 0 ? -1 : 0);
        const next = (base + dir + cameras.length) % cameras.length;
        return cameras[next].role;
      });
    },
    [cameras],
  );
  // v0.13.7 · resetView 默认视向跟随 front 相机光轴(健壮于任意 lidar 前向约定)。
  // loadPcd 的首次 frameView 在 await fetch 之后异步触发,本同步 effect 必先于其设好前方。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const fwd = frontCameraForward(cameras);
    scene.setViewForward(fwd?.[0] ?? 0, fwd?.[1] ?? 1);
  }, [cameras]);
  // v0.13.7 · 放大浮层:ESC 关闭。
  useEffect(() => {
    if (!enlargedRole) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEnlargedRole(null);
      else if (e.key === "ArrowLeft") {
        e.preventDefault();
        cycleEnlargedCamera(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        cycleEnlargedCamera(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleEnlargedCamera, enlargedRole]);
  // v0.13.6 · 点云坐标(载帧后稳定);供相机视图建深度栅格。stats 变化即点云换帧。
  const pointPositions = useMemo(
    () => (stats ? (sceneRef.current?.getPointPositions() ?? null) : null),
    [stats],
  );

  // v0.13.6 · 相机 RGB 上色:开关开 → 逐点投影到各标定相机采样像素 → 写回点云 color;
  // 关 → 还原高度色带。一次性算(不进每帧),依赖 colorizeOn / cameras / stats(载帧)。
  // 无标定相机自动剔除;getImageData 跨域污染则降级(整相机跳过)。三视图复用同一 geometry 自动跟随。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !stats) return;
    if (!colorizeOn) {
      scene.setPointColors(null);
      return;
    }
    let cancelled = false;
    setColorizing(true);
    (async () => {
      const positions = scene.getPointPositions();
      const calibCams = cameras.filter((c) => c.calibration);
      if (!positions || calibCams.length === 0) {
        if (!cancelled) setColorizing(false);
        return;
      }
      const samples = (
        await Promise.all(calibCams.map((c) => loadCameraSample(c.image_url, c.calibration!)))
      ).filter((s): s is CameraSample => s !== null);
      if (cancelled) return;
      if (samples.length > 0) {
        const colors = await colorizePointsAsync(positions, scene.getBaseColors(), samples);
        if (!cancelled) scene.setPointColors(colors);
      }
      if (!cancelled) setColorizing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [colorizeOn, cameras, stats]);

  useEffect(() => {
    sceneRef.current?.highlightPointMask(selectedPointMask?.point_indices ?? null);
  }, [selectedPointMask?.point_indices, stats]);

  // v0.13.4 · 跨模态高亮集合:选中框 + 同 group_id 成员。3D 主视图仍按 selected 单框高亮,
  // overlay 按本集合高亮(为未来同组 2D 框成员预留;孤立框 group_id 为空时退化为仅选中本身)。
  const selectedGroupId = selectedAnn?.group_id ?? null;
  const highlightedIds = useMemo(() => {
    const s = new Set<string>();
    for (const id of selectedIds) s.add(id);
    if (selectedGroupId != null) {
      for (const a of annotations ?? []) {
        if (a.group_id === selectedGroupId) s.add(a.id);
      }
    }
    return s;
  }, [selectedIds, selectedGroupId, annotations]);

  // v0.14.1 · 邻帧参考框叠加: overlayK 控制前后各拉多少帧(0=关)。per scene 持久化到
  // localStorage; 选中某框 + 该框有 group_id 时, 拉同 group_id 的邻帧框作半透明参考。
  const [overlayK, setOverlayK] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const raw = window.localStorage.getItem(CROSS_FRAME_OVERLAY_K_KEY);
    const n = raw ? Number(raw) : 0;
    return [0, 1, 3, 5, 7].includes(n) ? n : 0;
  });
  const setOverlayKPersist = useCallback((k: number) => {
    setOverlayK(k);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CROSS_FRAME_OVERLAY_K_KEY, String(k));
    }
  }, []);
  const { data: neighborsData } = useFrameNeighbors(
    overlayK > 0 ? taskId : null,
    Math.max(1, overlayK),
  );
  const neighborTaskIds = useMemo(() => {
    if (overlayK <= 0 || !neighborsData) return [];
    return [
      ...(neighborsData.prev ?? []),
      ...(neighborsData.next ?? []),
    ].map((n) => n.task_id);
  }, [overlayK, neighborsData]);
  const { byTask: neighborAnnsByTask } = useNeighborAnnotations(
    neighborTaskIds,
    overlayK > 0 ? selectedGroupId : null,
  );
  // v0.15.1 · overlay ego 对齐: 邻帧框经 trajectory 变换到当前帧 ego 系再叠加,
  // 静止物参考框与当前帧重合。无轨迹 scene → poseByFrame=null,退回原样叠加。
  const { poseByFrame } = useSceneTrajectory(
    overlayK > 0 ? (neighborsData?.scene_id ?? null) : null,
  );
  const neighborFrameByTask = useMemo<Map<string, number>>(() => {
    if (!neighborsData) return new Map();
    return new Map(
      [...(neighborsData.prev ?? []), ...(neighborsData.next ?? [])].map((n) => [
        n.task_id,
        n.frame_index,
      ]),
    );
  }, [neighborsData]);
  const referenceBoxes = useMemo<ReferenceBox[]>(() => {
    if (overlayK <= 0 || selectedGroupId == null) return [];
    const curFrame = neighborsData?.frame_index ?? null;
    const out: ReferenceBox[] = [];
    for (const tid of neighborTaskIds) {
      for (const a of neighborAnnsByTask[tid] ?? []) {
        const g = a.geometry as {
          type?: string;
          center?: number[];
          size?: number[];
          rotation?: number[];
        };
        if (g?.type !== "box_3d" || !g.center || !g.size || !g.rotation) continue;
        let center = g.center as [number, number, number];
        let rotation = g.rotation as [number, number, number];
        if (poseByFrame && curFrame != null) {
          const nbrFrame = neighborFrameByTask.get(tid);
          const aligned = alignPsrToFrame(
            { center, rotation },
            nbrFrame != null ? poseByFrame.get(nbrFrame) : undefined,
            poseByFrame.get(curFrame),
          );
          if (aligned) {
            center = aligned.center;
            rotation = aligned.rotation;
          }
        }
        out.push({
          id: `${tid}:${a.id}`,
          center,
          size: g.size.map((v) => Math.abs(v)) as [number, number, number],
          rotation,
          color: classColorForCanvas(a.class_name),
        });
      }
    }
    return out;
  }, [
    overlayK,
    selectedGroupId,
    neighborTaskIds,
    neighborAnnsByTask,
    neighborsData,
    poseByFrame,
    neighborFrameByTask,
  ]);
  useEffect(() => {
    sceneRef.current?.setReferenceBoxes(referenceBoxes);
  }, [referenceBoxes]);

  // v0.13.4 · 选中框被哪些相机看到(可见角点数 > 0),按可见角点数降序;首个 = 最正对。
  const selectedCameraVis = useMemo(() => {
    if (!selectedBox) return [] as { role: string; name: string; count: number }[];
    const corners = psrToCorners(selectedBox.center, selectedBox.size, selectedBox.rotation);
    return cameras
      .filter((c) => c.calibration)
      .map((c) => ({
        role: c.role,
        name: c.name,
        count: projectPoints(corners, c.calibration!).visible.filter(Boolean).length,
      }))
      .filter((v) => v.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [selectedBox, cameras]);
  const bestCameraRole = selectedCameraVis[0]?.role ?? null;

  // v0.13.5 · 三视图复用主场景点 geometry (零拷贝); selected 仅在 PSR/色变化时换引用,
  // 避免每次 render 触发 TriViewRenderer.setBox。
  const getPointsGeometry = useCallback(
    () => sceneRef.current?.getPointsGeometry() ?? null,
    [],
  );
  const triSelected = useMemo<TriSelected | null>(
    () =>
      selectedBox && !multiBoxSelected
        ? {
            center: selectedBox.center,
            size: selectedBox.size,
            rotation: selectedBox.rotation,
            color: selectedBox.color,
          }
        : null,
    [selectedBox, multiBoxSelected],
  );

  // v0.13.5 · 三视图拖边/角回写: 拖拽中 (commit=false) 只更新本地草稿 (实时四方同步);
  // 松手 (commit=true) 走与 gizmo 同一条 PATCH 管线持久化, 并清草稿 (乐观更新已写入缓存)。
  const handleEditPsr = useCallback(
    (psr: Psr, commit: boolean) => {
      if (!selectedId) return;
      const center: [number, number, number] = [psr.center[0], psr.center[1], psr.center[2]];
      const size: [number, number, number] = [psr.size[0], psr.size[1], psr.size[2]];
      const rotation: [number, number, number] = [psr.rotation[0], psr.rotation[1], psr.rotation[2]];
      setForm(psrToForm({ center, size, rotation }));
      if (commit) {
        setDraftPsr(null);
        const geometry = boxGeometryFromPsr(
          { center, size, rotation },
          geometryConvention(selectedAnn?.geometry, axisConvention),
        );
        updateAnnotationWithHistory(
          selectedId,
          selectedAnn?.geometry?.type === "box_3d" ? { geometry: selectedAnn.geometry } : {},
          { geometry },
        );
      } else {
        setDraftPsr({ id: selectedId, psr });
      }
    },
    [selectedId, selectedAnn?.geometry, axisConvention, updateAnnotationWithHistory],
  );

  const handleReprojectSelectedToCurrentConvention = useCallback(() => {
    if (!selectedId || !selectedBox || !selectedConventionMismatch || !selectedEditable) return;
    const src = unapplyConventionToPsr(
      {
        center: selectedBox.center,
        size: selectedBox.size,
        rotation: selectedBox.rotation,
      },
      selectedConventionMismatch,
    );
    const next = applyConventionToPsr(src, axisConvention);
    const geometry = boxGeometryFromPsr(next, axisConvention);
    setForm(psrToForm(next));
    updateAnnotationWithHistory(
      selectedId,
      selectedAnn?.geometry?.type === "box_3d" ? { geometry: selectedAnn.geometry } : {},
      { geometry },
    );
  }, [
    selectedId,
    selectedBox,
    selectedConventionMismatch,
    selectedEditable,
    axisConvention,
    selectedAnn?.geometry,
    updateAnnotationWithHistory,
  ]);

  return (
    <div className={styles.root}>
      <div ref={viewportWrapRef} className={styles.viewportWrap}>
        <div
          ref={viewportRef}
          className={drawingSelection ? `${styles.viewport} ${styles.placing}` : styles.viewport}
          data-testid="pc-viewport"
          onMouseDown={handleViewportMouseDown}
          onMouseMove={handleViewportMouseMove}
          onClick={handleViewportClick}
          onDoubleClick={handleViewportDoubleClick}
        />

        {/* v0.13.9 · 框选预览矩形(地面 footprint), 仅拖拽期出现, 不拦事件。 */}
        {previewRect && (
          <div
            className={styles.boxSelectRect}
            // eslint-disable-next-line no-restricted-syntax -- 框选预览矩形位置/尺寸是逐帧动态值, 经 CSS custom property 注入
            style={
              {
                "--rect-l": `${previewRect.l}px`,
                "--rect-t": `${previewRect.t}px`,
                "--rect-w": `${previewRect.w}px`,
                "--rect-h": `${previewRect.h}px`,
              } as BoxSelectRectVars
            }
          />
        )}
        {(previewPath.length > 0 || pointMaskPolygonPoints.length > 0) && (() => {
          const r = viewportRef.current?.getBoundingClientRect();
          const draft = r
            ? pointMaskPolygonPoints.map((p) => ({ x: p.x - r.left, y: p.y - r.top }))
            : [];
          const points = previewPath.length > 0
            ? previewPath
            : [...draft, ...(pointMaskCursor ? [pointMaskCursor] : [])];
          const svgPoints = points.map((p) => `${p.x},${p.y}`).join(" ");
          return (
            <svg className={styles.pointMaskPathPreview} aria-hidden="true">
              <polyline points={svgPoints} />
              {draft.map((p, i) => (
                <circle key={`${p.x}:${p.y}:${i}`} cx={p.x} cy={p.y} r="3" />
              ))}
            </svg>
          );
        })()}

        {/* 控件浮条 */}
        <div ref={controlsRef} className={styles.controls}>
          <button
            type="button"
            className={styles.btn}
            onClick={handleResetView}
          >
            重置视角
          </button>
          <button
            type="button"
            className={`${styles.btn} ${pointCloudViewMode === "bev" ? styles.btnActive : ""}`}
            onClick={handleBevView}
            aria-pressed={pointCloudViewMode === "bev"}
          >
            俯视
          </button>
          <label className={styles.sizeCtl}>
            点大小
            <input
              type="range"
              min={0.01}
              max={0.3}
              step={0.01}
              value={pointSize}
              onChange={(e) => handlePointSize(Number(e.target.value))}
            />
          </label>
          {cameras.some((c) => c.calibration) && (
            <>
              <label className={styles.sizeCtl}>
                <input
                  type="checkbox"
                  checked={colorizeOn}
                  onChange={(e) => setColorizeOn(e.target.checked)}
                />
                相机上色{colorizing ? "…" : ""}
              </label>
              <label className={styles.sizeCtl}>
                <input
                  type="checkbox"
                  checked={depthOn}
                  onChange={(e) => setDepthOn(e.target.checked)}
                />
                深度提示
              </label>
            </>
          )}
          {threeDTool === "point-mask" && (
            <label className={styles.sizeCtl}>
              选点
              <select
                className={styles.selectCtl}
                value={pointMaskSelectMode}
                disabled={!canPlacePointMask}
                onChange={(e) => setPointMaskSelectMode(e.target.value as PointMaskSelectMode)}
              >
                <option value="rect">矩形</option>
                <option value="lasso">套索</option>
                <option value="polygon">多边形</option>
              </select>
            </label>
          )}
          {manifest?.scene_id && (
            <CrossFrameOverlayToggle value={overlayK} onChange={setOverlayKPersist} />
          )}
          {manifest?.scene_id && taskId && (
            <CrossFrameInterpolateBar
              taskId={taskId}
              frameIndex={manifest.frame_index ?? null}
              sceneTotalFrames={manifest.scene_total_frames ?? null}
              selectedGroupId={selectedGroupId}
              selectedIsBox3d={!!selectedBox}
              readOnly={readOnly}
              onPropagateBatch={onCrossFramePropagateBatch}
              onPropagateToTask={onCrossFramePropagateToTask}
              onInterpolate={onCrossFrameInterpolate}
              pushToast={pushToast}
            />
          )}
        </div>

        {conventionMismatches.length > 0 && (
          <div className={styles.mismatchBanner}>
            <span>
              {conventionMismatches.length} 个 3D 标注创建时的坐标系与当前数据集不一致。
            </span>
            <button
              type="button"
              className={styles.btn}
              disabled={!selectedConventionMismatch || !selectedEditable}
              onClick={handleReprojectSelectedToCurrentConvention}
            >
              按当前约定重投影选中
            </button>
          </div>
        )}

        {/* 状态条 */}
        <div className={styles.statusBar}>
          {isLoading && <span>加载 manifest…</span>}
          {error && <span className={styles.err}>manifest 加载失败</span>}
          {loadError && <span className={styles.err}>点云加载失败: {loadError}</span>}
          {stats && (
            <span>
              {stats.renderedPoints.toLocaleString()} 点
              {stats.decimated && `(已抽稀自 ${stats.totalPoints.toLocaleString()})`}
            </span>
          )}
          {boxes.length > 0 && <span>· {boxes.length} 框</span>}
          {pointMasks.length > 0 && <span>· {pointMasks.length} 分割</span>}
          {placing && (
            <span>· 拖框选 / 点击放置 {boxPlaceClass ?? ""} · V/Esc 取消</span>
          )}
          {pointMasking && (
            <span>
              · {pointMaskSelectMode === "polygon" ? "点击多边形闭合" : "拖动选点"}
              {selectedPointMaskEditable ? "编辑分割(Alt 减点)" : `生成分割 ${pointMaskPlaceClass ?? ""}`}
              · V/Esc 取消
            </span>
          )}
          {threeDTool === "point-mask" && !canPlacePointMask && (
            <span className={styles.err}>· 当前项目未启用 point_mask_3d 类别</span>
          )}
          {selectedBox && (
            <span>
              · 选中 {selectedClass ?? ""} 中心 [
              {selectedBox.center.map((n) => n.toFixed(2)).join(", ")}]
            </span>
          )}
          {selectedBox && selectedCameraVis.length > 0 && (
            <span>
              · 投影可见于 {selectedCameraVis.length} 相机 · 正对 {selectedCameraVis[0].name}
            </span>
          )}
        </div>

        {/* 选中框 PSR 数值编辑面板(右上) */}
        {selectedBox && form && (
          <div className={styles.editPanel}>
            <div className={styles.editTitle}>
              {boxClasses.length > 0 ? (
                <select
                  className={styles.classSelect}
                  value={selectedClass ?? ""}
                  aria-label="框类别"
                  disabled={!selectedEditable}
                  onChange={(e) => handleChangeClass(e.target.value)}
                >
                  {/* 当前类别若不在配置集合内(历史数据)仍可见,不丢选中项 */}
                  {selectedClass && !boxClasses.includes(selectedClass) && (
                    <option value={selectedClass}>{selectedClass}</option>
                  )}
                  {boxClasses.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <span>3D 框 · {selectedClass ?? ""}</span>
              )}
              {!readOnly && (
                <button
                  type="button"
                  className={selectedLocked ? `${styles.lockBtn} ${styles.lockBtnOn}` : styles.lockBtn}
                  aria-pressed={selectedLocked}
                  onClick={handleToggleLock}
                >
                  {selectedLocked ? "已锁定" : "锁定"}
                </button>
              )}
            </div>
            <div className={styles.editGroupLabel}>
              {readOnly
                ? "只读 · 锁定 / 审阅态"
                : multiBoxSelected
                  ? `${selectedBoxIds.length} 个框已选中 · 可批量改类 / 删除`
                  : selectedLocked
                  ? "已锁定 · 点「已锁定」解锁后可编辑"
                  : "拖 gizmo 或改数值 · W 平移 / E 转 / R 缩放"}
            </div>
            {/* v0.13.8 · 选中框自动贴合:Q 默认连击(收尺寸+贴地);
                Shift+Q 仅收尺寸;Alt+Q 仅贴地;朝向(实验)仅按钮触发。 */}
            {selectedPsrEditable && (
              <div className={styles.fitGroup} role="group" aria-label="自动贴合">
                <button
                  type="button"
                  className={styles.btn}
                  onClick={handleFitDefault}
                  title="贴合 (Q):收尺寸 + 贴地"
                >
                  贴合
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={handleFitSize}
                  title="只收尺寸 (Shift+Q)"
                >
                  收尺寸
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={handleFitBottom}
                  title="只贴地 (Alt+Q)"
                >
                  贴地
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={handleFitYaw}
                  title="贴朝向(实验):点云稀疏时主轴可能反转 180°"
                >
                  朝向⚗
                </button>
              </div>
            )}
            {PSR_GROUPS.map((g) => (
              <div key={g.label}>
                <div className={styles.editGroupLabelRow}>
                  <span className={styles.editGroupLabel}>{g.label}</span>
                  {g.reset && selectedPsrEditable && (
                    <button
                      type="button"
                      className={styles.resetBtn}
                      onClick={handleResetRotation}
                      title="把偏航/俯仰/翻滚全部归零"
                    >
                      归零
                    </button>
                  )}
                </div>
                <div className={styles.editRow}>
                  {g.keys.map((k) => (
                    <input
                      key={k}
                      type="number"
                      step={g.step}
                      min={g.min}
                      value={form[k]}
                      aria-label={k}
                      disabled={!selectedPsrEditable}
                      onChange={(e) => handleField(k, e.target.value)}
                      onBlur={() => handleFieldBlur(k)}
                    />
                  ))}
                </div>
              </div>
            ))}
            {!multiBoxSelected && (
              <AttributeForm
                schema={boxAttributeSchema}
                className={selectedClass ?? ""}
                attributes={selectedAnn?.attributes ?? {}}
                readOnly={!selectedEditable}
                onChange={handleChangeAttributes}
              />
            )}
            {!readOnly && selectedBoxIds.length > 0 && (
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={handleDeleteSelected}
              >
                {multiBoxSelected ? `删除选中 ${selectedBoxIds.length} 个框` : "删除框"}
              </button>
            )}
          </div>
        )}

        {selectedPointMask && selectedAnn && (
          <div className={styles.editPanel}>
            <div className={styles.editTitle}>
              {pointMaskClasses.length > 0 ? (
                <select
                  className={styles.classSelect}
                  value={selectedClass ?? ""}
                  aria-label="分割类别"
                  disabled={!selectedPointMaskEditable}
                  onChange={(e) => handleChangeClass(e.target.value)}
                >
                  {selectedClass && !pointMaskClasses.includes(selectedClass) && (
                    <option value={selectedClass}>{selectedClass}</option>
                  )}
                  {pointMaskClasses.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <span>点云分割 · {selectedClass ?? ""}</span>
              )}
              {!readOnly && (
                <button
                  type="button"
                  className={selectedLocked ? `${styles.lockBtn} ${styles.lockBtnOn}` : styles.lockBtn}
                  aria-pressed={selectedLocked}
                  onClick={handleToggleLock}
                >
                  {selectedLocked ? "已锁定" : "锁定"}
                </button>
              )}
            </div>
            <div className={styles.editGroupLabel}>
              {selectedPointMask.point_indices.length.toLocaleString()} 点 · P 后圈选加点,Alt 圈选减点
            </div>
            {!readOnly && selectedPointMaskEditable && (
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={() => {
                  deleteAnnotation.mutate(selectedAnn.id);
                  history.pushBatch([{ kind: "delete", annotation: selectedAnn }]);
                  onSelectBox(null);
                }}
              >
                删除分割
              </button>
            )}
          </div>
        )}

        {/* v0.13.7 · 三正交视图精修浮层(右下):选中框才浮出,可收成小标签。 */}
        {triSelected && !triViewFloat.collapsed && (
          <FloatingPanelShell
            title="三视图精修"
            position={triFloatPosition}
            onPositionChange={updateTriViewFloat}
            onCollapse={() => updateTriViewFloat({ collapsed: true })}
            variant="no-merge"
            minSize={{ w: 200, h: 240 }}
            maxSize={{ w: 480, h: 720 }}
            bounds={triFloatBounds}
          >
            <TriViewPanel
              selected={triSelected}
              getPointsGeometry={getPointsGeometry}
              pointsReady={!!stats}
              editable={selectedPsrEditable}
              pointSize={pointSize}
              onEditPsr={handleEditPsr}
            />
          </FloatingPanelShell>
        )}
        {triSelected && triViewFloat.collapsed && (
          <button
            type="button"
            className={styles.triFloatTab}
            onClick={() => updateTriViewFloat({ collapsed: false })}
          >
            三视图 ▸
          </button>
        )}

        {/* v0.13.7 · 悬浮相机面板:按物理朝向贴主视图边缘,同朝向沿边堆叠。
            投影 overlay / 上色 / 深度命中沿用 CameraProjectionView,布局对其透明。 */}
        {cameraGroups.map(([anchor, cams]) => (
          <div key={anchor} className={`${styles.camGroup} ${ANCHOR_CLASS[anchor]}`}>
            {cams.map((cam, index) => (
              <FloatingCameraPanel
                key={cam.role}
                role={cam.role}
                name={cam.name}
                imageUrl={cam.image_url}
                calibration={cam.calibration}
                boxes={boxes}
                highlightedIds={highlightedIds}
                onSelectBox={onSelectBox}
                bestForSelected={cam.role === bestCameraRole}
                pointPositions={pointPositions}
                showDepth={depthOn}
                onEnlarge={() => setEnlargedRole(cam.role)}
                autoCollapsed={autoCollapseCameras || index >= CAMERA_STACK_VISIBLE}
                dragBounds={triFloatBounds}
                position={
                  cameraPanels[cam.role]?.x != null &&
                  cameraPanels[cam.role]?.y != null
                    ? {
                        x: cameraPanels[cam.role]!.x!,
                        y: cameraPanels[cam.role]!.y!,
                      }
                    : null
                }
                collapsed={cameraPanels[cam.role]?.collapsed}
                onPositionChange={handleCameraPanelPosition}
                onCollapsedChange={handleCameraPanelCollapsed}
              />
            ))}
          </div>
        ))}

        {/* v0.13.7 · 相机放大浮层(L3):点⛶弹大图,遮罩 / 关闭钮 / ESC 关闭。
            复用 CameraProjectionView(同 props,大尺寸),投影 / 上色 / 深度 overlay 一致。 */}
        {enlargedCam && (
          <div
            className={styles.camModal}
            onClick={() => setEnlargedRole(null)}
            role="presentation"
          >
            <div
              className={styles.camModalBody}
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              <button
                type="button"
                className={styles.camModalClose}
                onClick={() => setEnlargedRole(null)}
              >
                关闭 ✕
              </button>
              {cameras.length > 1 && (
                <>
                  <button
                    type="button"
                    className={`${styles.camModalSwitch} ${styles.camModalPrev}`}
                    onClick={() => cycleEnlargedCamera(-1)}
                    title="上一视角"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className={`${styles.camModalSwitch} ${styles.camModalNext}`}
                    onClick={() => cycleEnlargedCamera(1)}
                    title="下一视角"
                  >
                    ›
                  </button>
                </>
              )}
              <CameraProjectionView
                name={enlargedCam.name}
                imageUrl={enlargedCam.image_url}
                calibration={enlargedCam.calibration}
                boxes={boxes}
                highlightedIds={highlightedIds}
                onSelectBox={onSelectBox}
                bestForSelected={enlargedCam.role === bestCameraRole}
                pointPositions={pointPositions}
                showDepth={depthOn}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ThreeDWorkbench;

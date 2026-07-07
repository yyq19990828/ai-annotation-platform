/**
 * v0.13.2 · 点云查看器(只读 MVP)。
 *
 * 拉 point-cloud manifest → 用裸 Three.js(PointCloudScene)渲染主点云 + OrbitControls,
 * 旁边平铺各相机图(只读,不画投影框 —— 投影联动是 v0.13.4)。与 Konva 2D 工作台双栈隔离。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import type {
  CameraPanelState,
  PointcloudCameraState,
  TriViewFloatState,
  WorkbenchCommonPreferences,
  WorkbenchPointcloudPreferences,
} from "@/api/auth";
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
import { useNeighborPointClouds } from "@/hooks/useNeighborPointClouds";
import { useSceneTrajectory } from "@/hooks/useSceneTrajectory";
import { alignPsrToFrame, frameRelMatrix } from "./geometry/egoAlign";
import { cullPointsInBoxes } from "./geometry/cullDynamicPoints";
import {
  alignNeighborPointsPerObject,
  type AlignNeighborBox,
  type AlignPsr,
} from "./geometry/perObjectAlign";
import { useToastStore } from "@/components/ui/Toast";
import { useAuthStore } from "@/stores/authStore";
import { classColorForCanvas, displayClassName } from "@/pages/Workbench/stage/colors";
import {
  buildTrackLabelText,
  shouldShowLabel,
} from "@/pages/Workbench/stage/annotationVisual";
import type { ThreeDTool } from "@/pages/Workbench/state/useWorkbenchState";
import type { WorkbenchConfigPatch, WorkbenchLayoutPatch } from "@/pages/Workbench/state/useWorkbenchConfig";
import type { PointMaskGeometry, SensorCalibration } from "@/types";

import { AttributeForm } from "../../shell/AttributeForm";
import { FloatingPanelShell, type FloatingPanelRect } from "../../shell/FloatingPanelShell";
import { useDragMove, type FloatingPanelBounds } from "../../shell/useDragMove";
import { usePointCloudManifest } from "./usePointCloudManifest";
import {
  type BoxPsr,
  type PointCloudScene,
  type PointMaskSelection,
  type SceneBox,
  type ReferenceBox,
} from "./PointCloudScene";
import { usePointCloudScene } from "./usePointCloudScene";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { Icon } from "@/components/ui/Icon";
import { useCanvasContextMenu } from "../../stage/useCanvasContextMenu";
import { ClassPickerPopover } from "../../shell/ClassPickerPopover";
import { buildThreeDBoxContextMenuItems, buildThreeDEmptyContextMenuItems } from "./threeDContextMenu";
import { FramePicker, type FramePickerMode } from "./FramePicker";
import CameraProjectionView from "./CameraProjectionView";
import FloatingCameraPanel from "./FloatingCameraPanel";
import TriViewPanel from "./TriViewPanel";
import type { TriSelected } from "./TriOrthoView";
import type { Psr } from "./geometry/triview";
import { psrToCorners } from "./geometry/box3d";
import { cameraAnchor, type Anchor } from "./geometry/cameraAnchor";
import {
  adjustColors,
  isNeutralAdjust,
  type CameraSample,
  type ColorAdjust,
} from "./geometry/colorize";
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
  centralRay,
  depthGate,
  gatherPoints,
  selectPointsInRect,
  type SeedRect,
} from "./geometry/frustum";
import {
  applyConventionToPsr,
  applyConventionToExtrinsic,
  type LidarAxisConvention,
  unapplyConventionToPsr,
} from "./geometry/axisConvention";
import {
  box3dAttributeSchema,
} from "./geometry/box3dAttributes";
import {
  pasteOffsetPayload,
  serializeBox3D,
  type ClipboardBox3D,
} from "./geometry/box3dClipboard";
import { useThreeDHistory } from "./useThreeDHistory";
import {
  buildPointcloudLegacyMigration,
  finishPointcloudLegacyMigration,
  isCrossFrameOverlayK,
  isPointMaskSelectMode,
} from "./pointcloudPreferenceStorage";
import { usePsrFloatingPanel } from "./usePsrFloatingPanel";
import { usePsrPatchPipeline } from "./usePsrPatchPipeline";
import { useCameraPanels } from "./useCameraPanels";
import { resolveWorkbenchPerformanceTier } from "../../state/performanceTier";
import { useElementStyle } from "@/components/ui/useElementStyle";

// v0.17.6 · Tailwind class constants (was ThreeDWorkbench.module.css).
const ROOT = "flex flex-col size-full min-h-0 bg-background";
const VIEWPORT_WRAP = "relative flex-1 min-h-0";
const VIEWPORT = "absolute inset-0";
const PLACING = "cursor-crosshair";
const BOX_SELECT_RECT =
  "absolute left-[var(--rect-l)] top-[var(--rect-t)] w-[var(--rect-w)] h-[var(--rect-h)] z-local-3 pointer-events-none border border-brand bg-brand/10 opacity-50";
const POINT_MASK_PATH_PREVIEW = "absolute inset-0 z-local-3 size-full pointer-events-none";
const CONTROLS =
  "absolute top-3 left-3 z-local-4 flex flex-wrap items-center gap-3 max-w-[calc(100%-24px)] px-2.5 py-1.5 rounded-md bg-card border border-border shadow-sm";
const BTN =
  "appearance-none px-2.5 py-1 rounded-sm border border-border bg-background text-foreground cursor-pointer text-sm hover:border-brand hover:text-brand disabled:text-muted-foreground/65 disabled:cursor-not-allowed disabled:opacity-65";
const BTN_ACTIVE = "!border-brand !bg-brand/10 !text-brand";
const SIZE_CTL = "flex items-center gap-1.5 text-xs text-muted-foreground";
const SELECT_CTL =
  "appearance-none min-w-[84px] px-1.5 py-1 rounded-sm border border-border bg-background text-foreground text-xs";
const FIT_GROUP = "grid grid-cols-2 items-center gap-1.5 py-1.5 border-y border-border [&_button]:w-full [&_button]:px-1.5 [&_button]:py-1 [&_button]:text-xs";
const STATUS_BAR =
  "absolute bottom-3 left-3.5 flex flex-wrap gap-2 max-w-[min(420px,calc(100%-28px))] px-2.5 py-1 rounded-sm bg-card border border-border text-xs text-muted-foreground";
const ERR = "text-status-danger";
const MISMATCH_BANNER =
  "absolute top-[calc(var(--top-toolbar-height)+24px)] left-3 z-local-4 flex flex-wrap items-center gap-2 max-w-[min(640px,calc(100%-24px))] px-2.5 py-1.5 text-status-caution text-xs bg-card border border-amber-600 dark:border-amber-400 rounded-md shadow-sm";
const EDIT_PANEL =
  "absolute top-3 right-3 w-[210px] translate-x-[var(--psr-dx)] translate-y-[var(--psr-dy)] flex flex-col gap-1.5 p-2.5 rounded-md bg-card border border-border shadow-sm text-xs text-foreground";
const EDIT_PANEL_DRAGGING = "select-none";
const EDIT_HEADER = "flex flex-col gap-1 cursor-grab";
const DRAG_HINT = "shrink-0 text-muted-foreground";
const ICON_BTN =
  "shrink-0 inline-flex items-center justify-center px-1 py-0.5 rounded-sm border border-border bg-background text-muted-foreground cursor-pointer hover:border-brand hover:text-brand";
const EDIT_SUMMARY = "text-xs text-muted-foreground";
const EDIT_BODY = "flex flex-col gap-1.5";
const EDIT_TITLE = "flex items-center justify-between gap-1.5 text-sm font-semibold";
const CLASS_SELECT =
  "appearance-none flex-1 min-w-0 px-1.5 py-0.5 rounded-sm border border-border bg-background text-foreground text-xs";
const LOCK_BTN =
  "appearance-none shrink-0 px-2 py-0.5 rounded-sm border border-border bg-background text-muted-foreground cursor-pointer text-xs hover:border-brand hover:text-brand";
const LOCK_BTN_ON = "!border-brand !text-brand";
const EDIT_GROUP_LABEL = "mt-1 text-muted-foreground";
const EDIT_GROUP_LABEL_ROW = "flex items-center justify-between gap-1.5";
const RESET_BTN =
  "appearance-none shrink-0 px-2 py-px rounded-sm border border-border bg-background text-muted-foreground cursor-pointer text-xs hover:border-brand hover:text-brand";
const EDIT_ROW = "flex gap-1.5 [&_input]:flex-1 [&_input]:min-w-0 [&_input]:px-1.5 [&_input]:py-1 [&_input]:rounded-sm [&_input]:border [&_input]:border-border [&_input]:bg-background [&_input]:text-foreground [&_input]:text-xs";
const DELETE_BTN =
  "appearance-none mt-1.5 px-2.5 py-1 rounded-sm border border-rose-600 dark:border-rose-400 bg-transparent text-status-danger cursor-pointer text-xs hover:bg-rose-600 dark:hover:bg-rose-400 hover:text-white dark:hover:text-white";
const TRI_FLOAT_TAB =
  "fixed left-[var(--tri-tab-x)] top-[var(--tri-tab-y)] z-local-6 px-2.5 py-1.5 rounded-md border border-border bg-card shadow-sm text-foreground cursor-grab text-xs select-none touch-none hover:border-brand hover:text-brand";
const TRI_FLOAT_TAB_DRAGGING = "!cursor-grabbing !border-brand shadow-md";
const CAM_GROUP =
  "absolute z-local-3 flex gap-2.5 max-h-[calc(100%-var(--top-toolbar-height)-48px)] overflow-visible pointer-events-none [&>*]:pointer-events-auto";
const CAM_MODAL =
  "absolute inset-0 z-base flex items-center justify-center bg-black/70";
const CAM_MODAL_BODY =
  "relative p-3 rounded-md border border-border bg-card shadow-sm [&_figure_img]:w-auto [&_figure_img]:h-[70vh] [&_figure_img]:max-w-[88vw]";
const CAM_MODAL_CLOSE =
  "absolute top-4 right-4 z-local-1 appearance-none px-2.5 py-1 rounded-sm border border-border bg-background text-foreground cursor-pointer text-xs hover:border-brand hover:text-brand";
const CAM_MODAL_SEED =
  "absolute top-4 left-4 z-local-1 appearance-none px-2.5 py-1 rounded-sm border border-border bg-background text-foreground cursor-pointer text-xs hover:border-brand hover:text-brand";
const CAM_MODAL_SEED_ACTIVE = "!border-brand !bg-brand/10 !text-brand";
const CAM_MODAL_SWITCH =
  "absolute top-1/2 z-local-1 w-9 h-12 -translate-y-1/2 rounded-md border border-border bg-background text-foreground cursor-pointer text-control-xl leading-none hover:border-brand hover:text-brand";
const CAM_MODAL_PREV = "left-4";
const CAM_MODAL_NEXT = "right-4";
import {
  ANCHOR_CLASS,
  CAMERA_STACK_VISIBLE,
  IDENTITY_MATRIX,
  LIDAR_TOOL_UNIT,
  POINT_MASK_TOOL_UNIT,
  PSR_GROUPS,
  SEED_FALLBACK_RANGE_M,
  TRI_TAB_DRAG_SIZE,
  TRI_TAB_DRAG_THRESHOLD,
  boxGeometryFromPsr,
  frontCameraForward,
  geometryConvention,
  isPsrFieldBad,
  loadCameraSample,
  psrToForm,
  resolveBox3dDefaultSize,
  resolveTriViewFloatRect,
  sortedIndices,
  type PsrField,
} from "./ThreeDWorkbench.helpers";

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
  /** v0.15.1 · 区间插值填充(当前 task 为起点帧)。v0.21.2 · 按 track_id 认链。 */
  onCrossFrameInterpolate: (trackId: string, toTaskId: string) => void;
  /** v0.13.10 · 右栏避让与三视图浮窗持久化。 */
  rightSidebarOpen: boolean;
  rightSidebarWidth: number;
  triViewFloat: TriViewFloatState;
  /** v0.15.x · 悬浮相机面板位置 + 折叠态(按相机 role 分桶,迁自旧 localStorage)。 */
  cameraPanels: Record<string, CameraPanelState>;
  pointcloudCamera: PointcloudCameraState | null;
  onWorkbenchLayoutChange: (patch: WorkbenchLayoutPatch) => void;
  workbenchCommon: WorkbenchCommonPreferences;
  workbenchPointcloud: WorkbenchPointcloudPreferences;
  workbenchConfigLoaded: boolean;
  onWorkbenchConfigChange: (patch: WorkbenchConfigPatch) => void;
  onWorkbenchConfigUpdate: (patch: WorkbenchConfigPatch) => Promise<void>;
  box3dDefaultSize?: [number, number, number] | null;
}


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
  pointcloudCamera,
  onWorkbenchLayoutChange,
  workbenchCommon,
  workbenchPointcloud,
  workbenchConfigLoaded,
  onWorkbenchConfigChange,
  onWorkbenchConfigUpdate,
  box3dDefaultSize,
}: ThreeDWorkbenchProps) {
  const { data: manifest, isLoading, error } = usePointCloudManifest(taskId, true);
  const pushToast = useToastStore((st) => st.push);
  const userId = useAuthStore((s) => s.user?.id ?? null);
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
  // 场景实例 ref —— 壳层各交互 handler 共用;生命周期由 usePointCloudScene 管理。
  const sceneRef = useRef<PointCloudScene | null>(null);
  const performanceConfig = useMemo(
    () => resolveWorkbenchPerformanceTier(workbenchCommon.performanceTier),
    [workbenchCommon.performanceTier],
  );
  const defaultBoxSize = useMemo(
    () => resolveBox3dDefaultSize(box3dDefaultSize),
    [box3dDefaultSize],
  );
  const [triFloatBounds, setTriFloatBounds] = useState<FloatingPanelBounds | null>(null);
  const pointSize = workbenchPointcloud.pointSize;
  const colorizeOn = workbenchPointcloud.colorizeWithCamera;
  const colorAdjust: ColorAdjust = useMemo(
    () => ({
      contrast: workbenchPointcloud.colorizeContrast,
      brightness: workbenchPointcloud.colorizeBrightness,
      gamma: workbenchPointcloud.colorizeGamma,
    }),
    [
      workbenchPointcloud.colorizeBrightness,
      workbenchPointcloud.colorizeContrast,
      workbenchPointcloud.colorizeGamma,
    ],
  );
  const depthOn = workbenchPointcloud.showDepthHint;
  const pointMaskSelectMode = isPointMaskSelectMode(workbenchPointcloud.pointMaskSelectMode)
    ? workbenchPointcloud.pointMaskSelectMode
    : "rect";
  const overlayEnabled =
    workbenchCommon.crossFrameOverlayEnabled ??
    (workbenchCommon.crossFrameOverlayK > 0);
  const overlayFrameK = isCrossFrameOverlayK(workbenchCommon.crossFrameOverlayK)
    ? Math.max(workbenchCommon.crossFrameOverlayK, 1)
    : 1;
  const overlayK = overlayEnabled ? overlayFrameK : 0;
  // v0.15.17 · 邻帧框叠加范围:selected=仅选中对象 group(现状);all=不选对象也叠全部邻帧框。
  const overlayScope =
    workbenchCommon.crossFrameOverlayScope === "all" ? "all" : "selected";
  // v0.15.19 · 邻帧点云叠加开关 + 独立帧数(点云比框重,前后各 ≤3 帧)。
  const pointOverlayOn = workbenchPointcloud.neighborPointOverlay;
  const pointOverlayFrameK =
    workbenchPointcloud.neighborPointOverlayK === 2 ||
    workbenchPointcloud.neighborPointOverlayK === 3
      ? workbenchPointcloud.neighborPointOverlayK
      : 1;
  const pointOverlayK = pointOverlayOn ? pointOverlayFrameK : 0;
  // v0.15.22 · §C.8-B / v0.15.23 · §C.8-A 邻帧点云动态点处理:
  // cull=剔除落在当前帧 box 内的邻帧点;align=逐目标把邻帧点搬到当前帧位置(无拖影)。
  const neighborPointCull: "keep" | "cull" | "align" =
    workbenchPointcloud.neighborPointCull === "cull"
      ? "cull"
      : workbenchPointcloud.neighborPointCull === "align"
        ? "align"
        : "keep";
  const [neighborCulledCount, setNeighborCulledCount] = useState(0);
  const [neighborMovedCount, setNeighborMovedCount] = useState(0);
  const [pointCloudViewMode, setPointCloudViewMode] = useState<"orbit" | "bev">("orbit");
  const [colorizing, setColorizing] = useState(false);
  const colorizedRawRef = useRef<Float32Array | null>(null);
  const adjustedColorBufferRef = useRef<Float32Array | null>(null);
  // v0.13.7 · 放大查看的相机 role(L3);null = 无放大。点⛶开,ESC/遮罩/关闭钮收。
  const [enlargedRole, setEnlargedRole] = useState<string | null>(null);
  // v0.15.24 · 放大相机模态里的「种框」模式:拖 2D 框 → 视锥选点 → 拟合 box_3d。仅放大视图启用。
  const [seedMode, setSeedMode] = useState(false);
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

  // 收起的「三视图 ▸」标签也可整体拖动:与展开面板共享记忆坐标(triViewFloat.x/y),
  // 拖动落库位置;位移不过阈值则视为点击 → 展开。moved 区分二者,避免拖完误触发展开。
  const triTabStartRef = useRef<{ x: number; y: number } | null>(null);
  const triTabMovedRef = useRef(false);
  const triTabDrag = useDragMove({
    position: triFloatPosition,
    size: TRI_TAB_DRAG_SIZE,
    bounds: triFloatBounds,
    onStart: (pos) => {
      triTabStartRef.current = pos;
      triTabMovedRef.current = false;
    },
    onChange: (pos) => {
      const start = triTabStartRef.current;
      if (
        start &&
        (Math.abs(pos.x - start.x) > TRI_TAB_DRAG_THRESHOLD ||
          Math.abs(pos.y - start.y) > TRI_TAB_DRAG_THRESHOLD)
      ) {
        triTabMovedRef.current = true;
      }
      updateTriViewFloat({ x: pos.x, y: pos.y });
    },
  });

  // v0.16.x 第 2 批 · 相机面板位置/折叠落库 + 窄屏自动折叠 + 旧 localStorage 迁移,
  // 整簇抽到 useCameraPanels;viewportWrapRef 由壳层共用故传入。
  const {
    autoCollapseCameras,
    handleCameraPanelPosition,
    handleCameraPanelCollapsed,
    handleResetCameraPanels,
  } = useCameraPanels({ cameraPanels, onWorkbenchLayoutChange, viewportWrapRef });

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

  useEffect(() => {
    if (!workbenchConfigLoaded || !userId || typeof window === "undefined") return;
    let cancelled = false;
    let migration;
    try {
      migration = buildPointcloudLegacyMigration(userId, window.localStorage);
    } catch {
      return;
    }
    if (!migration) return;
    if (!migration.patch) {
      finishPointcloudLegacyMigration(migration, window.localStorage);
      return;
    }
    void onWorkbenchConfigUpdate(migration.patch)
      .then(() => {
        if (!cancelled) finishPointcloudLegacyMigration(migration, window.localStorage);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workbenchConfigLoaded, userId, onWorkbenchConfigUpdate]);

  useEffect(() => {
    if (pointMasking) return;
    setPointMaskPolygonPoints([]);
    setPointMaskCursor(null);
  }, [pointMasking]);

  // 选中框的 PSR 编辑表单(字符串值,允许清空 / 中间态如 "-" / "1.";解析有效时才提交)。
  // PATCH 防抖 250ms;yaw 以度展示。
  const [form, setForm] = useState<Record<PsrField, string> | null>(null);

  // v0.13.5 · 三视图拖拽中的本地草稿 PSR (覆盖选中框, 实时四方同步; 松手 PATCH 后清空)。
  const [draftPsr, setDraftPsr] = useState<{ id: string; psr: Psr } | null>(null);

  // 标注里的 3D 框(geometry.type==="box_3d")→ 渲染层输入(PSR + 类别色 + 选中态 + 标签)。
  const boxes = useMemo<SceneBox[]>(() => {
    // 标签内容复用 common.labelContent 的 track 段(点云框是跨帧 track 语义):类别名恒显,
    // 轨迹号 / 属性按开关。state 后缀点云渲染层无逐帧态,留空。可见性走 labelVisibility 门控。
    const trackContent = workbenchCommon.labelContent.track;
    const labelVisibility = workbenchCommon.labelVisibility;
    // 轨迹号:当前帧内按 track_id 字典序派生 1..N,供 track 段的 id token 显示。
    const trackNumbers = new Map<string, number>();
    Array.from(
      new Set(
        (annotations ?? [])
          .filter((a) => !a.is_hidden && a.geometry?.type === "box_3d" && a.track_id)
          .map((a) => a.track_id as string),
      ),
    )
      .sort((x, y) => x.localeCompare(y))
      .forEach((tid, i) => trackNumbers.set(tid, i + 1));

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
      const selected = selectedIdSet.has(a.id);
      const label = shouldShowLabel(selected, labelVisibility)
        ? buildTrackLabelText(
            {
              className: displayClassName(a.class_name),
              trackNumber: a.track_id ? trackNumbers.get(a.track_id) : undefined,
              attributes:
                (a as { attributes?: Record<string, unknown> | null }).attributes ?? null,
            },
            trackContent,
          )
        : undefined;
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
        selected,
        label,
      });
    }
    return list;
  }, [
    annotations,
    selectedIdSet,
    draftPsr,
    workbenchCommon.labelContent.track,
    workbenchCommon.labelVisibility,
  ]);

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
  const selectedHidden = !!selectedAnn?.is_hidden;
  // 可编辑 = 任务级非只读 且 该框未锁定。
  const selectedEditable = !readOnly && !selectedLocked;
  const selectedPsrEditable = selectedEditable && !multiBoxSelected;
  const selectedPointMaskEditable = selectedEditable && !!selectedPointMask && !multiBoxSelected;

  // gizmo 拖拽结束:回写 PSR 表单 + 几何 PATCH 持久化(与数值面板共用持久化管线)。
  // 作为回调注入 usePointCloudScene —— form / mutate / history 仍由本壳组件持有,边界干净。
  const handleTransformCommit = useCallback((id: string, psr: BoxPsr) => {
    setForm(psrToForm(psr));
    const ann = annotationsRef.current?.find((a) => a.id === id);
    const geometry = boxGeometryFromPsr(
      psr,
      geometryConvention(ann?.geometry, axisConventionRef.current),
    );
    updateMutateRef.current({ annotationId: id, payload: { geometry } });
    if (ann?.geometry?.type === "box_3d") {
      historyPushRef.current({
        kind: "update",
        annotationId: id,
        before: { geometry: ann.geometry },
        after: { geometry },
      });
    }
    // 依赖全为稳定 ref / setState / 纯函数 import,故空依赖。
  }, []);

  // Three.js 场景生命周期(实例化/销毁 · 偏好同步 · 点云加载 · 框图层 · gizmo 挂载 · W-E-R)。
  const { stats, loadError } = usePointCloudScene({
    viewportRef,
    sceneRef,
    pcdDecimate: performanceConfig.pcdDecimate,
    pointSize,
    showGrid: workbenchPointcloud.showGrid,
    showAxisGizmo: workbenchPointcloud.showAxisGizmo,
    cameraDamping: workbenchPointcloud.cameraDamping,
    persistCameraView: workbenchPointcloud.persistCameraView,
    pointCloudUrl: manifest?.point_cloud_url,
    axisConvention,
    boxes,
    selectedId,
    selectedPsrEditable,
    pointcloudCamera,
    onWorkbenchLayoutChange,
    onTransformCommit: handleTransformCommit,
  });

  // v0.14.1 · Shift+→ / Shift+← 跨帧目标延续: 选中 box_3d 时 propagate 到同 scene
  // 邻帧并跳过去自动选中(orchestration 在壳层 onCrossFramePropagate)。
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      // v0.14.1 · 阻断按住 Shift+→ 的 auto-repeat: 否则连发多个 propagate POST,
      // 在目标帧造出共享同一新 track_id 的重复 annotation。
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

  // v0.16.x 第 3 批 · PSR 数值字段防抖落库管线抽到 usePsrPatchPipeline(单一职责、
  // 单消费者 handleField、不碰共享 form/setForm);完整 usePsrEditor 因 form 被多处共享
  // 无法干净切分(见计划 §5/§7),此处仅"缩小范围"抽这条管线。
  const { schedulePatch } = usePsrPatchPipeline({
    selectedId,
    selectedAnn,
    axisConvention,
    updateAnnotation,
    history,
  });

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
        return isPsrFieldBad(k, prev[k]) ? { ...prev, [k]: psrToForm(selectedBox)[k] } : prev;
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

  // v0.15.20 · 隐藏 / 显示选中框(与右栏列表同源 is_hidden;仅可见性,渲染侧读 a.is_hidden)。
  const handleToggleHidden = useCallback(() => {
    if (!selectedId) return;
    updateAnnotation.mutate({
      annotationId: selectedId,
      payload: { is_hidden: !selectedHidden },
    });
  }, [selectedId, selectedHidden, updateAnnotation]);

  // 放置:点地面 → 默认尺寸框(落在地面上)→ 持久化 → 选中新框精修;单次放置后退出。
  const handlePlace = useCallback(
    (clientX: number, clientY: number) => {
      const scene = sceneRef.current;
      if (!scene || !boxPlaceClass) return;
      const ground = scene.placeOnGround(clientX, clientY);
      if (!ground) return;
      const [l, w, h] = defaultBoxSize;
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
    [axisConvention, boxPlaceClass, createAnnotation, defaultBoxSize, history, onSelectBox, onSetThreeDTool],
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

  // v0.15.24 · §Phase1 相机图「2D 框种 3D 框」:在放大相机图上拖矩形 → 该相机标定反算视锥选点
  // → depthGate 取最近簇 → psrFromPoints + fitYaw/fitBottom 拟合 → 落 box_3d 并选中微调。
  // 空簇(图上可见但无 lidar 返回)→ 沿中央射线放默认尺寸框 + 提示微调。唯一产物是 box_3d(2D 不落库)。
  const handleSeedBox = useCallback(
    (rect: SeedRect, calibration: SensorCalibration) => {
      const scene = sceneRef.current;
      if (!scene || !boxPlaceClass) return;
      const positions = scene.getPointPositions();
      if (!positions) return;
      const gated = depthGate(selectPointsInRect(positions, rect, calibration));
      let psr: Psr;
      if (gated.length >= 3) {
        const cluster = gatherPoints(positions, gated);
        psr = fitBottom(cluster, fitYaw(cluster, psrFromPoints(cluster)));
      } else {
        // 空簇 / 点太少:沿矩形中心射线按固定估计深度放默认尺寸框(用户再微调)。
        const ray = centralRay(rect, calibration);
        const center: [number, number, number] = [
          ray.origin[0] + ray.direction[0] * SEED_FALLBACK_RANGE_M,
          ray.origin[1] + ray.direction[1] * SEED_FALLBACK_RANGE_M,
          ray.origin[2] + ray.direction[2] * SEED_FALLBACK_RANGE_M,
        ];
        psr = { center, size: defaultBoxSize, rotation: [0, 0, 0] };
        pushToast({ msg: "视锥内无点云,已按默认尺寸放置,请微调", kind: "" });
      }
      const geometry = boxGeometryFromPsr(psr, axisConvention);
      const payload: AnnotationPayload = {
        annotation_type: "box_3d",
        tool_unit_id: LIDAR_TOOL_UNIT,
        class_name: boxPlaceClass,
        geometry,
      };
      createAnnotation.mutate(payload, {
        onSuccess: (created) => {
          history.push({ kind: "create", annotationId: created.id, payload });
          onSelectBox(created.id);
        },
      });
      setSeedMode(false);
    },
    [boxPlaceClass, axisConvention, defaultBoxSize, createAnnotation, history, onSelectBox, pushToast],
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

  // ── v0.15.20 · 画布右键菜单(命中框/空白分流;右键拖动=相机 pan 则抑制)────────────
  const contextMenu = useCanvasContextMenu();
  const [ctxTargetId, setCtxTargetId] = useState<string | null>(null);
  const [classPickerAnchor, setClassPickerAnchor] = useState<{ left: number; top: number } | null>(null);
  const [framePicker, setFramePicker] = useState<{ mode: FramePickerMode; anchor: { left: number; top: number } } | null>(null);

  // v0.15.21 · 选中框 PSR 面板:渐进展开 + 整体拖动,展开态与位置偏移按用户记忆(localStorage)。
  const { psrPanel, psrDragging, onPsrHeaderPointerDown, togglePsrExpanded } = usePsrFloatingPanel(userId);

  const closeContextMenu = () => {
    contextMenu.close();
    setCtxTargetId(null);
  };
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // 右键拖动 = OrbitControls 相机平移, 抑制菜单; 右键点击才弹(与 click 判定同阈值)。
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_CLICK_TOL) {
      closeContextMenu();
      return;
    }
    // 放置/框选进行中右键 = 取消这一笔(window 级 cancel 处理), 不弹菜单。
    if (drawingSelection || isBoxSelecting) {
      closeContextMenu();
      return;
    }
    const hitId = sceneRef.current?.pickBox(e.clientX, e.clientY) ?? null;
    setCtxTargetId(hitId);
    if (hitId && !selectedIdSet.has(hitId)) onSelectBox(hitId);
    contextMenu.openAt(e.clientX, e.clientY);
  };
  const contextMenuItems = useMemo(() => {
    if (!contextMenu.open) return [];
    const canPropagate = !!manifest?.scene_id;
    const hasClipboard = clipboardRef.current != null;
    if (ctxTargetId) {
      const ann = (annotations ?? []).find((a) => a.id === ctxTargetId);
      return buildThreeDBoxContextMenuItems({
        readOnly,
        locked: !!ann?.is_locked,
        hidden: !!ann?.is_hidden,
        hasClipboard,
        canPropagate,
        canInterpolate: ann?.track_id != null,
        onPropagateNext: () => onCrossFramePropagate("next"),
        onPropagatePrev: () => onCrossFramePropagate("prev"),
        onPropagateToFrame: () =>
          setFramePicker({ mode: "propagate", anchor: { left: contextMenu.x, top: contextMenu.y } }),
        onInterpolate: () =>
          setFramePicker({ mode: "interpolate", anchor: { left: contextMenu.x, top: contextMenu.y } }),
        onChangeClass: () => setClassPickerAnchor({ left: contextMenu.x, top: contextMenu.y }),
        onToggleLock: handleToggleLock,
        onToggleHidden: handleToggleHidden,
        onCopy: copySelected,
        onPaste: pasteClipboard,
        onDelete: handleDeleteSelected,
      });
    }
    return buildThreeDEmptyContextMenuItems({
      readOnly,
      hasClipboard,
      canPropagate,
      onPropagateBatchNext: () => onCrossFramePropagateBatch("next"),
      onPropagateBatchPrev: () => onCrossFramePropagateBatch("prev"),
      onPaste: pasteClipboard,
    });
  }, [
    contextMenu.open, contextMenu.x, contextMenu.y, ctxTargetId,
    manifest?.scene_id, annotations, readOnly,
    onCrossFramePropagate, onCrossFramePropagateBatch,
    handleToggleLock, handleToggleHidden, copySelected, pasteClipboard, handleDeleteSelected,
  ]);

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
  // v0.13.7 · 放大浮层:ESC 关闭(v0.15.24:种框模式下 ESC 先退出种框,再次 ESC 才关浮层)。
  useEffect(() => {
    if (!enlargedRole) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (seedMode) setSeedMode(false);
        else setEnlargedRole(null);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        cycleEnlargedCamera(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        cycleEnlargedCamera(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleEnlargedCamera, enlargedRole, seedMode]);
  // v0.15.24 · 关闭放大浮层时复位种框模式(种框仅在放大视图内有意义)。
  useEffect(() => {
    if (!enlargedRole) setSeedMode(false);
  }, [enlargedRole]);
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
      colorizedRawRef.current = null;
      adjustedColorBufferRef.current = null;
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
        if (!cancelled) {
          colorizedRawRef.current = colors;
          adjustedColorBufferRef.current = null;
          scene.setPointColors(isNeutralAdjust(colorAdjust) ? colors : adjustColors(colors, colorAdjust));
        }
      }
      if (!cancelled) setColorizing(false);
    })();
    return () => {
      cancelled = true;
    };
    // colorAdjust changes are handled by the lightweight remap effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorizeOn, cameras, stats]);

  useEffect(() => {
    const scene = sceneRef.current;
    const raw = colorizedRawRef.current;
    if (!scene || !colorizeOn || !raw) return;
    if (isNeutralAdjust(colorAdjust)) {
      scene.setPointColors(raw);
      return;
    }
    if (!adjustedColorBufferRef.current || adjustedColorBufferRef.current.length !== raw.length) {
      adjustedColorBufferRef.current = new Float32Array(raw.length);
    }
    scene.setPointColors(adjustColors(raw, colorAdjust, adjustedColorBufferRef.current));
  }, [colorAdjust, colorizeOn]);

  useEffect(() => {
    sceneRef.current?.highlightPointMask(selectedPointMask?.point_indices ?? null);
  }, [selectedPointMask?.point_indices, stats]);

  // v0.13.4 · 跨模态高亮集合:选中框 + 同 track_id 成员。3D 主视图仍按 selected 单框高亮,
  // overlay 按本集合高亮(为未来同链 2D 框成员预留;孤立框 track_id 为空时退化为仅选中本身)。
  // v0.21.2 · ADR-0045 · 跨帧链按 track_id 认同一对象 (原 group_id 高位段)。
  const selectedTrackId = selectedAnn?.track_id ?? null;
  const highlightedIds = useMemo(() => {
    const s = new Set<string>();
    for (const id of selectedIds) s.add(id);
    if (selectedTrackId != null) {
      for (const a of annotations ?? []) {
        if (a.track_id === selectedTrackId) s.add(a.id);
      }
    }
    return s;
  }, [selectedIds, selectedTrackId, annotations]);

  // v0.15.18 · 框叠加(overlayK)或点云叠加(pointOverlayK)任一开启都要邻帧 + 轨迹;
  // 取两者最大帧数拉取,各自再按需切片(框用 overlayK,点云用 pointOverlayK),互不放大。
  const neighborsActive = overlayK > 0 || pointOverlayK > 0;
  const neighborsFetchK = Math.max(1, overlayK, pointOverlayK);
  const { data: neighborsData } = useFrameNeighbors(
    neighborsActive ? taskId : null,
    neighborsFetchK,
  );
  const neighborTaskIds = useMemo(() => {
    if (overlayK <= 0 || !neighborsData) return [];
    return [
      ...(neighborsData.prev ?? []).slice(0, overlayK),
      ...(neighborsData.next ?? []).slice(0, overlayK),
    ].map((n) => n.task_id);
  }, [overlayK, neighborsData]);
  // v0.15.17 · 批量端点拉邻帧标注。scope=selected 需选中对象(传 track_id 服务端过滤);
  // scope=all 不依赖选中(track_id=null,回全部框)。
  const boxAnnotationOverlayEnabled =
    overlayK > 0 && (overlayScope === "all" || selectedTrackId != null);
  const overlayTrackId = overlayScope === "all" ? null : selectedTrackId;
  const { byTask: neighborAnnsByTask } = useNeighborAnnotations(
    overlayK > 0 ? taskId : null,
    overlayK,
    overlayTrackId,
    boxAnnotationOverlayEnabled,
  );
  // v0.15.1 · overlay ego 对齐: 邻帧框经 trajectory 变换到当前帧 ego 系再叠加,
  // 静止物参考框与当前帧重合。无轨迹 scene → poseByFrame=null,退回原样叠加。
  const { poseByFrame } = useSceneTrajectory(
    neighborsActive ? (neighborsData?.scene_id ?? null) : null,
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
    if (overlayK <= 0) return [];
    // scope=selected:必须选中对象;scope=all:不选也叠全部邻帧框。
    if (overlayScope === "selected" && selectedTrackId == null) return [];
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
        // scope=all 且有选中对象:非选中 track 的邻帧框弱化(dim),突出当前对象轨迹。
        const dim =
          overlayScope === "all" &&
          selectedTrackId != null &&
          a.track_id !== selectedTrackId;
        out.push({
          id: `${tid}:${a.id}`,
          center,
          size: g.size.map((v) => Math.abs(v)) as [number, number, number],
          rotation,
          color: classColorForCanvas(a.class_name),
          dim,
        });
      }
    }
    return out;
  }, [
    overlayK,
    overlayScope,
    selectedTrackId,
    neighborTaskIds,
    neighborAnnsByTask,
    neighborsData,
    poseByFrame,
    neighborFrameByTask,
  ]);
  useEffect(() => {
    sceneRef.current?.setReferenceBoxes(referenceBoxes);
  }, [referenceBoxes]);

  // v0.15.18 · 邻帧点云叠加。需 scene + ego 轨迹(无轨迹直接叠会乱,故 gate on poseByFrame)。
  const pointOverlayActive =
    pointOverlayK > 0 && !!neighborsData?.scene_id && !!poseByFrame;
  const pointNeighbors = useMemo(() => {
    if (!pointOverlayActive || !neighborsData) return [];
    return [
      ...(neighborsData.prev ?? []).slice(0, pointOverlayK),
      ...(neighborsData.next ?? []).slice(0, pointOverlayK),
    ].map((n) => ({ taskId: n.task_id, frameIndex: n.frame_index }));
  }, [pointOverlayActive, neighborsData, pointOverlayK]);
  // v0.15.23 · §C.8-A align 模式:把落在邻帧 box 内的点按目标位姿搬到当前帧位置(逐目标
  // 补偿,真·消除拖影)。需邻帧「全部」框(按 track_id 与当前帧框配对),独立于框叠加
  // (overlayK)且 scope 恒为 all;仅 align 时拉取,避免无谓请求。
  const alignActive = pointOverlayActive && neighborPointCull === "align";
  const { byTask: alignAnnsByTask } = useNeighborAnnotations(
    alignActive ? taskId : null,
    pointOverlayK,
    null,
    alignActive,
  );
  // 当前帧 box:track_id → PSR(逐目标搬运的配对目标)。
  const currentBoxesByTrack = useMemo<Map<string, AlignPsr>>(() => {
    const m = new Map<string, AlignPsr>();
    if (!alignActive) return m;
    for (const a of annotations ?? []) {
      if (a.track_id == null) continue;
      const g = a.geometry as {
        type?: string;
        center?: number[];
        size?: number[];
        rotation?: number[];
      };
      if (g?.type !== "box_3d" || !g.center || !g.size || !g.rotation) continue;
      m.set(a.track_id, {
        center: g.center as [number, number, number],
        size: g.size.map((v) => Math.abs(v)) as [number, number, number],
        rotation: g.rotation as [number, number, number],
      });
    }
    return m;
  }, [alignActive, annotations]);
  // 邻帧 box(原始邻帧 ego 系 PSR + track_id),按 task 分组;不预对齐(搬运矩阵自带 ego 补偿)。
  const neighborBoxesByTask = useMemo<Map<string, AlignNeighborBox[]>>(() => {
    const m = new Map<string, AlignNeighborBox[]>();
    if (!alignActive) return m;
    for (const [tid, anns] of Object.entries(alignAnnsByTask)) {
      const list: AlignNeighborBox[] = [];
      for (const a of anns) {
        if (a.track_id == null) continue;
        const g = a.geometry as {
          type?: string;
          center?: number[];
          size?: number[];
          rotation?: number[];
        };
        if (g?.type !== "box_3d" || !g.center || !g.size || !g.rotation) continue;
        list.push({
          trackId: a.track_id,
          center: g.center as [number, number, number],
          size: g.size.map((v) => Math.abs(v)) as [number, number, number],
          rotation: g.rotation as [number, number, number],
        });
      }
      m.set(tid, list);
    }
    return m;
  }, [alignActive, alignAnnsByTask]);
  // 邻帧点云下采样目标:当前帧抽稀阈值的 1/8,上限 8 万(邻帧仅作参考,远低于当前帧)。
  const neighborPointTarget = Math.min(
    80_000,
    Math.round(performanceConfig.pcdDecimate / 8),
  );
  const { items: neighborPcds } = useNeighborPointClouds(
    pointNeighbors,
    axisConvention,
    neighborPointTarget,
    pointOverlayActive,
  );
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const curFrame = neighborsData?.frame_index ?? null;
    if (!pointOverlayActive || !poseByFrame || curFrame == null) {
      scene.setNeighborPoints([]);
      setNeighborCulledCount(0);
      setNeighborMovedCount(0);
      return;
    }
    const toPose = poseByFrame.get(curFrame);
    type NeighborFrame = {
      positions: Float32Array;
      matrix: NonNullable<ReturnType<typeof frameRelMatrix>>;
      dir: "past" | "future";
      distance: number;
    };
    // v0.15.22 · cull:把对齐到当前帧后落在 tracked box 内的邻帧点剔除,只叠静止背景。
    // v0.15.23 · align:落在邻帧 box 内的点按目标位姿搬到当前帧位置(逐目标补偿,无拖影);
    //   搬运后点已是当前帧 ego 系坐标,渲染走 identity 矩阵(其余背景点仍 ego 对齐)。
    const cullOn = neighborPointCull === "cull" && boxes.length > 0;
    const alignOn = neighborPointCull === "align" && currentBoxesByTrack.size > 0;
    let culledTotal = 0;
    let movedTotal = 0;
    const frames = neighborPcds
      .map((pcd): NeighborFrame | null => {
        const matrix = frameRelMatrix(poseByFrame.get(pcd.frameIndex), toPose);
        if (!matrix) return null;
        let positions = pcd.positions;
        let renderMatrix = matrix;
        if (alignOn) {
          const res = alignNeighborPointsPerObject(
            positions,
            matrix,
            neighborBoxesByTask.get(pcd.taskId) ?? [],
            currentBoxesByTrack,
          );
          positions = res.aligned;
          movedTotal += res.movedCount;
          renderMatrix = IDENTITY_MATRIX; // 点已预变换到当前帧 ego 系
        } else if (cullOn) {
          const res = cullPointsInBoxes(positions, matrix, boxes);
          positions = res.kept;
          culledTotal += res.culledCount;
        }
        // 前/后帧分色 + 按帧距淡出(视觉缓解动态拖影)。
        return {
          positions,
          matrix: renderMatrix,
          dir: pcd.frameIndex >= curFrame ? "future" : "past",
          distance: Math.abs(pcd.frameIndex - curFrame),
        };
      })
      .filter((f): f is NeighborFrame => f != null);
    scene.setNeighborPoints(frames);
    setNeighborCulledCount(cullOn ? culledTotal : 0);
    setNeighborMovedCount(alignOn ? movedTotal : 0);
  }, [
    pointOverlayActive,
    neighborPcds,
    poseByFrame,
    neighborsData,
    neighborPointCull,
    boxes,
    currentBoxesByTrack,
    neighborBoxesByTask,
  ]);

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

  // v0.17.6 · useElementStyle for dynamic CSS custom properties (was style={} JSX attribute).
  const boxSelectRectRef = useElementStyle<HTMLDivElement>(
    previewRect
      ? ({
          "--rect-l": `${previewRect.l}px`,
          "--rect-t": `${previewRect.t}px`,
          "--rect-w": `${previewRect.w}px`,
          "--rect-h": `${previewRect.h}px`,
        } as CSSProperties)
      : undefined,
  );
  const editPanelRef = useElementStyle<HTMLDivElement>({
    "--psr-dx": `${psrPanel.dx}px`,
    "--psr-dy": `${psrPanel.dy}px`,
  } as CSSProperties);
  const triFloatTabRef = useElementStyle<HTMLDivElement>({
    "--tri-tab-x": `${triFloatPosition.x}px`,
    "--tri-tab-y": `${triFloatPosition.y}px`,
  } as CSSProperties);

  return (
    <div className={ROOT}>
      <div ref={viewportWrapRef} className={VIEWPORT_WRAP}>
        <div
          ref={viewportRef}
          className={drawingSelection ? `${VIEWPORT} ${PLACING}` : VIEWPORT}
          data-testid="pc-viewport"
          onMouseDown={handleViewportMouseDown}
          onMouseMove={handleViewportMouseMove}
          onClick={handleViewportClick}
          onDoubleClick={handleViewportDoubleClick}
          onContextMenu={handleContextMenu}
        />

        {/* v0.13.9 · 框选预览矩形(地面 footprint), 仅拖拽期出现, 不拦事件。 */}
        {previewRect && (
          <div ref={boxSelectRectRef} className={BOX_SELECT_RECT} />
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
            <svg className={POINT_MASK_PATH_PREVIEW} aria-hidden="true">
              <polyline className="[fill:none] [stroke:var(--sc-brand)] [stroke-width:2] [stroke-linejoin:round] [stroke-linecap:round]" points={svgPoints} />
              {draft.map((p, i) => (
                <circle className="[fill:var(--sc-card)] [stroke:var(--sc-brand)] [stroke-width:2]" key={`${p.x}:${p.y}:${i}`} cx={p.x} cy={p.y} r="3" />
              ))}
            </svg>
          );
        })()}

        {/* 控件浮条 */}
        <div ref={controlsRef} className={CONTROLS}>
          <button
            type="button"
            className={BTN}
            onClick={handleResetView}
          >
            重置视角
          </button>
          <button
            type="button"
            className={pointCloudViewMode === "bev" ? `${BTN} ${BTN_ACTIVE}` : BTN}
            onClick={handleBevView}
            aria-pressed={pointCloudViewMode === "bev"}
          >
            俯视
          </button>
          <button
            type="button"
            className={BTN}
            onClick={handleResetCameraPanels}
            title="恢复 2D 相机图默认贴边布局"
          >
            重置相机布局
          </button>
          {colorizing && (
            <span className={SIZE_CTL} title="相机上色处理中">
              相机上色…
            </span>
          )}
          {threeDTool === "point-mask" && (
            <label className={SIZE_CTL}>
              选点
              <select
                className={SELECT_CTL}
                data-testid="pointmask-mode-select"
                value={pointMaskSelectMode}
                disabled={!canPlacePointMask}
                onChange={(e) => {
                  const next = e.target.value;
                  if (isPointMaskSelectMode(next)) {
                    onWorkbenchConfigChange({
                      pointcloud: { pointMaskSelectMode: next },
                    });
                  }
                }}
              >
                <option value="rect">矩形</option>
                <option value="lasso">套索</option>
                <option value="polygon">多边形</option>
              </select>
            </label>
          )}
        </div>

        <ContextMenu
          open={contextMenu.open && contextMenuItems.length > 0}
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
        {classPickerAnchor && (
          <ClassPickerPopover
            position="fixed"
            anchor={classPickerAnchor}
            classes={boxClasses}
            recent={[]}
            defaultClass={selectedClass ?? boxClasses[0] ?? ""}
            title="改类别"
            onPick={(cls) => {
              handleChangeClass(cls);
              setClassPickerAnchor(null);
            }}
            onCancel={() => setClassPickerAnchor(null)}
          />
        )}
        {framePicker && taskId && (
          <FramePicker
            taskId={taskId}
            frameIndex={manifest?.frame_index ?? null}
            sceneTotalFrames={manifest?.scene_total_frames ?? null}
            mode={framePicker.mode}
            anchor={framePicker.anchor}
            pushToast={pushToast}
            onConfirm={({ targetTaskId, targetFrame }) => {
              if (framePicker.mode === "propagate") {
                onCrossFramePropagateToTask(targetTaskId, targetFrame);
              } else if (selectedTrackId != null) {
                onCrossFrameInterpolate(selectedTrackId, targetTaskId);
              }
              setFramePicker(null);
            }}
            onCancel={() => setFramePicker(null)}
          />
        )}

        {conventionMismatches.length > 0 && (
          <div className={MISMATCH_BANNER}>
            <span>
              {conventionMismatches.length} 个 3D 标注创建时的坐标系与当前数据集不一致。
            </span>
            <button
              type="button"
              className={BTN}
              disabled={!selectedConventionMismatch || !selectedEditable}
              onClick={handleReprojectSelectedToCurrentConvention}
            >
              按当前约定重投影选中
            </button>
          </div>
        )}

        {/* 状态条 */}
        <div className={STATUS_BAR}>
          {isLoading && <span>加载 manifest…</span>}
          {error && <span className={ERR}>manifest 加载失败</span>}
          {loadError && <span className={ERR}>点云加载失败: {loadError}</span>}
          {stats && (
            <span data-testid="pointcloud-stats">
              {stats.renderedPoints.toLocaleString()} 点
              {stats.decimated && `(已抽稀自 ${stats.totalPoints.toLocaleString()})`}
            </span>
          )}
          {boxes.length > 0 && <span>· {boxes.length} 框</span>}
          {neighborCulledCount > 0 && (
            <span>· 邻帧剔除 {neighborCulledCount.toLocaleString()} 动态点</span>
          )}
          {neighborMovedCount > 0 && (
            <span>· 邻帧对齐 {neighborMovedCount.toLocaleString()} 动态点</span>
          )}
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
            <span className={ERR}>· 当前项目未启用 point_mask_3d 类别</span>
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

        {/* 选中框 PSR 数值编辑面板(右上;头部可拖动 + 渐进展开) */}
        {selectedBox && form && (
          <div
            ref={editPanelRef}
            className={[EDIT_PANEL, psrDragging ? EDIT_PANEL_DRAGGING : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <div
              className={psrDragging ? `${EDIT_HEADER} !cursor-grabbing` : EDIT_HEADER}
              onPointerDown={onPsrHeaderPointerDown}
            >
              <div className={EDIT_TITLE}>
                <Icon name="move" size={12} className={DRAG_HINT} />
                {boxClasses.length > 0 ? (
                  <select
                    className={CLASS_SELECT}
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
                    className={selectedLocked ? `${LOCK_BTN} ${LOCK_BTN_ON}` : LOCK_BTN}
                    aria-pressed={selectedLocked}
                    onClick={handleToggleLock}
                  >
                    {selectedLocked ? "已锁定" : "锁定"}
                  </button>
                )}
                {!readOnly && selectedBoxIds.length > 0 && (
                  <button
                    type="button"
                    className={ICON_BTN}
                    onClick={handleDeleteSelected}
                    aria-label={multiBoxSelected ? `删除选中 ${selectedBoxIds.length} 个框` : "删除框"}
                    title={multiBoxSelected ? `删除选中 ${selectedBoxIds.length} 个框` : "删除框"}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className={ICON_BTN}
                  onClick={togglePsrExpanded}
                  aria-expanded={psrPanel.expanded}
                  aria-label={psrPanel.expanded ? "收起详情" : "展开详情"}
                  title={psrPanel.expanded ? "收起" : "展开"}
                >
                  <Icon name={psrPanel.expanded ? "chevUp" : "chevDown"} size={14} />
                </button>
              </div>
              <div className={EDIT_SUMMARY}>
                {multiBoxSelected
                  ? `${selectedBoxIds.length} 个框已选中`
                  : `尺寸 ${selectedBox.size.map((n) => n.toFixed(2)).join(" × ")} m`}
              </div>
            </div>
            {psrPanel.expanded && (
              <div className={EDIT_BODY}>
                <div className={EDIT_GROUP_LABEL}>
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
                  <div className={FIT_GROUP} role="group" aria-label="自动贴合">
                    <button
                      type="button"
                      className={BTN}
                      onClick={handleFitDefault}
                      title="贴合 (Q):收尺寸 + 贴地"
                    >
                      贴合
                    </button>
                    <button
                      type="button"
                      className={BTN}
                      onClick={handleFitSize}
                      title="只收尺寸 (Shift+Q)"
                    >
                      收尺寸
                    </button>
                    <button
                      type="button"
                      className={BTN}
                      onClick={handleFitBottom}
                      title="只贴地 (Alt+Q)"
                    >
                      贴地
                    </button>
                    <button
                      type="button"
                      className={BTN}
                      onClick={handleFitYaw}
                      title="贴朝向(实验):点云稀疏时主轴可能反转 180°"
                    >
                      朝向⚗
                    </button>
                  </div>
                )}
                {PSR_GROUPS.map((g) => (
                  <div key={g.label}>
                    <div className={EDIT_GROUP_LABEL_ROW}>
                      <span className={EDIT_GROUP_LABEL}>{g.label}</span>
                      {g.reset && selectedPsrEditable && (
                        <button
                          type="button"
                          className={RESET_BTN}
                          onClick={handleResetRotation}
                          title="把偏航/俯仰/翻滚全部归零"
                        >
                          归零
                        </button>
                      )}
                    </div>
                    <div className={EDIT_ROW}>
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
              </div>
            )}
          </div>
        )}

        {selectedPointMask && selectedAnn && (
          <div className={EDIT_PANEL}>
            <div className={EDIT_TITLE}>
              {pointMaskClasses.length > 0 ? (
                <select
                  className={CLASS_SELECT}
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
                  className={selectedLocked ? `${LOCK_BTN} ${LOCK_BTN_ON}` : LOCK_BTN}
                  aria-pressed={selectedLocked}
                  onClick={handleToggleLock}
                >
                  {selectedLocked ? "已锁定" : "锁定"}
                </button>
              )}
            </div>
            <div className={EDIT_GROUP_LABEL}>
              {selectedPointMask.point_indices.length.toLocaleString()} 点 · P 后圈选加点,Alt 圈选减点
            </div>
            {!readOnly && selectedPointMaskEditable && (
              <button
                type="button"
                className={DELETE_BTN}
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
          // 不能用 <button>/role=button:useDragMove 的 isInteractiveTarget 会拦掉其 pointerdown。
          // 用 div + tabIndex 保留键盘可达;拖动经 handleProps,纯点击(未拖动)才展开。
          <div
            ref={triFloatTabRef}
            tabIndex={0}
            data-floating-panel
            aria-label="展开三视图精修(可拖动)"
            className={[
              TRI_FLOAT_TAB,
              triTabDrag.isDragging ? TRI_FLOAT_TAB_DRAGGING : "",
            ]
              .filter(Boolean)
              .join(" ")}
            {...triTabDrag.handleProps}
            onClick={() => {
              if (!triTabMovedRef.current) updateTriViewFloat({ collapsed: false });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                updateTriViewFloat({ collapsed: false });
              }
            }}
          >
            三视图 ▸
          </div>
        )}

        {/* v0.13.7 · 悬浮相机面板:按物理朝向贴主视图边缘,同朝向沿边堆叠。
            投影 overlay / 上色 / 深度命中沿用 CameraProjectionView,布局对其透明。 */}
        {cameraGroups.map(([anchor, cams]) => (
          <div key={anchor} className={`${CAM_GROUP} ${ANCHOR_CLASS[anchor]}`}>
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
            className={CAM_MODAL}
            onClick={() => setEnlargedRole(null)}
            role="presentation"
          >
            <div
              className={CAM_MODAL_BODY}
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              <button
                type="button"
                className={CAM_MODAL_CLOSE}
                onClick={() => setEnlargedRole(null)}
              >
                关闭 ✕
              </button>
              {!readOnly && enlargedCam.calibration && boxPlaceClass && (
                <button
                  type="button"
                  className={seedMode ? `${CAM_MODAL_SEED} ${CAM_MODAL_SEED_ACTIVE}` : CAM_MODAL_SEED}
                  onClick={() => setSeedMode((v) => !v)}
                  aria-pressed={seedMode}
                  title="在相机图上拖一个 2D 框,自动在 3D 里生成框(视锥选点拟合)"
                >
                  {seedMode ? "种框中 · 拖矩形" : "种框 ⊹"}
                </button>
              )}
              {cameras.length > 1 && (
                <>
                  <button
                    type="button"
                    className={`${CAM_MODAL_SWITCH} ${CAM_MODAL_PREV}`}
                    onClick={() => cycleEnlargedCamera(-1)}
                    title="上一视角"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className={`${CAM_MODAL_SWITCH} ${CAM_MODAL_NEXT}`}
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
                seedMode={seedMode}
                onSeedBox={handleSeedBox}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ThreeDWorkbench;

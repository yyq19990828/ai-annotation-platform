/**
 * v0.13.2 · 点云查看器(只读 MVP)。
 *
 * 拉 point-cloud manifest → 用裸 Three.js(PointCloudScene)渲染主点云 + OrbitControls,
 * 旁边平铺各相机图(只读,不画投影框 —— 投影联动是 v0.13.4)。与 Konva 2D 工作台双栈隔离。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import type { TriViewFloatState } from "@/api/auth";
import {
  useAnnotations,
  useCreateAnnotation,
  useDeleteAnnotation,
  useTask,
  useUpdateAnnotation,
} from "@/hooks/useTasks";
import { useProject } from "@/hooks/useProjects";
import { classColorForCanvas } from "@/pages/Workbench/stage/colors";
import type { ThreeDTool } from "@/pages/Workbench/state/useWorkbenchState";
import type { WorkbenchLayoutPatch } from "@/pages/Workbench/state/useWorkbenchConfig";
import type { Box3DGeometry, SensorCalibration } from "@/types";

import { FloatingPanelShell, type FloatingPanelRect } from "../../shell/FloatingPanelShell";
import type { FloatingPanelBounds } from "../../shell/useDragMove";
import { usePointCloudManifest } from "./usePointCloudManifest";
import {
  PointCloudScene,
  type PointCloudStats,
  type SceneBox,
} from "./PointCloudScene";
import CameraProjectionView from "./CameraProjectionView";
import FloatingCameraPanel from "./FloatingCameraPanel";
import TriViewPanel from "./TriViewPanel";
import type { TriSelected } from "./TriOrthoView";
import type { Psr } from "./geometry/triview";
import { psrToCorners } from "./geometry/box3d";
import { cameraAnchor, type Anchor } from "./geometry/cameraAnchor";
import { colorizePoints, type CameraSample } from "./geometry/colorize";
import { buildDepthRaster } from "./geometry/depthmap";
import { projectPoints } from "./geometry/projection";
import {
  fitSize,
  fitBottom,
  fitYaw,
  fitSizeAndBottom,
  psrFromPoints,
} from "./geometry/autofit";
import {
  applyConventionToExtrinsic,
  type LidarAxisConvention,
} from "./geometry/axisConvention";
import styles from "./ThreeDWorkbench.module.css";

interface ThreeDWorkbenchProps {
  taskId: string | null;
  /** v0.13.3 · 锁定 task / viewer 角色时只读:不放置 / 不编辑 / 无 gizmo,仅看 + 选中查看数值。 */
  readOnly?: boolean;
  /** v0.13.3-5 · 壳层共享选中态(与标注列表 / 右栏面板同一份),驱动选中高亮 / gizmo / 数值面板。 */
  selectedId: string | null;
  onSelectBox: (id: string | null, opts?: { shift?: boolean }) => void;
  /** v0.13.3-5 · 壳层激活类别(左栏 ClassPalette 选);放置新框的 class_name 取它。 */
  activeClass: string;
  /** v0.13.3-5 · 3D 工具态(左栏 ToolDock 选,壳层共享):select 拾取 / box 点地面放置。 */
  threeDTool: ThreeDTool;
  onSetThreeDTool: (t: ThreeDTool) => void;
  /** v0.13.10 · 右栏避让与三视图浮窗持久化。 */
  rightSidebarOpen: boolean;
  rightSidebarWidth: number;
  triViewFloat: TriViewFloatState;
  onWorkbenchLayoutChange: (patch: WorkbenchLayoutPatch) => void;
}

// v0.13.3 · 新框默认尺寸(米,长宽高;约一辆轿车),放置后用面板/gizmo 精修。
const DEFAULT_BOX_SIZE: [number, number, number] = [4.0, 1.8, 1.6];
const TRI_FLOAT_DEFAULT_W = 240;
const TRI_FLOAT_DEFAULT_H = 440;
// v0.13.9 · 框选预览矩形位置/尺寸经 CSS custom property 注入(逐帧动态值)。
type BoxSelectRectVars = CSSProperties & {
  "--rect-l": string;
  "--rect-t": string;
  "--rect-w": string;
  "--rect-h": string;
};

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
const LIDAR_TOOL_UNIT = "lidar_box_3d";

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
  onSelectBox,
  activeClass,
  threeDTool,
  onSetThreeDTool,
  rightSidebarOpen,
  rightSidebarWidth,
  triViewFloat,
  onWorkbenchLayoutChange,
}: ThreeDWorkbenchProps) {
  const { data: manifest, isLoading, error } = usePointCloudManifest(taskId, true);
  // v0.13.11 · dataset 声明的 lidar 系约定;前端把点云 positions + 相机 extrinsic 一次性
  // 旋转到 ISO 8855 (+X 前 / +Y 左 / +Z 上),上层几何代码继续锁死 ISO。null / 缺省 = iso_8855。
  const axisConvention: LidarAxisConvention = manifest?.axis_convention ?? "iso_8855";
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
  // 选中态来自壳层(selectedId / onSelectBox props),与标注列表 / 右栏面板共享同一份。

  const { data: annotations } = useAnnotations(taskId ?? undefined);
  const updateAnnotation = useUpdateAnnotation(taskId ?? undefined);
  const deleteAnnotation = useDeleteAnnotation(taskId ?? undefined);
  const createAnnotation = useCreateAnnotation(taskId ?? undefined);
  // scene 的拖拽回调只设一次,用 ref 取最新 mutate,避免闭包旧值。
  const updateMutateRef = useRef(updateAnnotation.mutate);
  updateMutateRef.current = updateAnnotation.mutate;

  // 放置新框需要项目的 lidar_box_3d 类别(后端按 tool_bindings 校验 class_name)。
  const { data: task } = useTask(taskId ?? "");
  const { data: project } = useProject(task?.project_id ?? "");
  const lidarClasses = useMemo(
    () => (project?.tool_bindings?.[LIDAR_TOOL_UNIT]?.classes ?? []).map((c) => c.name),
    [project],
  );

  // 工具态 / 待放置类别全来自壳层(ToolDock 的 threeDTool + 左栏 ClassPalette 的 activeClass);
  // canPlace 兜底:只读 / 未配类别时不允许放置。placeClass 在 activeClass 不在类集合时回落首个。
  const canPlace = !readOnly && lidarClasses.length > 0;
  const placing = threeDTool === "box" && canPlace;
  const placeClass =
    activeClass && lidarClasses.includes(activeClass) ? activeClass : (lidarClasses[0] ?? null);
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
        selected: a.id === selectedId,
      });
    }
    return list;
  }, [annotations, selectedId, draftPsr]);

  const selectedBox = boxes.find((b) => b.id === selectedId) ?? null;
  const selectedAnn = (annotations ?? []).find((a) => a.id === selectedId) ?? null;
  const selectedClass = selectedAnn?.class_name ?? null;
  // 单框锁定(列表 L 切换)→ 不可编辑(无 gizmo / 面板禁用 / 不可删),但仍可选中查看。
  const selectedLocked = !!selectedAnn?.is_locked;
  // 可编辑 = 任务级非只读 且 该框未锁定。
  const selectedEditable = !readOnly && !selectedLocked;

  // 实例化 / 销毁 Scene(随容器挂载一次)。
  useEffect(() => {
    if (!viewportRef.current) return;
    const scene = new PointCloudScene(viewportRef.current);
    sceneRef.current = scene;
    // 拖拽结束:回写表单 + PATCH 持久化(与数值面板共用持久化管线)。
    scene.setTransformHandler((id, psr) => {
      setForm(psrToForm(psr));
      updateMutateRef.current({
        annotationId: id,
        payload: {
          geometry: {
            type: "box_3d",
            center: psr.center,
            size: psr.size,
            rotation: psr.rotation,
          },
        },
      });
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
    if (selectedId && selectedEditable) scene.attachTransform(selectedId);
    else scene.detachTransform();
  }, [selectedId, boxes, selectedEditable]);

  // W/E/R 切 gizmo 模式(仅选中且可编辑时;焦点在输入框时不拦截)。
  useEffect(() => {
    if (!selectedId || !selectedEditable) return;
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
  }, [selectedId, selectedEditable]);

  // 切任务回到选择工具(选中态由壳层在切任务时统管,3D 不再本地清)。
  useEffect(() => {
    onSetThreeDTool("select");
    setPointCloudViewMode("orbit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // 进入放置模式时清选中,避免 gizmo 挡在点地面的路上。
  useEffect(() => {
    if (placing) onSelectBox(null);
  }, [placing, onSelectBox]);

  // B 进放置 / V / Esc 回选择(焦点在输入框时不拦截;无可用类别时 B 无效)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Escape" || e.key === "v" || e.key === "V") onSetThreeDTool("select");
      else if ((e.key === "b" || e.key === "B") && canPlace) onSetThreeDTool("box");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canPlace, onSetThreeDTool]);

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
        const geometry: Box3DGeometry = {
          type: "box_3d",
          center: [v.cx, v.cy, v.cz],
          size: [v.l, v.w, v.h],
          // rotation = [rx=roll, ry=pitch, rz=yaw] (弧度), 三轴齐全, 不再抹掉 pitch/roll。
          rotation: [v.roll * deg, v.pitch * deg, v.yaw * deg],
        };
        updateAnnotation.mutate({ annotationId: selectedId, payload: { geometry } });
      }, 250);
    },
    [selectedId, updateAnnotation],
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

  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    deleteAnnotation.mutate(selectedId);
    onSelectBox(null);
  }, [selectedId, deleteAnnotation, onSelectBox]);

  // 改选中框类别(3D 原生:面板下拉;2D 的画布锚定 popover 不适用 3D)。
  const handleChangeClass = useCallback(
    (cls: string) => {
      if (!selectedId || !cls) return;
      updateAnnotation.mutate({ annotationId: selectedId, payload: { class_name: cls } });
    },
    [selectedId, updateAnnotation],
  );

  // v0.13.5 · 朝向归零:把三轴旋转复位为 [0,0,0](保留中心/尺寸),并同步表单。
  const handleResetRotation = useCallback(() => {
    if (!selectedId || !selectedBox) return;
    setForm((prev) => (prev ? { ...prev, yaw: "0", pitch: "0", roll: "0" } : prev));
    updateAnnotation.mutate({
      annotationId: selectedId,
      payload: {
        geometry: {
          type: "box_3d",
          center: selectedBox.center,
          size: selectedBox.size,
          rotation: [0, 0, 0],
        },
      },
    });
  }, [selectedId, selectedBox, updateAnnotation]);

  // v0.13.8 · 自动贴合:把选中框按点云 box-local AABB 收尺寸 / 贴地 / 朝向。
  // 共用 helper:拿当前点云 positions + 选中框 PSR → 跑 transform → 立即提交 + 同步表单。
  // 不走 schedulePatch 250ms 防抖(一键操作期望即时生效)。
  const applyFit = useCallback(
    (transform: (positions: Float32Array, psr: Psr) => Psr) => {
      if (!selectedId || !selectedBox || !selectedEditable) return;
      const positions = sceneRef.current?.getPointPositions();
      if (!positions) return;
      const current: Psr = {
        center: selectedBox.center,
        size: selectedBox.size,
        rotation: selectedBox.rotation,
      };
      const next = transform(positions, current);
      setForm(psrToForm(next));
      updateAnnotation.mutate({
        annotationId: selectedId,
        payload: {
          geometry: {
            type: "box_3d",
            center: [next.center[0], next.center[1], next.center[2]],
            size: [next.size[0], next.size[1], next.size[2]],
            rotation: [next.rotation[0], next.rotation[1], next.rotation[2]],
          },
        },
      });
    },
    [selectedId, selectedBox, selectedEditable, updateAnnotation],
  );
  const handleFitSize = useCallback(() => applyFit(fitSize), [applyFit]);
  const handleFitBottom = useCallback(() => applyFit(fitBottom), [applyFit]);
  const handleFitYaw = useCallback(() => applyFit(fitYaw), [applyFit]);
  const handleFitDefault = useCallback(() => applyFit(fitSizeAndBottom), [applyFit]);

  // Q (默认连击=收尺寸+贴地) / Shift+Q (仅收尺寸) / Alt+Q (仅贴地)。
  // 焦点在输入框时不拦截;未选中 / 不可编辑时跳过。Ctrl+Q 让给浏览器/系统。
  useEffect(() => {
    if (!selectedId || !selectedEditable) return;
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
  }, [selectedId, selectedEditable, handleFitSize, handleFitBottom, handleFitDefault]);

  // v0.13.8 · Delete/Backspace 删选中框:全局 dispatchKey 通路在 3D 台实测未触发,
  // 故 3D 本地接管(同 useWorkbenchShellModel.threeDOwnedKeys 把这俩键交给本地)。
  // 焦点在输入框时不拦截(避免 PSR 数值面板里 Backspace 删字误删框)。
  useEffect(() => {
    if (!selectedId || !selectedEditable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      handleDeleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedEditable, handleDeleteSelected]);

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
      if (!scene || !placeClass) return;
      const ground = scene.placeOnGround(clientX, clientY);
      if (!ground) return;
      const [l, w, h] = DEFAULT_BOX_SIZE;
      const geometry: Box3DGeometry = {
        type: "box_3d",
        center: [ground[0], ground[1], ground[2] + h / 2],
        size: [l, w, h],
        rotation: [0, 0, 0],
      };
      createAnnotation.mutate(
        {
          annotation_type: "box_3d",
          tool_unit_id: LIDAR_TOOL_UNIT,
          class_name: placeClass,
          geometry,
        },
        { onSuccess: (created) => onSelectBox(created.id) },
      );
      onSetThreeDTool("select"); // 单次放置后回到选择工具
    },
    [placeClass, createAnnotation, onSelectBox, onSetThreeDTool],
  );

  // v0.13.9 · 框选画框 (frustum 选点): 在 box 工具下按住拖出屏幕矩形 → 选中投影落在矩形内的真实
  // 点 → 取其 world AABB 建框 (psrFromPoints)。用屏幕投影选点而非投地面平面 → 对物体高度/视角零
  // 视差 (SUSTechPOINTS 范式)。拖动 < 阈值退化为旧的「点击放置固定框」(向后兼容)。
  // 仍建议在俯视(BEV)下框, 框选体验最佳; 但本法不再依赖视角无视差性。
  const handleBoxSelect = useCallback(
    (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const scene = sceneRef.current;
      if (!scene || !placeClass) return;
      const selected = scene.selectPointsInScreenRect(a.x, a.y, b.x, b.y);
      if (!selected) return; // 框内无点 → 不建框
      const psr = psrFromPoints(selected);
      const geometry: Box3DGeometry = {
        type: "box_3d",
        center: [psr.center[0], psr.center[1], psr.center[2]],
        size: [psr.size[0], psr.size[1], psr.size[2]],
        rotation: [psr.rotation[0], psr.rotation[1], psr.rotation[2]],
      };
      createAnnotation.mutate(
        {
          annotation_type: "box_3d",
          tool_unit_id: LIDAR_TOOL_UNIT,
          class_name: placeClass,
          geometry,
        },
        { onSuccess: (created) => onSelectBox(created.id) },
      );
      onSetThreeDTool("select"); // 单次画框后回到选择工具
    },
    [placeClass, createAnnotation, onSelectBox, onSetThreeDTool],
  );

  // mousedown 落点(像素): click 时若位移超阈值判为「转视角拖拽」, 不改选中/不放置。
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const DRAG_CLICK_TOL = 4; // px
  // v0.13.9 · 框选拖拽起点(client px)与屏上预览矩形(相对 viewportWrap px)。
  const boxSelectStartRef = useRef<{ x: number; y: number } | null>(null);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [previewRect, setPreviewRect] = useState<{
    l: number;
    t: number;
    w: number;
    h: number;
  } | null>(null);

  const handleViewportMouseDown = (e: React.MouseEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
    if (placing) {
      // 框选: 禁 orbit, 记起点; 实际 move/up 走 window 监听(见下方 effect), 拖出视口也能收尾。
      sceneRef.current?.setBoxSelecting(true);
      boxSelectStartRef.current = { x: e.clientX, y: e.clientY };
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
      if (!start) return;
      const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (dist <= DRAG_CLICK_TOL) handlePlace(e.clientX, e.clientY); // 退化为点击放置
      else handleBoxSelect(start, { x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isBoxSelecting, handlePlace, handleBoxSelect]);

  const handleViewportClick = (e: React.MouseEvent) => {
    // 拖拽 gizmo 结束的 click 不应改选中。
    if (sceneRef.current?.shouldIgnoreClick()) return;
    // 放置/框选已全程由 mousedown→window mouseup 接管, click 不再处理放置。
    if (placing) {
      pointerDownRef.current = null;
      return;
    }
    // OrbitControls 转视角拖拽松手也会触发 click: 位移超阈值视为拖拽, 保持当前选中。
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_CLICK_TOL) return;
    onSelectBox(sceneRef.current?.pickBox(e.clientX, e.clientY) ?? null);
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
    return [...groups.entries()];
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
        // v0.13.8 · 上色前为每个相机建一次深度栅格,colorize 内做 z-test 剔除被前景遮挡的背景点,
        // 避免 v0.13.6 「背景点取到前景像素」 的串色感。容差固定 OCCLUSION_TOL_M=0.10m(经验值)。
        const rasters = samples.map((s) =>
          buildDepthRaster(positions, s.calib, s.width, s.height),
        );
        scene.setPointColors(
          colorizePoints(positions, scene.getBaseColors(), samples, rasters),
        );
      }
      setColorizing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [colorizeOn, cameras, stats]);

  // v0.13.4 · 跨模态高亮集合:选中框 + 同 group_id 成员。3D 主视图仍按 selected 单框高亮,
  // overlay 按本集合高亮(为未来同组 2D 框成员预留;孤立框 group_id 为空时退化为仅选中本身)。
  const selectedGroupId = selectedAnn?.group_id ?? null;
  const highlightedIds = useMemo(() => {
    const s = new Set<string>();
    if (selectedId) s.add(selectedId);
    if (selectedGroupId != null) {
      for (const a of annotations ?? []) {
        if (a.group_id === selectedGroupId) s.add(a.id);
      }
    }
    return s;
  }, [selectedId, selectedGroupId, annotations]);

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
      selectedBox
        ? {
            center: selectedBox.center,
            size: selectedBox.size,
            rotation: selectedBox.rotation,
            color: selectedBox.color,
          }
        : null,
    [selectedBox],
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
        updateMutateRef.current({
          annotationId: selectedId,
          payload: { geometry: { type: "box_3d", center, size, rotation } },
        });
      } else {
        setDraftPsr({ id: selectedId, psr });
      }
    },
    [selectedId],
  );

  return (
    <div className={styles.root}>
      <div ref={viewportWrapRef} className={styles.viewportWrap}>
        <div
          ref={viewportRef}
          className={placing ? `${styles.viewport} ${styles.placing}` : styles.viewport}
          data-testid="pc-viewport"
          onMouseDown={handleViewportMouseDown}
          onClick={handleViewportClick}
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
        </div>

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
          {placing && (
            <span>· 拖框选 / 点击放置 {placeClass ?? ""} · V/Esc 取消</span>
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
              {lidarClasses.length > 0 ? (
                <select
                  className={styles.classSelect}
                  value={selectedClass ?? ""}
                  aria-label="框类别"
                  disabled={!selectedEditable}
                  onChange={(e) => handleChangeClass(e.target.value)}
                >
                  {/* 当前类别若不在配置集合内(历史数据)仍可见,不丢选中项 */}
                  {selectedClass && !lidarClasses.includes(selectedClass) && (
                    <option value={selectedClass}>{selectedClass}</option>
                  )}
                  {lidarClasses.map((c) => (
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
                : selectedLocked
                  ? "已锁定 · 点「已锁定」解锁后可编辑"
                  : "拖 gizmo 或改数值 · W 平移 / E 转 / R 缩放"}
            </div>
            {/* v0.13.8 · 选中框自动贴合:Q 默认连击(收尺寸+贴地);
                Shift+Q 仅收尺寸;Alt+Q 仅贴地;朝向(实验)仅按钮触发。 */}
            {selectedEditable && (
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
                  {g.reset && selectedEditable && (
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
                      disabled={!selectedEditable}
                      onChange={(e) => handleField(k, e.target.value)}
                      onBlur={() => handleFieldBlur(k)}
                    />
                  ))}
                </div>
              </div>
            ))}
            {selectedEditable && (
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={handleDeleteSelected}
              >
                删除框
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
              editable={selectedEditable}
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
            {cams.map((cam) => (
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

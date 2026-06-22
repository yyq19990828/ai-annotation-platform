/**
 * v0.17.x · 巨石拆分 Epic 收尾 —— 从 ThreeDWorkbench 抽出的 Three.js 场景生命周期 hook。
 *
 * 封装 `PointCloudScene` 的 实例化 / 销毁 / 偏好同步 / 点云加载 / 框图层 / gizmo 挂载 /
 * W-E-R 模式键 / 相机视图存档(rAF 防抖)。与 ThreeDWorkbench 的唯一耦合点 ——
 * gizmo 拖拽结束回写表单 + PATCH —— 走 `onTransformCommit` 回调参数注入,form / mutate /
 * history 仍由壳组件持有,边界干净。
 *
 * 守护:点云 E2E 护栏网(smoke 加载 / gizmo W 拖拽→PATCH / B 放置 / cx 编辑 / Q 贴合)。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";

import type { PointcloudCameraState } from "@/api/auth";
import type { WorkbenchLayoutPatch } from "@/pages/Workbench/state/useWorkbenchConfig";
import type { LidarAxisConvention } from "@/types";

import {
  PointCloudScene,
  type BoxPsr,
  type PointCloudStats,
  type PointCloudViewState,
  type SceneBox,
} from "./PointCloudScene";

interface UsePointCloudSceneParams {
  /** 渲染容器(壳组件持有的 DOM ref)。 */
  viewportRef: RefObject<HTMLDivElement | null>;
  /** 场景实例 ref —— 由壳组件持有(稳定),本 hook 负责其生命周期写入/清理;
   *  壳层各交互 handler(pickBox / placeOnGround / getPointPositions …)共用同一 ref。 */
  sceneRef: MutableRefObject<PointCloudScene | null>;
  /** 性能档位抽稀阈值。 */
  pcdDecimate: number;
  pointSize: number;
  showGrid: boolean;
  showAxisGizmo: boolean;
  /** OrbitControls 阻尼系数(数值,非开关)。 */
  cameraDamping: number;
  /** 是否把相机视角落库(跨帧/跨会话记忆)。 */
  persistCameraView: boolean;
  /** manifest 的点云 URL(presigned);缺省时不加载。 */
  pointCloudUrl: string | undefined;
  axisConvention: LidarAxisConvention;
  /** 标注框 → 渲染输入(选中态 / 颜色 / 草稿覆盖已在壳层算好)。 */
  boxes: SceneBox[];
  selectedId: string | null;
  /** 选中且可编辑时才挂 gizmo / 接 W-E-R。 */
  selectedPsrEditable: boolean;
  pointcloudCamera: PointcloudCameraState | null;
  onWorkbenchLayoutChange: (patch: WorkbenchLayoutPatch) => void;
  /** gizmo 拖拽结束:回写表单 + PATCH 持久化(壳层注入,闭合 form / mutate / history)。 */
  onTransformCommit: (id: string, psr: BoxPsr) => void;
}

interface UsePointCloudSceneResult {
  /** 载帧统计(渲染点数 / 抽稀);null = 未加载。其变化亦作"换帧"信号被壳层多处消费。 */
  stats: PointCloudStats | null;
  loadError: string | null;
}

export function usePointCloudScene(
  params: UsePointCloudSceneParams,
): UsePointCloudSceneResult {
  const {
    viewportRef,
    sceneRef,
    pcdDecimate,
    pointSize,
    showGrid,
    showAxisGizmo,
    cameraDamping,
    persistCameraView,
    pointCloudUrl,
    axisConvention,
    boxes,
    selectedId,
    selectedPsrEditable,
    pointcloudCamera,
    onWorkbenchLayoutChange,
    onTransformCommit,
  } = params;

  const [stats, setStats] = useState<PointCloudStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const persistCameraViewRef = useRef(persistCameraView);
  persistCameraViewRef.current = persistCameraView;
  const pointcloudCameraRef = useRef(pointcloudCamera);
  pointcloudCameraRef.current = pointcloudCamera;
  const onWorkbenchLayoutChangeRef = useRef(onWorkbenchLayoutChange);
  onWorkbenchLayoutChangeRef.current = onWorkbenchLayoutChange;
  const onTransformCommitRef = useRef(onTransformCommit);
  onTransformCommitRef.current = onTransformCommit;
  const cameraSaveRafRef = useRef<number | null>(null);
  const pendingCameraViewRef = useRef<PointCloudViewState | null>(null);

  const scheduleCameraViewSave = useCallback((view: PointCloudViewState) => {
    if (!persistCameraViewRef.current) return;
    pendingCameraViewRef.current = view;
    if (cameraSaveRafRef.current !== null) return;
    cameraSaveRafRef.current = window.requestAnimationFrame(() => {
      cameraSaveRafRef.current = null;
      const next = pendingCameraViewRef.current;
      pendingCameraViewRef.current = null;
      if (!next || !persistCameraViewRef.current) return;
      onWorkbenchLayoutChangeRef.current({ pointcloudCamera: next });
    });
  }, []);

  // 实例化 / 销毁 Scene(随容器挂载一次)。
  useEffect(() => {
    if (!viewportRef.current) return;
    const scene = new PointCloudScene(viewportRef.current, {
      decimateThreshold: pcdDecimate,
    });
    sceneRef.current = scene;
    scene.setPointSize(pointSize);
    scene.setGridVisible(showGrid);
    scene.setAxisGizmoVisible(showAxisGizmo);
    scene.setCameraDamping(cameraDamping);
    scene.setViewChangeHandler(scheduleCameraViewSave);
    // 拖拽结束:回写表单 + PATCH 持久化(壳层注入的 onTransformCommit,与数值面板共用持久化管线)。
    scene.setTransformHandler((id, psr) => onTransformCommitRef.current(id, psr));
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(viewportRef.current);
    return () => {
      if (cameraSaveRafRef.current !== null) {
        window.cancelAnimationFrame(cameraSaveRafRef.current);
        cameraSaveRafRef.current = null;
      }
      ro.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
    // 场景生命周期只跟 DOM 容器绑定;偏好变化由下方独立 effects 同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setPointSize(pointSize);
  }, [pointSize, stats, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setGridVisible(showGrid);
  }, [showGrid, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setAxisGizmoVisible(showAxisGizmo);
  }, [showAxisGizmo, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setCameraDamping(cameraDamping);
  }, [cameraDamping, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setDecimateThreshold(pcdDecimate);
  }, [pcdDecimate, sceneRef]);

  // manifest 到位后加载点云。
  // v0.13.11 · 传入 axisConvention,scene 内部加载完 PCD 立即把 positions 旋到 ISO 系。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !pointCloudUrl) return;
    let cancelled = false;
    setLoadError(null);
    scene
      .loadPcd(pointCloudUrl, axisConvention)
      .then((s) => {
        if (cancelled) return;
        if (persistCameraViewRef.current) {
          scene.applyViewState(pointcloudCameraRef.current);
        }
        setStats(s);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [pointCloudUrl, axisConvention, sceneRef]);

  // 同步 3D 框图层(标注 / 选中变化)。scene 在挂载 effect 里先建,本 effect 后跑。
  useEffect(() => {
    sceneRef.current?.setBoxes(boxes);
  }, [boxes, sceneRef]);

  // 选中框时挂变换 gizmo,取消选中时脱离(依赖 boxes 以确保 setBoxes 已建好该组);只读/锁定不挂。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (selectedId && selectedPsrEditable) scene.attachTransform(selectedId);
    else scene.detachTransform();
  }, [selectedId, boxes, selectedPsrEditable, sceneRef]);

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
  }, [selectedId, selectedPsrEditable, sceneRef]);

  return { stats, loadError };
}

/**
 * v0.13.2 · 点云查看器(只读 MVP)。
 *
 * 拉 point-cloud manifest → 用裸 Three.js(PointCloudScene)渲染主点云 + OrbitControls,
 * 旁边平铺各相机图(只读,不画投影框 —— 投影联动是 v0.13.4)。与 Konva 2D 工作台双栈隔离。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useAnnotations,
  useCreateAnnotation,
  useDeleteAnnotation,
  useTask,
  useUpdateAnnotation,
} from "@/hooks/useTasks";
import { useProject } from "@/hooks/useProjects";
import { classColorForCanvas } from "@/pages/Workbench/stage/colors";
import type { Box3DGeometry } from "@/types";

import { usePointCloudManifest } from "./usePointCloudManifest";
import {
  PointCloudScene,
  type PointCloudStats,
  type SceneBox,
} from "./PointCloudScene";
import styles from "./ThreeDWorkbench.module.css";

interface ThreeDWorkbenchProps {
  taskId: string | null;
  /** v0.13.3 · 锁定 task / viewer 角色时只读:不放置 / 不编辑 / 无 gizmo,仅看 + 选中查看数值。 */
  readOnly?: boolean;
}

// v0.13.3 · 新框默认尺寸(米,长宽高;约一辆轿车),放置后用面板/gizmo 精修。
const DEFAULT_BOX_SIZE: [number, number, number] = [4.0, 1.8, 1.6];
// 点云项目的 3D 框工具单位(类别 / 属性绑定都挂在它下面)。
const LIDAR_TOOL_UNIT = "lidar_box_3d";

// v0.13.3 · PSR 数值面板字段(中心 cx/cy/cz、尺寸 l/w/h、朝向 yaw)。
type PsrField = "cx" | "cy" | "cz" | "l" | "w" | "h" | "yaw";
const PSR_FIELDS: PsrField[] = ["cx", "cy", "cz", "l", "w", "h", "yaw"];
const SIZE_FIELDS = new Set<PsrField>(["l", "w", "h"]);
const PSR_GROUPS: { label: string; keys: PsrField[]; step: number; min?: number }[] = [
  { label: "中心 (m)", keys: ["cx", "cy", "cz"], step: 0.1 },
  { label: "尺寸 长宽高 (m)", keys: ["l", "w", "h"], step: 0.1, min: 0.1 },
  { label: "朝向 yaw (°)", keys: ["yaw"], step: 1 },
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
  };
}

export function ThreeDWorkbench({ taskId, readOnly = false }: ThreeDWorkbenchProps) {
  const { data: manifest, isLoading, error } = usePointCloudManifest(taskId, true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PointCloudScene | null>(null);
  const [stats, setStats] = useState<PointCloudStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pointSize, setPointSize] = useState(0.06);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  // 放置模式 + 待放置类别(进入放置时点地面创建一个默认框)。
  const [placing, setPlacing] = useState(false);
  const [placeClass, setPlaceClass] = useState<string | null>(null);
  // 类别就绪后给个默认值;当前选项被删时回落到首个。
  useEffect(() => {
    setPlaceClass((prev) =>
      prev && lidarClasses.includes(prev) ? prev : (lidarClasses[0] ?? null),
    );
  }, [lidarClasses]);
  const canPlace = !readOnly && lidarClasses.length > 0;

  // 选中框的 PSR 编辑表单(字符串值,允许清空 / 中间态如 "-" / "1.";解析有效时才提交)。
  // PATCH 防抖 250ms;yaw 以度展示。
  const [form, setForm] = useState<Record<PsrField, string> | null>(null);
  const patchTimer = useRef<number | null>(null);

  // 标注里的 3D 框(geometry.type==="box_3d")→ 渲染层输入(PSR + 类别色 + 选中态)。
  const boxes = useMemo<SceneBox[]>(() => {
    const list: SceneBox[] = [];
    for (const a of annotations ?? []) {
      const g = a.geometry as {
        type?: string;
        center?: number[];
        size?: number[];
        rotation?: number[];
      };
      if (g?.type !== "box_3d" || !g.center || !g.size || !g.rotation) continue;
      list.push({
        id: a.id,
        center: g.center as [number, number, number],
        // 尺寸取绝对值兜底:历史/缩放翻转可能写入负 size,负值会让框翻转、且卡住数值面板
        // 的 size>0 提交校验。渲染与面板初始化统一按正尺寸。
        size: g.size.map((v) => Math.abs(v)) as [number, number, number],
        rotation: g.rotation as [number, number, number],
        color: classColorForCanvas(a.class_name),
        selected: a.id === selectedId,
      });
    }
    return list;
  }, [annotations, selectedId]);

  const selectedBox = boxes.find((b) => b.id === selectedId) ?? null;
  const selectedClass =
    (annotations ?? []).find((a) => a.id === selectedId)?.class_name ?? null;

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
  useEffect(() => {
    const scene = sceneRef.current;
    const url = manifest?.point_cloud_url;
    if (!scene || !url) return;
    let cancelled = false;
    setLoadError(null);
    scene
      .loadPcd(url)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [manifest?.point_cloud_url]);

  // 同步 3D 框图层(标注 / 选中变化)。scene 在挂载 effect 里先建,本 effect 后跑。
  useEffect(() => {
    sceneRef.current?.setBoxes(boxes);
  }, [boxes]);

  // 选中框时挂变换 gizmo,取消选中时脱离(依赖 boxes 以确保 setBoxes 已建好该组);只读不挂。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (selectedId && !readOnly) scene.attachTransform(selectedId);
    else scene.detachTransform();
  }, [selectedId, boxes, readOnly]);

  // W/E/R 切 gizmo 模式(仅选中且可编辑时;焦点在输入框时不拦截)。
  useEffect(() => {
    if (!selectedId || readOnly) return;
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
  }, [selectedId, readOnly]);

  // 切任务清选中 + 退出放置。
  useEffect(() => {
    setSelectedId(null);
    setPlacing(false);
  }, [taskId]);

  // 进入放置模式时清选中,避免 gizmo 挡在点地面的路上。
  useEffect(() => {
    if (placing) setSelectedId(null);
  }, [placing]);

  // B 切换放置模式 / Esc 取消(焦点在输入框时不拦截;无可用类别时不进入)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") setPlacing(false);
      else if (e.key === "b" || e.key === "B") setPlacing((p) => (canPlace ? !p : false));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canPlace]);

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
        const geometry: Box3DGeometry = {
          type: "box_3d",
          center: [v.cx, v.cy, v.cz],
          size: [v.l, v.w, v.h],
          rotation: [0, 0, (v.yaw * Math.PI) / 180],
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
    setSelectedId(null);
  }, [selectedId, deleteAnnotation]);

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
        { onSuccess: (created) => setSelectedId(created.id) },
      );
      setPlacing(false);
    },
    [placeClass, createAnnotation],
  );

  const handleViewportClick = (e: React.MouseEvent) => {
    // 拖拽 gizmo 结束的 click 不应改选中。
    if (sceneRef.current?.shouldIgnoreClick()) return;
    if (placing) {
      handlePlace(e.clientX, e.clientY);
      return;
    }
    setSelectedId(sceneRef.current?.pickBox(e.clientX, e.clientY) ?? null);
  };

  const handlePointSize = (v: number) => {
    setPointSize(v);
    sceneRef.current?.setPointSize(v);
  };

  const cameras = manifest?.cameras ?? [];

  return (
    <div className={styles.root}>
      <div className={styles.viewportWrap}>
        <div
          ref={viewportRef}
          className={placing ? `${styles.viewport} ${styles.placing}` : styles.viewport}
          data-testid="pc-viewport"
          onClick={handleViewportClick}
        />

        {/* 控件浮条 */}
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => sceneRef.current?.resetView()}
          >
            重置视角
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
          {canPlace && (
            <>
              <select
                className={styles.btn}
                value={placeClass ?? ""}
                aria-label="放置类别"
                onChange={(e) => setPlaceClass(e.target.value)}
              >
                {lidarClasses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={placing ? `${styles.btn} ${styles.btnActive}` : styles.btn}
                aria-pressed={placing}
                onClick={() => setPlacing((p) => !p)}
              >
                {placing ? "点地面放置 · Esc 取消" : "放置框 (B)"}
              </button>
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
          {selectedBox && (
            <span>
              · 选中 {selectedClass ?? ""} 中心 [
              {selectedBox.center.map((n) => n.toFixed(2)).join(", ")}]
            </span>
          )}
        </div>

        {/* 选中框 PSR 数值编辑面板(右上) */}
        {selectedBox && form && (
          <div className={styles.editPanel}>
            <div className={styles.editTitle}>
              <span>3D 框 · {selectedClass ?? ""}</span>
            </div>
            <div className={styles.editGroupLabel}>
              {readOnly ? "只读 · 锁定 / 审阅态" : "拖 gizmo 或改数值 · W 平移 / E 转 / R 缩放"}
            </div>
            {PSR_GROUPS.map((g) => (
              <div key={g.label}>
                <div className={styles.editGroupLabel}>{g.label}</div>
                <div className={styles.editRow}>
                  {g.keys.map((k) => (
                    <input
                      key={k}
                      type="number"
                      step={g.step}
                      min={g.min}
                      value={form[k]}
                      aria-label={k}
                      disabled={readOnly}
                      onChange={(e) => handleField(k, e.target.value)}
                      onBlur={() => handleFieldBlur(k)}
                    />
                  ))}
                </div>
              </div>
            ))}
            {!readOnly && (
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
      </div>

      {/* 相机图面板(只读) */}
      {cameras.length > 0 && (
        <div className={styles.cameraStrip}>
          {cameras.map((cam) => (
            <figure key={cam.role} className={styles.cameraItem}>
              <img src={cam.image_url} alt={cam.name} loading="lazy" />
              <figcaption>
                {cam.name}
                {cam.calibration ? "" : " · 无标定"}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

export default ThreeDWorkbench;

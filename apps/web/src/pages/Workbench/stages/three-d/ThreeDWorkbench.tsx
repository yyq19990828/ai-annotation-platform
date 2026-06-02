/**
 * v0.13.2 · 点云查看器(只读 MVP)。
 *
 * 拉 point-cloud manifest → 用裸 Three.js(PointCloudScene)渲染主点云 + OrbitControls,
 * 旁边平铺各相机图(只读,不画投影框 —— 投影联动是 v0.13.4)。与 Konva 2D 工作台双栈隔离。
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { useAnnotations } from "@/hooks/useTasks";
import { classColorForCanvas } from "@/pages/Workbench/stage/colors";

import { usePointCloudManifest } from "./usePointCloudManifest";
import {
  PointCloudScene,
  type PointCloudStats,
  type SceneBox,
} from "./PointCloudScene";
import styles from "./ThreeDWorkbench.module.css";

interface ThreeDWorkbenchProps {
  taskId: string | null;
}

export function ThreeDWorkbench({ taskId }: ThreeDWorkbenchProps) {
  const { data: manifest, isLoading, error } = usePointCloudManifest(taskId, true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PointCloudScene | null>(null);
  const [stats, setStats] = useState<PointCloudStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pointSize, setPointSize] = useState(0.06);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: annotations } = useAnnotations(taskId ?? undefined);

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
        size: g.size as [number, number, number],
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

  // 切任务清选中。
  useEffect(() => {
    setSelectedId(null);
  }, [taskId]);

  const handleViewportClick = (e: React.MouseEvent) => {
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
          className={styles.viewport}
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

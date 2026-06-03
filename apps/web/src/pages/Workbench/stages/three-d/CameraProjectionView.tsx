/**
 * v0.13.4 · 单相机视图 = 只读图 + 投影 overlay(canvas)。
 *
 * 把各 3D 框经该相机标定(SensorCalibration)投影成 12 边线框,叠在图上;点投影框可反选对应
 * 3D 框(命中测试 → onSelectBox)。投影**实时**:消费同一份 boxes + highlightedIds,框 PSR / 选中
 * 变化即重绘(useUpdateAnnotation 乐观更新会即时把新几何写入 annotations,故面板 / gizmo / 列表
 * 改框后 overlay 立刻跟随)。无标定的相机降级:不画投影、不报错。
 *
 * 缩放约定:intrinsic 基于图像**原始分辨率**,投影出的像素是原图坐标;overlay 按
 *   显示尺寸 / 自然尺寸(clientWidth/naturalWidth)比例缩放后绘制,`ResizeObserver` + onLoad 重算。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { hexToRgba } from "@/pages/Workbench/stage/colors";
import type { SensorCalibration } from "@/types";

import { psrToCorners } from "./geometry/box3d";
import { BOX_EDGES, projectPoints } from "./geometry/projection";
import { buildDepthRaster, sampleDepth, type DepthRaster } from "./geometry/depthmap";
import type { SceneBox } from "./PointCloudScene";
import styles from "./ThreeDWorkbench.module.css";

interface CameraProjectionViewProps {
  name: string;
  imageUrl: string;
  calibration?: SensorCalibration | null;
  /** 非隐藏的 3D 框(PSR + 类别色),与主视图同源。 */
  boxes: SceneBox[];
  /** 需高亮的框 id(选中框 + 同 group_id 成员);决定描边粗细 / 填充。 */
  highlightedIds: Set<string>;
  /** 点投影框反选(命中最小面积框,前景优先)。 */
  onSelectBox: (id: string | null) => void;
  /** 该相机是否最正对当前选中框(可见角点最多者);用于 figcaption 角标。 */
  bestForSelected?: boolean;
  /** v0.13.6 · 点云坐标(N*3,lidar/world 系);深度提示开启时建相机深度栅格。 */
  pointPositions?: Float32Array | null;
  /** v0.13.6 · 深度提示开关:开 → 画深度热力图 + 图上 hover 读出最近点深度/3D。 */
  showDepth?: boolean;
}

// 一个框至少有这么多可见角点才参与命中测试(避免擦边框误选)。
const MIN_VISIBLE_FOR_HIT = 3;

export function CameraProjectionView({
  name,
  imageUrl,
  calibration,
  boxes,
  highlightedIds,
  onSelectBox,
  bestForSelected = false,
  pointPositions = null,
  showDepth = false,
}: CameraProjectionViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 命中测试用:每框可见投影角点的显示坐标包围盒(id + 矩形 + 面积),draw 时同步。
  const hitBoxesRef = useRef<
    { id: string; x0: number; y0: number; x1: number; y1: number; area: number }[]
  >([]);
  // v0.13.6 · 深度提示:相机深度栅格(state,变化时驱动一次重绘)+ hover 读数(不入 draw 依赖,不触发重绘)。
  const [raster, setRaster] = useState<DepthRaster | null>(null);
  const [natSize, setNatSize] = useState<{ w: number; h: number } | null>(null);
  const [hover, setHover] = useState<{ depth: number; point: [number, number, number] } | null>(null);

  // 深度栅格:开关开 + 有点 + 有标定 + 知道原图尺寸时建一次(换帧/换相机重建);否则清空。
  useEffect(() => {
    if (showDepth && pointPositions && calibration && natSize) {
      setRaster(buildDepthRaster(pointPositions, calibration, natSize.w, natSize.h));
    } else {
      setRaster(null);
      setHover(null);
    }
  }, [showDepth, pointPositions, calibration, natSize]);

  const draw = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const cssW = img.clientWidth;
    const cssH = img.clientHeight;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    hitBoxesRef.current = [];
    if (!cssW || !cssH || !natW || !natH) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!calibration) return; // 无标定 → 降级不画

    const sx = cssW / natW;
    const sy = cssH / natH;

    // v0.13.6 · 深度热力图:遍历栅格非空格,在投影像素画按深度着色的点(近→远 = 红→蓝)。
    // 画在框线之下。深度归一化到 [minDepth, maxDepth],hue 0(红,近)→ 240(蓝,远)。
    if (showDepth && raster && isFinite(raster.minDepth)) {
      const span = raster.maxDepth - raster.minDepth || 1;
      const cellsN = raster.cols * raster.rows;
      for (let c = 0; c < cellsN; c++) {
        const d = raster.depth[c];
        if (!isFinite(d)) continue;
        const t = (d - raster.minDepth) / span;
        ctx.fillStyle = `hsl(${240 * t}, 90%, 55%)`;
        ctx.fillRect(raster.u[c] * sx - 1, raster.v[c] * sy - 1, 2, 2);
      }
    }

    // 高亮框最后画(描边置顶);同序更新命中包围盒。
    const ordered = [...boxes].sort(
      (a, b) => Number(highlightedIds.has(a.id)) - Number(highlightedIds.has(b.id)),
    );

    for (const b of ordered) {
      const corners = psrToCorners(b.center, b.size, b.rotation);
      const { pixels, visible } = projectPoints(corners, calibration);
      if (!visible.some(Boolean)) continue; // 全角点在相机后方 / 不可见 → 该相机不画此框

      const disp = pixels.map(
        ([u, v]) => [u * sx, v * sy] as [number, number],
      );
      const hl = highlightedIds.has(b.id);

      // 12 边线:两端都可见才连(MVP:出画角点的边不画,不做画面裁剪)。
      ctx.lineWidth = hl ? 2.5 : 1.25;
      ctx.strokeStyle = hexToRgba(b.color, hl ? 1 : 0.8);
      ctx.beginPath();
      for (const [i, j] of BOX_EDGES) {
        if (!visible[i] || !visible[j]) continue;
        ctx.moveTo(disp[i][0], disp[i][1]);
        ctx.lineTo(disp[j][0], disp[j][1]);
      }
      ctx.stroke();

      // 可见角点包围盒:既作淡填充(高亮时),也作命中区。
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      let visCount = 0;
      for (let k = 0; k < disp.length; k++) {
        if (!visible[k]) continue;
        visCount++;
        x0 = Math.min(x0, disp[k][0]);
        y0 = Math.min(y0, disp[k][1]);
        x1 = Math.max(x1, disp[k][0]);
        y1 = Math.max(y1, disp[k][1]);
      }
      if (hl && visCount >= 2) {
        ctx.fillStyle = hexToRgba(b.color, 0.14);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      if (visCount >= MIN_VISIBLE_FOR_HIT) {
        hitBoxesRef.current.push({
          id: b.id,
          x0,
          y0,
          x1,
          y1,
          area: Math.max(1, (x1 - x0) * (y1 - y0)),
        });
      }
    }
  }, [boxes, calibration, highlightedIds, showDepth, raster]);

  // 数据 / 标定变化重绘。
  useEffect(() => {
    draw();
  }, [draw]);

  // 图尺寸变化(响应式布局 / 懒加载)重算缩放并重绘。
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(img);
    return () => ro.disconnect();
  }, [draw]);

  // 图加载后记下原图分辨率(深度栅格 / 投影都基于 intrinsic 原图坐标)+ 重绘。
  const handleImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (img?.naturalWidth) setNatSize({ w: img.naturalWidth, h: img.naturalHeight });
    draw();
  }, [draw]);

  // v0.13.6 · 深度提示 hover:光标→原图像素→查栅格最近点深度/3D。setHover 不入 draw 依赖,故不触发重绘。
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!showDepth || !raster) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const u = ((e.clientX - rect.left) / rect.width) * raster.width;
      const v = ((e.clientY - rect.top) / rect.height) * raster.height;
      setHover(sampleDepth(raster, u, v));
    },
    [showDepth, raster],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // 命中含点的最小面积框(前景 / 近处框面积小,优先选中)。
      let hitId: string | null = null;
      let hitArea = Infinity;
      for (const hb of hitBoxesRef.current) {
        if (x >= hb.x0 && x <= hb.x1 && y >= hb.y0 && y <= hb.y1 && hb.area < hitArea) {
          hitArea = hb.area;
          hitId = hb.id;
        }
      }
      if (hitId) onSelectBox(hitId);
    },
    [onSelectBox],
  );

  return (
    <figure className={styles.cameraItem}>
      <div className={styles.cameraView}>
        <img ref={imgRef} src={imageUrl} alt={name} loading="lazy" onLoad={handleImgLoad} />
        <canvas
          ref={canvasRef}
          className={styles.cameraCanvas}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHover(null)}
        />
      </div>
      <figcaption>
        {name}
        {bestForSelected && " · 正对"}
        {calibration ? "" : " · 无标定"}
        {showDepth && hover && ` · ${hover.depth.toFixed(1)}m`}
      </figcaption>
    </figure>
  );
}

export default CameraProjectionView;

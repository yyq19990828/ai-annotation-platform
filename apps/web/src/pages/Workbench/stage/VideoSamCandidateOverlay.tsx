/**
 * v0.21.23 · 视频交互式 SAM 候选浮层（smart-point / smart-box）。
 *
 * **不复用 `VideoKonvaAiLayer`**：那一层是**批量候选**（落库 `Prediction`）的渲染，其上游
 * `aiBoxFrames.resolveAiBoxAtFrame` 是帧作用域去重的 SSOT 且只认 bbox 类几何（其余类型会
 * fallthrough 成轴对齐 Rect 画错）。交互式候选是**瞬态、不落库、只属当前帧**，混进去会污染
 * 那个 SSOT。图片侧同样把 `SamCandidateOverlay` 作为独立组件，此处与之对齐。
 *
 * 坐标一律归一化 [0,1]，渲染时乘 stage 尺寸（memory「交互候选坐标系」：百分比会飞出画布）。
 */
import { useEffect, useState } from "react";
import { Circle, Line, Rect } from "react-konva";

/** 与图片侧 SAM_CANDIDATE_STROKE 同值（canvas 数据域颜色，非 Tailwind token）。 */
const SAM_STROKE = "#a855f7";
const POSITIVE_POINT = "#22c55e";
const NEGATIVE_POINT = "#ef4444";
// 屏幕像素：虚线段 + 间隔（一周期 10px）；流速 px/秒（marching ants）。
const SAM_DASH: [number, number] = [6, 4];
const SAM_DASH_PERIOD = SAM_DASH[0] + SAM_DASH[1];
const SAM_FLOW_SPEED = 22;

function hexToRgba(hex: string, alpha: number): string {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type VideoSamCandidateShape = {
  id: string;
  type: string;
  points?: [number, number][];
  bbox?: { x: number; y: number; width: number; height: number };
};

export interface VideoSamCandidateOverlayProps {
  candidates: VideoSamCandidateShape[];
  activeIdx: number;
  /** 当前点会话已落的正/负点，供多点精修时可视化。 */
  sessionPoints: { pt: [number, number]; polarity: 1 | 0 }[];
  /** stage 尺寸（像素）。 */
  width: number;
  height: number;
  scale: number;
}

export function VideoSamCandidateOverlay({
  candidates,
  activeIdx,
  sessionPoints,
  width,
  height,
  scale,
}: VideoSamCandidateOverlayProps) {
  const hasCandidates = candidates.length > 0;
  const [dashOffset, setDashOffset] = useState(0);

  useEffect(() => {
    if (!hasCandidates) return;
    let raf = 0;
    let start: number | null = null;
    const loop = (t: number) => {
      if (start === null) start = t;
      // 负向偏移 → 虚线沿边缘向前流动；取模避免数值无限增大。
      setDashOffset(-(((t - start) / 1000) * SAM_FLOW_SPEED) % SAM_DASH_PERIOD);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [hasCandidates]);

  if (!hasCandidates && sessionPoints.length === 0) return null;

  const dash = [SAM_DASH[0] / scale, SAM_DASH[1] / scale];
  const offset = dashOffset / scale;

  return (
    <>
      {candidates.map((c, idx) => {
        const isActive = idx === activeIdx;
        const strokeWidth = (isActive ? 3.5 : 2.5) / scale;
        const common = {
          stroke: SAM_STROKE,
          strokeWidth,
          dash,
          dashOffset: offset,
          fill: hexToRgba(SAM_STROKE, isActive ? 0.18 : 0.08),
          opacity: isActive ? 1 : 0.7,
          listening: false as const,
        };

        if (c.type === "rectanglelabels" && c.bbox) {
          return (
            <Rect
              key={c.id}
              x={c.bbox.x * width}
              y={c.bbox.y * height}
              width={c.bbox.width * width}
              height={c.bbox.height * height}
              {...common}
            />
          );
        }
        if (!c.points || c.points.length < 3) return null;
        const flat: number[] = [];
        for (const [x, y] of c.points) flat.push(x * width, y * height);
        return <Line key={c.id} points={flat} closed {...common} />;
      })}

      {/* 点会话可视化：正点绿、负点红（Alt 点击落负点做精修）。 */}
      {sessionPoints.map((sp, i) => (
        <Circle
          key={`sp-${i}`}
          x={sp.pt[0] * width}
          y={sp.pt[1] * height}
          radius={4 / scale}
          fill={sp.polarity === 1 ? POSITIVE_POINT : NEGATIVE_POINT}
          stroke="#ffffff"
          strokeWidth={1.5 / scale}
          listening={false}
        />
      ))}
    </>
  );
}

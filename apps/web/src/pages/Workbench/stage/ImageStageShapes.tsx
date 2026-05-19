import type Konva from "konva";
import { Circle, Group, Label, Line, Rect, Tag, Text } from "react-konva";
import type { Annotation } from "@/types";
import { useMemo } from "react";
import type { ResizeDirection } from "./ResizeHandles";
import { classColorForCanvas, displayClassName, hexToRgba } from "./colors";
import { buildVertexIndex } from "./iou-index";
import type { Pt } from "./polygonGeom";
import { simplifyPolygon } from "./shared/geometry/simplify";
import {
  BOX_HANDLE_SCREEN_PX,
  BOX_LABEL_FONT_PX,
  BOX_LABEL_OFFSET_PX,
  BOX_LABEL_PAD_PX,
} from "./boxVisual";

// v0.10.4 I2.1 · Douglas-Peucker LOD: 仅在 polygon 不可编辑 / 未选中时启用；
// 简化阈值 ≈ 1 屏幕像素，避免视觉差异。
const LOD_VERTEX_THRESHOLD = 60; // ≤60 顶点不简化（O(n²) 渲染开销低于 RDP 设置成本）。
// v0.10.4 I2.3 · 编辑态顶点视口粗筛门限：>60 顶点才走 rbush 粗筛，避免小 polygon 开销。
const VERTEX_CULL_THRESHOLD = 60;

export interface ViewportBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const HANDLE_DIRECTIONS: { dir: ResizeDirection; cx: number; cy: number; cursor: string }[] = [
  { dir: "nw", cx: 0,   cy: 0,   cursor: "nwse-resize" },
  { dir: "n",  cx: 0.5, cy: 0,   cursor: "ns-resize" },
  { dir: "ne", cx: 1,   cy: 0,   cursor: "nesw-resize" },
  { dir: "e",  cx: 1,   cy: 0.5, cursor: "ew-resize" },
  { dir: "se", cx: 1,   cy: 1,   cursor: "nwse-resize" },
  { dir: "s",  cx: 0.5, cy: 1,   cursor: "ns-resize" },
  { dir: "sw", cx: 0,   cy: 1,   cursor: "nesw-resize" },
  { dir: "w",  cx: 0,   cy: 0.5, cursor: "ew-resize" },
];
interface KonvaBoxProps {
  b: Annotation;
  isAi: boolean;
  selected: boolean;
  editable: boolean;
  faded: boolean;
  /** v0.10.5 M4-β · I15 occluded：渲染为虚线 + 半透。 */
  occluded?: boolean;
  imgW: number;
  imgH: number;
  scale: number;
  onClick: (e?: Konva.KonvaEventObject<MouseEvent>) => void;
  onMoveStart: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null;
  onResizeStart: ((dir: ResizeDirection, e: Konva.KonvaEventObject<MouseEvent>) => void) | null;
}

/** I12 · 同 group_id 的多框共享同色虚线外圈; 用 group_id 哈希派生稳定色. */
export function groupOutlineColor(groupId: number): string {
  // 8 档预设色, modulo 取色; 与类别色刻意区分 (类别色来自 classColorForCanvas).
  const palette = [
    "#f59e0b", // amber
    "#10b981", // emerald
    "#ec4899", // pink
    "#8b5cf6", // violet
    "#06b6d4", // cyan
    "#ef4444", // red
    "#84cc16", // lime
    "#6366f1", // indigo
  ];
  return palette[Math.abs(groupId) % palette.length];
}

export function KonvaBox({
  b, isAi, selected, editable, faded, occluded = false,
  imgW, imgH, scale,
  onClick,
  onMoveStart,
  onResizeStart,
}: KonvaBoxProps) {
  const color = classColorForCanvas(b.cls);
  const sw = (selected ? 2 : 1.5) / scale;
  const handleSize = BOX_HANDLE_SCREEN_PX / scale;
  const labelFontSize = BOX_LABEL_FONT_PX / scale;
  const isUserSelected = selected && !isAi && editable;
  const labelText = isAi
    ? `✦ ${displayClassName(b.cls)} ${(b.conf * 100).toFixed(0)}%`
    : displayClassName(b.cls);

  return (
    <Group>
      <Rect
        x={b.x * imgW}
        y={b.y * imgH}
        width={b.w * imgW}
        height={b.h * imgH}
        stroke={color}
        strokeWidth={sw}
        dash={isAi || occluded ? [4 / scale, 3 / scale] : undefined}
        fill={hexToRgba(color, isAi ? 0.08 : 0.07)}
        opacity={faded ? 0.35 : occluded ? 0.5 : 1}
        shadowEnabled={selected && !faded}
        shadowColor={color}
        shadowBlur={8 / scale}
        shadowOpacity={0.4}
        onClick={(e) => { e.cancelBubble = true; onClick(e); }}
        onMouseDown={(e) => {
          if (!isUserSelected || e.evt.button !== 0 || !onMoveStart) return;
          e.cancelBubble = true;
          onMoveStart(e);
        }}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage && isUserSelected) stage.container().style.cursor = "move";
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "";
        }}
      />

      <Label x={b.x * imgW} y={b.y * imgH - BOX_LABEL_OFFSET_PX / scale} listening={false}>
        <Tag fill={color} cornerRadius={3 / scale} />
        <Text
          text={labelText}
          fill="white"
          fontSize={labelFontSize}
          padding={BOX_LABEL_PAD_PX / scale}
          fontFamily="var(--font-sans, sans-serif)"
        />
      </Label>

      {/* I12 · 同 group_id 第二层虚线外圈 (offset 4px / scale, 不阻挡 hit-test). */}
      {b.group_id != null && !isAi && (
        <Rect
          x={b.x * imgW - 4 / scale}
          y={b.y * imgH - 4 / scale}
          width={b.w * imgW + 8 / scale}
          height={b.h * imgH + 8 / scale}
          stroke={groupOutlineColor(b.group_id)}
          strokeWidth={1.5 / scale}
          dash={[6 / scale, 4 / scale]}
          fill="transparent"
          listening={false}
        />
      )}

      {isUserSelected && onResizeStart && HANDLE_DIRECTIONS.map(({ dir, cx, cy, cursor }) => (
        <Rect
          key={dir}
          x={(b.x + b.w * cx) * imgW - handleSize / 2}
          y={(b.y + b.h * cy) * imgH - handleSize / 2}
          width={handleSize}
          height={handleSize}
          fill="white"
          stroke={color}
          strokeWidth={1.5 / scale}
          cornerRadius={2 / scale}
          onMouseDown={(e) => {
            e.cancelBubble = true;
            onResizeStart(dir, e);
          }}
          onMouseEnter={(e) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = cursor;
          }}
          onMouseLeave={(e) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = "";
          }}
        />
      ))}
    </Group>
  );
}

interface KonvaPolygonProps {
  b: Annotation;
  isAi: boolean;
  selected: boolean;
  faded: boolean;
  /** v0.10.5 M4-β · I15 occluded：渲染为虚线 + 半透（与 selfIntersect 红色互斥）。 */
  occluded?: boolean;
  imgW: number;
  imgH: number;
  scale: number;
  onClick: (e?: Konva.KonvaEventObject<MouseEvent>) => void;
  points?: Pt[];
  selfIntersect?: boolean;
  editable?: boolean;
  onVertexMouseDown?: (vidx: number, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onEdgeMouseDown?: (edgeIdx: number, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onBodyMouseDown?: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null;
  /** v0.10.4 I2.3 · 归一化 [0,1] viewport bbox。提供后启用顶点视口粗筛。 */
  viewportBBox?: ViewportBBox;
}

export function KonvaPolygon({
  b, isAi, selected, faded, occluded = false, imgW, imgH, scale, onClick,
  points,
  selfIntersect,
  editable,
  onVertexMouseDown,
  onEdgeMouseDown,
  onBodyMouseDown,
  viewportBBox,
}: KonvaPolygonProps) {
  const color = classColorForCanvas(b.cls);
  const sw = (selected ? 2 : 1.5) / scale;
  const labelFontSize = BOX_LABEL_FONT_PX / scale;
  const labelText = isAi
    ? `✦ ${displayClassName(b.cls)} ${(b.conf * 100).toFixed(0)}%`
    : displayClassName(b.cls);
  const ps: Pt[] = points && points.length >= 3 ? points : (b.polygon ?? []);
  // I2.1 渲染层 LOD：编辑态 / 选中态用原顶点（保证手感）；其它态按 viewport scale 简化。
  const renderPs = useMemo<Pt[]>(() => {
    if (editable || selected) return ps;
    if (ps.length < LOD_VERTEX_THRESHOLD) return ps;
    if (scale <= 0 || imgW <= 0) return ps;
    // 视觉等价阈值 = 1 像素；归一化空间换算 ≈ 1 / (scale * imgW)。
    const epsilon = 1 / (scale * Math.max(imgW, imgH));
    return simplifyPolygon(ps, epsilon);
  }, [ps, editable, selected, scale, imgW, imgH]);
  const flat: number[] = [];
  for (const [px, py] of renderPs) flat.push(px * imgW, py * imgH);
  const strokeColor = selfIntersect ? "oklch(0.55 0.22 25)" : color;

  // v0.10.4 I2.3 · 编辑态下大 polygon 用 rbush 视口粗筛，省 Konva 节点数与 hit-test。
  // 只在 editable && ps.length>阈值 && 提供了 viewportBBox 时启用；否则全量渲染保持现有行为。
  const visibleVertexIdx = useMemo<Set<number> | null>(() => {
    if (!editable || !viewportBBox || ps.length < VERTEX_CULL_THRESHOLD) return null;
    const idx = buildVertexIndex(ps);
    return new Set(idx.verticesInBBox(viewportBBox));
  }, [editable, viewportBBox, ps]);

  return (
    <Group>
      <Line
        points={flat}
        closed
        stroke={strokeColor}
        strokeWidth={sw}
        dash={isAi || selfIntersect || occluded ? [4 / scale, 3 / scale] : undefined}
        fill={hexToRgba(color, isAi ? 0.08 : 0.07)}
        opacity={faded ? 0.35 : occluded ? 0.5 : 1}
        shadowEnabled={selected && !faded}
        shadowColor={selfIntersect ? "oklch(0.55 0.22 25)" : color}
        shadowBlur={8 / scale}
        shadowOpacity={0.4}
        onClick={(e) => { e.cancelBubble = true; onClick(e); }}
        onMouseDown={(e) => {
          if (!editable || !onBodyMouseDown || e.evt.button !== 0) return;
          e.cancelBubble = true;
          onBodyMouseDown(e);
        }}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage && editable && onBodyMouseDown) stage.container().style.cursor = "move";
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "";
        }}
      />
      {flat.length >= 2 && (
        <Label x={flat[0]} y={flat[1] - BOX_LABEL_OFFSET_PX / scale} listening={false}>
          <Tag fill={strokeColor} cornerRadius={3 / scale} />
          <Text
            text={labelText + (selfIntersect ? " ⚠" : "")}
            fill="white"
            fontSize={labelFontSize}
            padding={BOX_LABEL_PAD_PX / scale}
            fontFamily="var(--font-sans, sans-serif)"
          />
        </Label>
      )}

      {editable && onEdgeMouseDown && ps.map((_, i) => {
        // I2.3 · 边视口粗筛：边的两个端点都不在视口内 → 跳过（边完全在屏外）。
        if (visibleVertexIdx && !visibleVertexIdx.has(i) && !visibleVertexIdx.has((i + 1) % ps.length)) {
          return null;
        }
        const a = ps[i];
        const c = ps[(i + 1) % ps.length];
        return (
          <Line
            key={`edge-${i}`}
            points={[a[0] * imgW, a[1] * imgH, c[0] * imgW, c[1] * imgH]}
            stroke="rgba(0,0,0,0)"
            strokeWidth={10 / scale}
            hitStrokeWidth={10 / scale}
            onMouseDown={(e) => {
              if (!e.evt.altKey) return;
              e.cancelBubble = true;
              onEdgeMouseDown(i, e);
            }}
            onMouseEnter={(e) => {
              if (!e.evt.altKey) return;
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "copy";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "";
            }}
          />
        );
      })}

      {editable && onVertexMouseDown && ps.map(([px, py], i) => {
        // I2.3 · 顶点视口粗筛：屏外顶点不渲染 Circle 手柄。
        if (visibleVertexIdx && !visibleVertexIdx.has(i)) return null;
        return (
        <Circle
          key={`v-${i}`}
          x={px * imgW}
          y={py * imgH}
          radius={6 / scale}
          hitStrokeWidth={9 / scale}
          fill="white"
          stroke={color}
          strokeWidth={1.5 / scale}
          onMouseDown={(e) => {
            e.cancelBubble = true;
            onVertexMouseDown(i, e);
          }}
          onMouseEnter={(e) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = e.evt.shiftKey ? "not-allowed" : "grab";
          }}
          onMouseLeave={(e) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = "";
          }}
        />
        );
      })}
    </Group>
  );
}

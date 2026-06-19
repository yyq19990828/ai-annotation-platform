/**
 * v0.13.7 · 悬浮相机面板(L2):把 CameraProjectionView 包一层可折叠 chrome,
 * 悬浮在主 3D 视图之上。位置由外层「按朝向分组的定位容器」决定(本组件不自带定位)。
 *
 * 展开:细标题条(收起钮)+ 相机图(自带 figcaption:名字 · 正对 · 深度)。
 * 折叠:仅留一个贴边小标签「名字 ▸」。
 *
 * v0.15.x · 位置 / 折叠态改为受控:由壳层从 user config(preferences.workbench.layout
 * .cameraPanels)按 role 传入并回写,后端 / 管理端可一键复位。本组件不再读写 localStorage。
 * v0.17.6 · module.css → Tailwind。
 */
import { useCallback, useMemo } from "react";
import type { CSSProperties } from "react";

import type { SensorCalibration } from "@/types";

import type { FloatingPanelBounds, FloatingPanelPoint } from "../../shell/useDragMove";
import { useDragMove } from "../../shell/useDragMove";
import { useElementStyle } from "@/components/ui/useElementStyle";
import CameraProjectionView from "./CameraProjectionView";
import type { SceneBox } from "./PointCloudScene";

// v0.17.6 · Tailwind class constants (was ThreeDWorkbench.module.css).
const CAM_PANEL =
  "flex flex-col w-[210px] rounded-md border border-border bg-card shadow-sm overflow-hidden";
const CAM_PANEL_FLOATING =
  "fixed left-[var(--cam-panel-x)] top-[var(--cam-panel-y)] z-[5] pointer-events-auto";
const CAM_PANEL_DRAGGING = "select-none";
const CAM_PANEL_BAR = "flex justify-end gap-1 px-1 py-0.5 border-b border-border cursor-grab";
const FLOAT_TOGGLE_BTN =
  "appearance-none px-2 py-0.5 rounded-sm border border-border bg-background text-muted-foreground cursor-pointer text-[11px] hover:border-brand hover:text-brand";
const CAM_PANEL_TAB =
  "appearance-none px-2.5 py-1.5 rounded-md border border-border bg-card shadow-sm text-foreground cursor-pointer text-xs whitespace-nowrap hover:border-brand hover:text-brand";

interface FloatingCameraPanelProps {
  /** 相机 role(canonical),作 user config cameraPanels 的 key 与稳定标识。 */
  role: string;
  name: string;
  imageUrl: string;
  calibration?: SensorCalibration | null;
  boxes: SceneBox[];
  highlightedIds: Set<string>;
  onSelectBox: (id: string | null, opts?: { shift?: boolean }) => void;
  bestForSelected?: boolean;
  pointPositions?: Float32Array | null;
  showDepth?: boolean;
  /** v0.13.7 · 点「⛶」放大该相机为大图浮层(L3)。 */
  onEnlarge?: () => void;
  autoCollapsed?: boolean;
  dragBounds?: FloatingPanelBounds | null;
  /** v0.15.x · 受控位置(来自 user config);null = 未拖动,用默认贴边位。 */
  position?: FloatingPanelPoint | null;
  /** v0.15.x · 受控折叠态(来自 user config);undefined = 跟随 autoCollapsed。 */
  collapsed?: boolean;
  /** v0.15.x · 拖动 / 归位回写;pos=null 表示归位(清除自定义位置)。 */
  onPositionChange: (role: string, pos: FloatingPanelPoint | null) => void;
  onCollapsedChange: (role: string, collapsed: boolean) => void;
}

const CAM_PANEL_SIZE = { w: 210, h: 170 };

export function FloatingCameraPanel({
  role,
  name,
  onEnlarge,
  autoCollapsed = false,
  dragBounds,
  position = null,
  collapsed: collapsedProp,
  onPositionChange,
  onCollapsedChange,
  ...camProps
}: FloatingCameraPanelProps) {
  const collapsed = collapsedProp ?? autoCollapsed;
  const dragPosition = useMemo(
    () => position ?? { x: (dragBounds?.left ?? 0) + 12, y: (dragBounds?.top ?? 0) + 12 },
    [dragBounds?.left, dragBounds?.top, position],
  );

  const setCollapsed = useCallback(
    (next: boolean) => onCollapsedChange(role, next),
    [onCollapsedChange, role],
  );
  const setPosition = useCallback(
    (next: FloatingPanelPoint) => onPositionChange(role, next),
    [onPositionChange, role],
  );
  const freezeCurrentPosition = useCallback(
    (next: FloatingPanelPoint) => {
      if (!position) onPositionChange(role, next);
    },
    [onPositionChange, position, role],
  );
  const resetPosition = useCallback(
    () => onPositionChange(role, null),
    [onPositionChange, role],
  );
  const { handleProps, isDragging } = useDragMove({
    position: dragPosition,
    size: CAM_PANEL_SIZE,
    bounds: dragBounds,
    onStart: freezeCurrentPosition,
    onChange: setPosition,
  });

  const floatingPoint = position ?? (isDragging ? dragPosition : null);

  // v0.17.6 · useElementStyle replaces style={floatingStyle} for dynamic CSS variables.
  const panelRef = useElementStyle<HTMLDivElement>(
    floatingPoint
      ? ({ "--cam-panel-x": `${floatingPoint.x}px`, "--cam-panel-y": `${floatingPoint.y}px` } as CSSProperties)
      : undefined,
  );
  const tabRef = useElementStyle<HTMLButtonElement>(
    floatingPoint
      ? ({ "--cam-panel-x": `${floatingPoint.x}px`, "--cam-panel-y": `${floatingPoint.y}px` } as CSSProperties)
      : undefined,
  );

  if (collapsed) {
    return (
      <button
        ref={tabRef}
        type="button"
        className={`${CAM_PANEL_TAB} ${floatingPoint ? CAM_PANEL_FLOATING : ""}`}
        onClick={() => setCollapsed(false)}
        title="展开相机"
      >
        {name} ▸
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      className={[CAM_PANEL, floatingPoint ? CAM_PANEL_FLOATING : "", isDragging ? CAM_PANEL_DRAGGING : ""]
        .filter(Boolean)
        .join(" ")}
      data-floating-panel
    >
      <div
        className={isDragging ? `${CAM_PANEL_BAR} !cursor-grabbing` : CAM_PANEL_BAR}
        onDoubleClick={resetPosition}
        title="拖动相机面板，双击归位"
        {...handleProps}
      >
        {onEnlarge && (
          <button
            type="button"
            className={FLOAT_TOGGLE_BTN}
            onClick={onEnlarge}
            title="放大相机"
          >
            ⛶
          </button>
        )}
        {position && (
          <button
            type="button"
            className={FLOAT_TOGGLE_BTN}
            onClick={resetPosition}
            title="归位"
          >
            归位
          </button>
        )}
        <button
          type="button"
          className={FLOAT_TOGGLE_BTN}
          onClick={() => setCollapsed(true)}
          title="收起相机"
        >
          收起 ▾
        </button>
      </div>
      <CameraProjectionView name={name} {...camProps} />
    </div>
  );
}

export default FloatingCameraPanel;

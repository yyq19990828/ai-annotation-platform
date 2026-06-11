/**
 * v0.13.7 · 悬浮相机面板(L2):把 CameraProjectionView 包一层可折叠 chrome,
 * 悬浮在主 3D 视图之上。位置由外层「按朝向分组的定位容器」决定(本组件不自带定位)。
 *
 * 展开:细标题条(收起钮)+ 相机图(自带 figcaption:名字 · 正对 · 深度)。
 * 折叠:仅留一个贴边小标签「名字 ▸」。
 *
 * v0.15.x · 位置 / 折叠态改为受控:由壳层从 user config(preferences.workbench.layout
 * .cameraPanels)按 role 传入并回写,后端 / 管理端可一键复位。本组件不再读写 localStorage。
 */
import { useCallback, useMemo } from "react";
import type { CSSProperties } from "react";

import type { SensorCalibration } from "@/types";

import type { FloatingPanelBounds, FloatingPanelPoint } from "../../shell/useDragMove";
import { useDragMove } from "../../shell/useDragMove";
import CameraProjectionView from "./CameraProjectionView";
import type { SceneBox } from "./PointCloudScene";
import styles from "./ThreeDWorkbench.module.css";

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
  const floatingStyle = floatingPoint
    ? ({
        "--cam-panel-x": `${floatingPoint.x}px`,
        "--cam-panel-y": `${floatingPoint.y}px`,
      } as CSSProperties)
    : undefined;

  if (collapsed) {
    return (
      <button
        type="button"
        className={`${styles.camPanelTab} ${floatingPoint ? styles.camPanelFloating : ""}`}
        // eslint-disable-next-line no-restricted-syntax -- 拖动位置是逐帧动态值, 经 CSS custom property 注入
        style={floatingStyle}
        onClick={() => setCollapsed(false)}
        title="展开相机"
      >
        {name} ▸
      </button>
    );
  }

  return (
    <div
      className={`${styles.camPanel} ${floatingPoint ? styles.camPanelFloating : ""} ${
        isDragging ? styles.camPanelDragging : ""
      }`}
      // eslint-disable-next-line no-restricted-syntax -- 拖动位置是逐帧动态值, 经 CSS custom property 注入
      style={floatingStyle}
      data-floating-panel
    >
      <div
        className={styles.camPanelBar}
        onDoubleClick={resetPosition}
        title="拖动相机面板，双击归位"
        {...handleProps}
      >
        {onEnlarge && (
          <button
            type="button"
            className={styles.floatToggleBtn}
            onClick={onEnlarge}
            title="放大相机"
          >
            ⛶
          </button>
        )}
        {position && (
          <button
            type="button"
            className={styles.floatToggleBtn}
            onClick={resetPosition}
            title="归位"
          >
            归位
          </button>
        )}
        <button
          type="button"
          className={styles.floatToggleBtn}
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

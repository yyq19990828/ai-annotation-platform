/**
 * v0.13.7 · 悬浮相机面板(L2):把 CameraProjectionView 包一层可折叠 chrome,
 * 悬浮在主 3D 视图之上。位置由外层「按朝向分组的定位容器」决定(本组件不自带定位)。
 *
 * 展开:细标题条(收起钮)+ 相机图(自带 figcaption:名字 · 正对 · 深度)。
 * 折叠:仅留一个贴边小标签「名字 ▸」。折叠态按 role 存 localStorage(会话间记住)。
 */
import { useCallback, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type { SensorCalibration } from "@/types";

import type { FloatingPanelBounds, FloatingPanelPoint } from "../../shell/useDragMove";
import { useDragMove } from "../../shell/useDragMove";
import CameraProjectionView from "./CameraProjectionView";
import type { SceneBox } from "./PointCloudScene";
import styles from "./ThreeDWorkbench.module.css";

interface FloatingCameraPanelProps {
  /** 相机 role(canonical),作折叠态 localStorage key 与稳定标识。 */
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
}

const collapseKey = (role: string) => `pcwb:cam-collapsed:${role}`;
const positionKey = (role: string) => `pcwb:cam-pos:${role}`;
const CAM_PANEL_SIZE = { w: 210, h: 170 };

function readCollapsed(role: string): boolean | null {
  try {
    const raw = localStorage.getItem(collapseKey(role));
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* 隐私模式 / 配额满:忽略,只丢持久化不丢功能 */
  }
  return null;
}

function readPosition(role: string): FloatingPanelPoint | null {
  try {
    const raw = localStorage.getItem(positionKey(role));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatingPanelPoint>;
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return { x: Number(parsed.x), y: Number(parsed.y) };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function FloatingCameraPanel({
  role,
  name,
  onEnlarge,
  autoCollapsed = false,
  dragBounds,
  ...camProps
}: FloatingCameraPanelProps) {
  const [manualCollapsed, setManualCollapsed] = useState<boolean | null>(() => readCollapsed(role));
  const [position, setPosition] = useState<FloatingPanelPoint | null>(() => readPosition(role));
  const collapsed = manualCollapsed ?? autoCollapsed;
  const dragPosition = useMemo(
    () => position ?? { x: (dragBounds?.left ?? 0) + 12, y: (dragBounds?.top ?? 0) + 12 },
    [dragBounds?.left, dragBounds?.top, position],
  );

  const setAndPersist = useCallback(
    (next: boolean) => {
      setManualCollapsed(next);
      try {
        localStorage.setItem(collapseKey(role), next ? "1" : "0");
      } catch {
        /* 隐私模式 / 配额满:忽略,只丢持久化不丢功能 */
      }
    },
    [role],
  );
  const setAndPersistPosition = useCallback(
    (next: FloatingPanelPoint) => {
      setPosition(next);
      try {
        localStorage.setItem(positionKey(role), JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [role],
  );
  const resetPosition = useCallback(() => {
    setPosition(null);
    try {
      localStorage.removeItem(positionKey(role));
    } catch {
      /* ignore */
    }
  }, [role]);
  const { handleProps, isDragging } = useDragMove({
    position: dragPosition,
    size: CAM_PANEL_SIZE,
    bounds: dragBounds,
    onChange: setAndPersistPosition,
  });

  const floatingStyle = position
    ? ({
        "--cam-panel-x": `${position.x}px`,
        "--cam-panel-y": `${position.y}px`,
      } as CSSProperties)
    : undefined;

  if (collapsed) {
    return (
      <button
        type="button"
        className={`${styles.camPanelTab} ${position ? styles.camPanelFloating : ""}`}
        // eslint-disable-next-line no-restricted-syntax -- 拖动位置是逐帧动态值, 经 CSS custom property 注入
        style={floatingStyle}
        onClick={() => setAndPersist(false)}
        title="展开相机"
      >
        {name} ▸
      </button>
    );
  }

  return (
    <div
      className={`${styles.camPanel} ${position ? styles.camPanelFloating : ""} ${
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
          onClick={() => setAndPersist(true)}
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

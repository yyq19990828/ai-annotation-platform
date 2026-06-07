/**
 * v0.13.7 · 悬浮相机面板(L2):把 CameraProjectionView 包一层可折叠 chrome,
 * 悬浮在主 3D 视图之上。位置由外层「按朝向分组的定位容器」决定(本组件不自带定位)。
 *
 * 展开:细标题条(收起钮)+ 相机图(自带 figcaption:名字 · 正对 · 深度)。
 * 折叠:仅留一个贴边小标签「名字 ▸」。折叠态按 role 存 localStorage(会话间记住)。
 */
import { useCallback, useState } from "react";

import type { SensorCalibration } from "@/types";

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
}

const collapseKey = (role: string) => `pcwb:cam-collapsed:${role}`;

export function FloatingCameraPanel({
  role,
  name,
  onEnlarge,
  ...camProps
}: FloatingCameraPanelProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(collapseKey(role)) === "1";
    } catch {
      return false;
    }
  });

  const setAndPersist = useCallback(
    (next: boolean) => {
      setCollapsed(next);
      try {
        localStorage.setItem(collapseKey(role), next ? "1" : "0");
      } catch {
        /* 隐私模式 / 配额满:忽略,只丢持久化不丢功能 */
      }
    },
    [role],
  );

  if (collapsed) {
    return (
      <button
        type="button"
        className={styles.camPanelTab}
        onClick={() => setAndPersist(false)}
        title="展开相机"
      >
        {name} ▸
      </button>
    );
  }

  return (
    <div className={styles.camPanel}>
      <div className={styles.camPanelBar}>
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

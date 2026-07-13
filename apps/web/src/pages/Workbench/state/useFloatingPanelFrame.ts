import { useEffect, useState } from "react";

export interface FloatingPanelPosition {
  left: number;
  top: number;
}

export interface FloatingPanelSize {
  w: number;
  h: number;
}

interface FloatingPanelFrameKeys {
  position: string;
  size: string;
}

function readPosition(key: string): FloatingPanelPosition | null {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : null;
    return Number.isFinite(value?.left) && Number.isFinite(value?.top)
      ? { left: value.left, top: value.top }
      : null;
  } catch {
    return null;
  }
}

function readSize(key: string): FloatingPanelSize | null {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : null;
    return Number.isFinite(value?.w) && value.w > 0 && Number.isFinite(value?.h) && value.h > 0
      ? { w: value.w, h: value.h }
      : null;
  } catch {
    return null;
  }
}

function writePreference(key: string, value: FloatingPanelPosition | FloatingPanelSize | null) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    // 隐私模式或配额受限时只保留当前会话状态。
  }
}

/** 保存浮动面板的位置与尺寸；key 由各面板独立提供，避免互相覆盖偏好。 */
export function useFloatingPanelFrame(keys: FloatingPanelFrameKeys) {
  const [position, setPosition] = useState<FloatingPanelPosition | null>(() =>
    readPosition(keys.position),
  );
  const [size, setSize] = useState<FloatingPanelSize | null>(() => readSize(keys.size));

  useEffect(() => writePreference(keys.position, position), [keys.position, position]);
  useEffect(() => writePreference(keys.size, size), [keys.size, size]);

  return { position, setPosition, size, setSize };
}

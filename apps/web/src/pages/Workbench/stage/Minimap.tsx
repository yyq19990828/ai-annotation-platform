import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Viewport } from "../state/useViewportTransform";

interface MinimapProps {
  imgW: number;
  imgH: number;
  vpSize: { w: number; h: number };
  vp: Viewport;
  setVp: React.Dispatch<React.SetStateAction<Viewport>>;
  thumbnailUrl: string | null;
  fileUrl: string | null;
  currentFrameIndex?: number;
  maxFrame?: number;
  cachedFrameRanges?: { from: number; to: number }[];
  right?: number;
  bottom?: number;
}

const MINIMAP_MAX_W = 160;
const MINIMAP_MAX_H = 120;

/**
 * 缩略图导航。仅当图像放大到容器尺寸 1.5× 以上才显示。
 * 点击 minimap 任意位置，把视口中心移到该位置。
 */
export function Minimap({
  imgW,
  imgH,
  vpSize,
  vp,
  setVp,
  thumbnailUrl,
  fileUrl,
  currentFrameIndex,
  maxFrame,
  cachedFrameRanges = [],
  right = 12,
  bottom = 12,
}: MinimapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 是否需要 minimap：图像在视口里需要滚动才看完
  const visibleW = vpSize.w / (imgW * vp.scale);
  const visibleH = vpSize.h / (imgH * vp.scale);
  const needsMinimap = visibleW < 0.85 || visibleH < 0.85;

  const { mw, mh } = useMemo(() => {
    if (!imgW || !imgH) return { mw: MINIMAP_MAX_W, mh: MINIMAP_MAX_H };
    const aspect = imgW / imgH;
    if (aspect >= MINIMAP_MAX_W / MINIMAP_MAX_H) {
      return { mw: MINIMAP_MAX_W, mh: MINIMAP_MAX_W / aspect };
    }
    return { mw: MINIMAP_MAX_H * aspect, mh: MINIMAP_MAX_H };
  }, [imgW, imgH]);

  // 视口在 minimap 中的相对矩形
  const rectX = (-vp.tx / (imgW * vp.scale)) * mw;
  const rectY = (-vp.ty / (imgH * vp.scale)) * mh;
  const rectW = visibleW * mw;
  const rectH = visibleH * mh;

  const moveViewportTo = useCallback((clientX: number, clientY: number) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const cx = Math.max(0, Math.min(mw, clientX - r.left));
    const cy = Math.max(0, Math.min(mh, clientY - r.top));
    // 把图像 (cx/mw, cy/mh) 这点移到容器中心
    const imgPxX = (cx / mw) * imgW * vp.scale;
    const imgPxY = (cy / mh) * imgH * vp.scale;
    setVp({ scale: vp.scale, tx: vpSize.w / 2 - imgPxX, ty: vpSize.h / 2 - imgPxY });
  }, [mw, mh, imgW, imgH, vp.scale, vpSize.w, vpSize.h, setVp]);

  const scheduleMoveViewportTo = useCallback((clientX: number, clientY: number) => {
    pendingPointRef.current = { clientX, clientY };
    if (rafRef.current !== null) return;
    const schedule = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16);
    rafRef.current = schedule(() => {
      rafRef.current = null;
      const point = pendingPointRef.current;
      pendingPointRef.current = null;
      if (point) moveViewportTo(point.clientX, point.clientY);
    });
  }, [moveViewportTo]);

  const stopDragging = useCallback(() => {
    draggingRef.current = false;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    return () => {
      const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : window.clearTimeout;
      if (rafRef.current !== null) cancel(rafRef.current);
    };
  }, []);

  if (!needsMinimap) return null;

  const src = thumbnailUrl || fileUrl;
  const canRenderFrameAxis = typeof currentFrameIndex === "number" && typeof maxFrame === "number" && maxFrame > 0;

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        e.preventDefault();
        draggingRef.current = true;
        setIsDragging(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
        scheduleMoveViewportTo(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) scheduleMoveViewportTo(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        stopDragging();
      }}
      onPointerCancel={stopDragging}
      style={{
        position: "absolute",
        right,
        bottom,
        width: mw,
        height: mh,
        background: "var(--color-bg-elev, white)",
        border: "1px solid var(--color-border)",
        borderRadius: 4,
        overflow: "hidden",
        cursor: isDragging ? "grabbing" : "grab",
        zIndex: 15,
        boxShadow: "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15))",
        userSelect: "none",
        touchAction: "none",
      }}
      title="缩略图导航：点击跳转视口"
    >
      {src && (
        <img
          src={src}
          alt=""
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "fill", opacity: 0.85, pointerEvents: "none" }}
        />
      )}
      {cachedFrameRanges.length > 0 && typeof maxFrame === "number" && maxFrame > 0 && (
        <div data-testid="minimap-cached-frame-ranges" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, pointerEvents: "none" }}>
          {cachedFrameRanges.map((range) => {
            const left = (Math.max(0, Math.min(maxFrame, range.from)) / maxFrame) * 100;
            const right = (Math.max(0, Math.min(maxFrame, range.to)) / maxFrame) * 100;
            return (
              <span
                key={`${range.from}-${range.to}`}
                style={{
                  position: "absolute",
                  left: `${left}%`,
                  width: `${Math.max(1, right - left)}%`,
                  top: 0,
                  bottom: 0,
                  background: "rgba(45,212,191,0.84)",
                }}
              />
            );
          })}
        </div>
      )}
      {canRenderFrameAxis && (
        <span
          data-testid="minimap-current-frame"
          style={{
            position: "absolute",
            left: `${(Math.max(0, Math.min(maxFrame, currentFrameIndex)) / maxFrame) * 100}%`,
            bottom: 0,
            width: 2,
            height: 12,
            transform: "translateX(-50%)",
            background: "rgba(255,255,255,0.92)",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
            pointerEvents: "none",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: Math.max(0, rectX),
          top: Math.max(0, rectY),
          width: Math.min(mw - Math.max(0, rectX), rectW),
          height: Math.min(mh - Math.max(0, rectY), rectH),
          border: "2px solid oklch(0.62 0.18 252)",
          background: "rgba(99, 130, 217, 0.12)",
          pointerEvents: "none",
          transition: isDragging ? "none" : "left 80ms linear, top 80ms linear",
        }}
      />
    </div>
  );
}

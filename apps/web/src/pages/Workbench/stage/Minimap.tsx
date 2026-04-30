import { useCallback, useMemo, useRef } from "react";
import type { Viewport } from "../state/useViewportTransform";

interface MinimapProps {
  imgW: number;
  imgH: number;
  vpSize: { w: number; h: number };
  vp: Viewport;
  setVp: React.Dispatch<React.SetStateAction<Viewport>>;
  thumbnailUrl: string | null;
  fileUrl: string | null;
}

const MINIMAP_MAX_W = 160;
const MINIMAP_MAX_H = 120;

/**
 * 缩略图导航。仅当图像放大到容器尺寸 1.5× 以上才显示。
 * 点击 minimap 任意位置，把视口中心移到该位置。
 */
export function Minimap({ imgW, imgH, vpSize, vp, setVp, thumbnailUrl, fileUrl }: MinimapProps) {
  const ref = useRef<HTMLDivElement>(null);

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

  const onClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    // 把图像 (cx/mw, cy/mh) 这点移到容器中心
    const imgPxX = (cx / mw) * imgW * vp.scale;
    const imgPxY = (cy / mh) * imgH * vp.scale;
    setVp({ scale: vp.scale, tx: vpSize.w / 2 - imgPxX, ty: vpSize.h / 2 - imgPxY });
  }, [mw, mh, imgW, imgH, vp.scale, vpSize.w, vpSize.h, setVp]);

  if (!needsMinimap) return null;

  const src = thumbnailUrl || fileUrl;

  return (
    <div
      ref={ref}
      onClick={onClick}
      style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        width: mw,
        height: mh,
        background: "var(--color-bg-elev, white)",
        border: "1px solid var(--color-border)",
        borderRadius: 4,
        overflow: "hidden",
        cursor: "crosshair",
        zIndex: 15,
        boxShadow: "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15))",
        userSelect: "none",
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
        }}
      />
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Viewport } from "./useViewportTransform";
import styles from "./Minimap.module.css";

interface MinimapProps {
  imgW: number;
  imgH: number;
  vpSize: { w: number; h: number };
  vp: Viewport;
  setVp: React.Dispatch<React.SetStateAction<Viewport>>;
  thumbnailUrl: string | null;
  fileUrl: string | null;
  /**
   * 视频栈:当前帧的可绘制源(暂停态 ImageBitmap / 播放态 `<video>`)。提供时用 `<canvas>`
   * 实时绘制当前帧, 取代静态 `<img>`——避免把 `.mp4` 地址塞进 `<img>` 导致的空白破图。
   */
  frameSource?: CanvasImageSource | null;
  /** 帧内容版本(如 frameIndex):变化时重绘一次暂停帧。 */
  frameVersion?: number;
  /** 播放中:开 rAF 循环持续 blit `frameSource`。 */
  isLive?: boolean;
  currentFrameIndex?: number;
  maxFrame?: number;
  cachedFrameRanges?: { from: number; to: number }[];
  right?: number;
  bottom?: number;
}

const MINIMAP_MAX_W = 160;
const MINIMAP_MAX_H = 120;

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function CachedFrameRange({
  range,
  maxFrame,
}: {
  range: { from: number; to: number };
  maxFrame: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const left = (Math.max(0, Math.min(maxFrame, range.from)) / maxFrame) * 100;
    const right = (Math.max(0, Math.min(maxFrame, range.to)) / maxFrame) * 100;
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--minimap-range-left", `${left}%`);
    el.style.setProperty("--minimap-range-width", `${Math.max(1, right - left)}%`);
  }, [maxFrame, range.from, range.to]);

  return <span ref={ref} className={styles.cachedFrameRange} />;
}

function CurrentFrameIndicator({
  currentFrameIndex,
  maxFrame,
}: {
  currentFrameIndex: number;
  maxFrame: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const left = (Math.max(0, Math.min(maxFrame, currentFrameIndex)) / maxFrame) * 100;
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--minimap-current-frame-left", `${left}%`);
    el.style.left = `${left}%`;
  }, [currentFrameIndex, maxFrame]);

  return <span ref={ref} data-testid="minimap-current-frame" className={styles.currentFrame} />;
}

function ViewportRect({
  x,
  y,
  w,
  h,
  isDragging,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  isDragging: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--minimap-viewport-left", `${x}px`);
    el.style.setProperty("--minimap-viewport-top", `${y}px`);
    el.style.setProperty("--minimap-viewport-width", `${w}px`);
    el.style.setProperty("--minimap-viewport-height", `${h}px`);
  }, [h, w, x, y]);

  return (
    <div ref={ref} className={cn(styles.viewportRect, isDragging && styles.viewportRectDragging)} />
  );
}

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
  frameSource,
  frameVersion,
  isLive = false,
  currentFrameIndex,
  maxFrame,
  cachedFrameRanges = [],
  right = 12,
  bottom = 12,
}: MinimapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--minimap-right", `${right}px`);
    el.style.setProperty("--minimap-bottom", `${bottom}px`);
    el.style.setProperty("--minimap-width", `${mw}px`);
    el.style.setProperty("--minimap-height", `${mh}px`);
    el.style.cursor = isDragging ? "grabbing" : "grab";
  }, [bottom, isDragging, mh, mw, needsMinimap, right]);

  const moveViewportTo = useCallback(
    (clientX: number, clientY: number) => {
      if (!ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const cx = Math.max(0, Math.min(mw, clientX - r.left));
      const cy = Math.max(0, Math.min(mh, clientY - r.top));
      // 把图像 (cx/mw, cy/mh) 这点移到容器中心
      const imgPxX = (cx / mw) * imgW * vp.scale;
      const imgPxY = (cy / mh) * imgH * vp.scale;
      setVp({ scale: vp.scale, tx: vpSize.w / 2 - imgPxX, ty: vpSize.h / 2 - imgPxY });
    },
    [mw, mh, imgW, imgH, vp.scale, vpSize.w, vpSize.h, setVp],
  );

  const scheduleMoveViewportTo = useCallback(
    (clientX: number, clientY: number) => {
      pendingPointRef.current = { clientX, clientY };
      if (rafRef.current !== null) return;
      const schedule =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame
          : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16);
      rafRef.current = schedule(() => {
        rafRef.current = null;
        const point = pendingPointRef.current;
        pendingPointRef.current = null;
        if (point) moveViewportTo(point.clientX, point.clientY);
      });
    },
    [moveViewportTo],
  );

  const stopDragging = useCallback(() => {
    draggingRef.current = false;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    return () => {
      const cancel =
        typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : window.clearTimeout;
      if (rafRef.current !== null) cancel(rafRef.current);
    };
  }, []);

  // 把 frameSource(bitmap/<video>)blit 进 minimap canvas。mw/mh 已按视频宽高比算好,
  // 故直接拉伸铺满即可, 无需 letterbox。source 未就绪(readyState 低)时 drawImage 可能抛,吞掉。
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frameSource) return;
    const w = Math.max(1, Math.round(mw));
    const h = Math.max(1, Math.round(mh));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    try {
      ctx.drawImage(frameSource, 0, 0, w, h);
    } catch {
      /* 帧未解码就绪 / 跨域污染:显示用途忽略即可 */
    }
  }, [frameSource, mw, mh]);

  // 暂停态 / 帧切换:重绘一次当前帧。needsMinimap 必须在依赖里——minimap 隐藏时组件仍挂载
  // 但 canvas 未渲染(canvasRef 为空), 缩放触发 needsMinimap false→true 使 canvas 首次挂载时,
  // 若 frameSource/frameVersion 未变则本 effect 不会重跑, canvas 永不被绘制(空白框根因)。
  useEffect(() => {
    drawFrame();
  }, [drawFrame, frameVersion, needsMinimap]);

  // 播放态:rAF 循环持续拾取 <video> 新解码帧(react 不会因 video 内容变化自动重绘)。
  useEffect(() => {
    if (!isLive || !frameSource || !needsMinimap) return;
    let raf = 0;
    const tick = () => {
      drawFrame();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isLive, frameSource, drawFrame, needsMinimap]);

  if (!needsMinimap) return null;

  const src = thumbnailUrl || fileUrl;
  const canRenderFrameAxis =
    typeof currentFrameIndex === "number" && typeof maxFrame === "number" && maxFrame > 0;

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
      className={cn(styles.root, isDragging && styles.rootDragging)}
      title="缩略图导航：点击跳转视口"
    >
      {frameSource ? (
        <canvas ref={canvasRef} className={styles.image} />
      ) : (
        src && <img src={src} alt="" draggable={false} className={styles.image} />
      )}
      {cachedFrameRanges.length > 0 && typeof maxFrame === "number" && maxFrame > 0 && (
        <div data-testid="minimap-cached-frame-ranges" className={styles.cachedFrameRanges}>
          {cachedFrameRanges.map((range) => (
            <CachedFrameRange key={`${range.from}-${range.to}`} range={range} maxFrame={maxFrame} />
          ))}
        </div>
      )}
      {canRenderFrameAxis && (
        <CurrentFrameIndicator currentFrameIndex={currentFrameIndex} maxFrame={maxFrame} />
      )}
      <ViewportRect
        x={Math.max(0, rectX)}
        y={Math.max(0, rectY)}
        w={Math.min(mw - Math.max(0, rectX), rectW)}
        h={Math.min(mh - Math.max(0, rectY), rectH)}
        isDragging={isDragging}
      />
    </div>
  );
}

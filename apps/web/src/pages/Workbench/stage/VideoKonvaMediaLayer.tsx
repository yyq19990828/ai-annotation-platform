import { useEffect, useRef } from "react";
import Konva from "konva";
import { Layer, Image as KonvaImage } from "react-konva";
import type { VideoPixelSize } from "./videoKonvaCoordinates";

interface VideoKonvaMediaLayerProps {
  /** 隐藏 `<video>` 解码源(A1:仍负责解码,不再是显示面)。 */
  videoEl: HTMLVideoElement | null;
  /** 暂停态精确帧(useVideoBitmapCache / WebCodecs 解码产物)。 */
  bitmap: ImageBitmap | null;
  /** 视频固有像素尺寸 = Konva 世界尺寸(Stage scale 负责缩放)。 */
  size: VideoPixelSize;
  /** 播放/jog 进行中:走 rAF 重绘 `<video>` 实时帧;否则贴 bitmap 静止帧。 */
  isPlaybackActive: boolean;
  /** 与图片栈 KonvaImage 对齐的像素插值开关。 */
  smoothing?: boolean;
}

/**
 * 选定 Konva.Image 的 image source(A1):播放态用 `<video>` 实时帧;暂停态优先精确
 * `ImageBitmap`,回退 `<video>`。纯函数,便于单测。返回 undefined 表示无可画源(不渲染 Image)。
 */
export function pickMediaImageSource(
  isPlaybackActive: boolean,
  videoEl: HTMLVideoElement | null,
  bitmap: ImageBitmap | null,
): CanvasImageSource | undefined {
  if (isPlaybackActive) return videoEl ?? undefined;
  return bitmap ?? videoEl ?? undefined;
}

/** ref 是否为可绘制的真实 Konva 层(mock 测试里 ref 是 DOM div,无 batchDraw)。 */
function isDrawableLayer(layer: Konva.Layer | null): layer is Konva.Layer {
  return !!layer && typeof (layer as { batchDraw?: unknown }).batchDraw === "function";
}

/**
 * v0.16.1 · 视频底图层(决策 A1 帧合成进 Konva)。
 *
 * 视频帧进独立的 `media-bg` Konva Layer(独立 canvas):
 *   - 播放态:`Konva.Image` 以隐藏 `<video>` 为 source,`Konva.Animation` 每帧只重绘本层
 *     (标注层 v0.16.2 起在另一 Layer,播放时静止不重绘)——A1 的 perf 关键规避。
 *   - 暂停态(标注主力场景):停动画,把精确 `ImageBitmap` 设为 source 画一次,不进重绘循环。
 *
 * spike 实测(ADR-0041 决策 A)单帧合成 p95≤0.4ms,据此选定 A1。
 */
export function VideoKonvaMediaLayer({
  videoEl,
  bitmap,
  size,
  isPlaybackActive,
  smoothing = true,
}: VideoKonvaMediaLayerProps) {
  const layerRef = useRef<Konva.Layer>(null);
  const imageRef = useRef<Konva.Image>(null);

  // 播放态:Konva.Animation 绑定本层,每帧重绘以拾取 <video> 的新解码帧
  //(react-konva 不会因 video 内容变化自动重渲染,必须主动驱动)。
  useEffect(() => {
    const layer = layerRef.current;
    if (!isPlaybackActive || !isDrawableLayer(layer) || !videoEl) return;
    const anim = new Konva.Animation(() => {
      // 空 tick:Animation 自身每帧 batchDraw 本层,blit 当前 <video> 帧。
    }, layer);
    anim.start();
    return () => {
      anim.stop();
    };
  }, [isPlaybackActive, videoEl]);

  // 暂停态 / 源切换:画一次当前帧(bitmap 优先,回退 <video>)。
  useEffect(() => {
    if (isPlaybackActive) return;
    const layer = layerRef.current;
    if (isDrawableLayer(layer)) layer.batchDraw();
  }, [isPlaybackActive, bitmap, videoEl, size.w, size.h]);

  const imageSource = pickMediaImageSource(isPlaybackActive, videoEl, bitmap);

  return (
    <Layer name="media-bg" listening={false} ref={layerRef}>
      {imageSource && (
        <KonvaImage
          ref={imageRef}
          image={imageSource}
          x={0}
          y={0}
          width={size.w}
          height={size.h}
          listening={false}
          imageSmoothingEnabled={smoothing}
        />
      )}
    </Layer>
  );
}

/**
 * v0.21.4 · ImageBitmap → JPEG Blob。
 *
 * 视频工作台把当前帧解码成 ImageBitmap 缓存(useVideoBitmapCache);单题 AI 需把它编码成
 * JPEG 随 multipart 传后端(client 供图路径, /ml-backends/{id}/predict-frame)。优先
 * OffscreenCanvas.convertToBlob;缺失时(旧浏览器)回落 <canvas>.toBlob。
 */
export async function imageBitmapToJpeg(
  bitmap: ImageBitmap,
  quality = 0.9,
): Promise<Blob> {
  const { width, height } = bitmap;
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法获取 2D 绘图上下文");
    ctx.drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type: "image/jpeg", quality });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法获取 2D 绘图上下文");
  ctx.drawImage(bitmap, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob 返回空"))),
      "image/jpeg",
      quality,
    );
  });
}

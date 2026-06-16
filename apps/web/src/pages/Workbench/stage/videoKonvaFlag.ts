/**
 * v0.16.1 · 视频 Konva 渲染栈实验开关。
 *
 * 画布栈统一 epic(见 docs/adr/0041-video-canvas-unify-to-konva.md)分版迁移期间,
 * 新 Konva 视频栈与旧 SVG 栈并行,由本 flag 切换。本版(v0.16.1)新栈只有底图层可用、
 * 标注/交互尚缺,仅供开发态视觉对照,默认关闭走旧栈。
 *
 * 范式镜像 useVideoChunkDecoder 的 WebCodecs 开关:URL query 优先、localStorage 粘性,
 * settings 面板「实验特性」分组提供 UI 开关(experiment.videoKonva)。纯函数便于单测。
 */

/** localStorage / URL query 开关键。默认关闭。 */
export const VIDEO_KONVA_FLAG_STORAGE_KEY = "video.experimental.konva";
export const VIDEO_KONVA_FLAG_QUERY_KEY = "videoKonva";

/**
 * 解析实验开关。优先级:URL query `?videoKonva=1` > localStorage `video.experimental.konva`。
 * 任一为真值("1" / "true")即开启;缺省关闭。
 */
export function isVideoKonvaEnabled(
  search?: string | null,
  storage?: Pick<Storage, "getItem"> | null,
): boolean {
  const truthy = (v: string | null | undefined) => v === "1" || v === "true";
  try {
    const params = new URLSearchParams(search ?? "");
    if (params.has(VIDEO_KONVA_FLAG_QUERY_KEY)) {
      return truthy(params.get(VIDEO_KONVA_FLAG_QUERY_KEY));
    }
  } catch {
    // 非法 search 串 → 忽略,继续看 localStorage。
  }
  try {
    return truthy(storage?.getItem(VIDEO_KONVA_FLAG_STORAGE_KEY));
  } catch {
    // localStorage 在隐私模式 / SSR 下可能不可用。
    return false;
  }
}

/** 从当前浏览器环境读取 flag(window.location.search + localStorage)。 */
export function resolveVideoKonvaEnabledFromEnv(): boolean {
  if (typeof window === "undefined") return false;
  return isVideoKonvaEnabled(window.location.search, window.localStorage);
}

/**
 * 视频 Konva 渲染栈开关(画布栈统一 epic,见 docs/adr/0041-video-canvas-unify-to-konva.md)。
 *
 * v0.16.1 引入时新栈只有底图、默认关。v0.16.1→.4 逐版补齐底图/标注/交互/右键菜单,
 * Konva 栈已功能对等旧 SVG 栈。**v0.16.4 切默认:未显式设置时默认走 Konva 新栈**,
 * 但旧 SVG 栈与本 flag 全部保留作逃生舱——显式 `?videoKonva=0` 或设置面板关闭即秒级回退。
 * (删旧栈是下一个独立 release v0.16.5,待观察期无回退后才做。)
 *
 * 范式镜像 useVideoChunkDecoder 的 WebCodecs 开关:URL query 优先、localStorage 粘性,
 * settings 面板「实验特性」分组提供 UI 开关(experiment.videoKonva)。纯函数便于单测。
 */

/** localStorage / URL query 开关键。 */
export const VIDEO_KONVA_FLAG_STORAGE_KEY = "video.experimental.konva";
export const VIDEO_KONVA_FLAG_QUERY_KEY = "videoKonva";

/** v0.16.4 · 未显式设置时的默认值(切默认到 Konva 新栈)。 */
export const VIDEO_KONVA_DEFAULT_ON = true;

const isTruthy = (v: string | null | undefined) => v === "1" || v === "true";
const isFalsy = (v: string | null | undefined) => v === "0" || v === "false";

/**
 * 解析实验开关。优先级:URL query `?videoKonva=` > localStorage `video.experimental.konva`
 * > 默认(VIDEO_KONVA_DEFAULT_ON)。
 *
 * 任一来源显式真值("1"/"true")→ 开,显式假值("0"/"false")→ 关(逃生舱);
 * 两者都未显式设置 → 默认值。
 */
export function isVideoKonvaEnabled(
  search?: string | null,
  storage?: Pick<Storage, "getItem"> | null,
): boolean {
  try {
    const params = new URLSearchParams(search ?? "");
    if (params.has(VIDEO_KONVA_FLAG_QUERY_KEY)) {
      const v = params.get(VIDEO_KONVA_FLAG_QUERY_KEY);
      if (isTruthy(v)) return true;
      if (isFalsy(v)) return false;
      // 存在但非可识别值 → 落到 localStorage / 默认。
    }
  } catch {
    // 非法 search 串 → 忽略,继续看 localStorage。
  }
  try {
    const stored = storage?.getItem(VIDEO_KONVA_FLAG_STORAGE_KEY);
    if (isTruthy(stored)) return true;
    if (isFalsy(stored)) return false;
  } catch {
    // localStorage 在隐私模式 / SSR 下可能不可用。
    return VIDEO_KONVA_DEFAULT_ON;
  }
  return VIDEO_KONVA_DEFAULT_ON;
}

/** 从当前浏览器环境读取 flag(window.location.search + localStorage)。 */
export function resolveVideoKonvaEnabledFromEnv(): boolean {
  if (typeof window === "undefined") return VIDEO_KONVA_DEFAULT_ON;
  return isVideoKonvaEnabled(window.location.search, window.localStorage);
}

/**
 * 设置面板用:只读 localStorage(不看 URL)的开关态,未设置时返回默认值。
 * 与 isVideoKonvaEnabled 的 localStorage/默认语义一致,使设置开关显示与实际栈一致。
 */
export function readVideoKonvaLocalFlag(storage?: Pick<Storage, "getItem"> | null): boolean {
  try {
    const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    const stored = store?.getItem(VIDEO_KONVA_FLAG_STORAGE_KEY);
    if (isTruthy(stored)) return true;
    if (isFalsy(stored)) return false;
  } catch {
    return VIDEO_KONVA_DEFAULT_ON;
  }
  return VIDEO_KONVA_DEFAULT_ON;
}

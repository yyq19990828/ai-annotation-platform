import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * v0.10.29 · Wave3-H · WebCodecs 精确帧解码 (实验性, 默认关闭)。
 *
 * 目标：用浏览器原生 `WebCodecs`（`VideoDecoder`）解 chunk 字节得到精确帧，绕过原生
 * `<video>` seek 不精确的问题。解出的 `VideoFrame` 转 `ImageBitmap` 后塞进缓存，
 * 缓存/诊断风格刻意对齐 `useVideoBitmapCache`（LRU + 命中/未命中计数）。
 *
 * ── 边界 / TODO ──────────────────────────────────────────────────────────────
 * 本 hook 只实现「解码核心」：给定一组已 demux 的 `EncodedVideoChunk` + `VideoDecoderConfig`，
 * 解码并把目标帧落进缓存。**它不做 mp4 demux**。
 *
 * demux（mp4 字节 → EncodedVideoChunk + codec config）刻意留空，原因：
 *   1. 项目约束禁止引入 ffmpeg.wasm / Broadway.js 或任何重型解码依赖；
 *   2. 浏览器没有原生 mp4 demuxer；手写完整 mp4 box 解析（moov/stbl/stsz/stco/...）
 *      是个兔子洞，超出本实验性 feature 的范围。
 *   3. 前端 `TaskVideoManifestResponse` 目前还没暴露 `chunks_manifest_url` /
 *      `frame_service_base` / `chunk_size_frames`（见 apps/web/src/types/index.ts），
 *      所以 chunk 字节获取链路本身也还没接上。
 *
 * 因此调用方需要自己拿到 `EncodedVideoChunk[]`（未来由一个轻量自写 mp4 box 解析器或
 * 后端预 demux 的 sample 列表提供），再调用本 hook 的 `decodeChunks`。flag 关闭或
 * WebCodecs 不可用时本路径完全不激活，调用方继续走原有 `<video>` 路径。
 */

/** localStorage / URL query 开关键。默认关闭。 */
export const WEBCODECS_FLAG_STORAGE_KEY = "video.experimental.webcodecs";
export const WEBCODECS_FLAG_QUERY_KEY = "webcodecs";

export interface DecodedVideoFrameBitmap {
  frameIndex: number;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export interface VideoChunkDecoderDiagnostics {
  supported: boolean;
  enabled: boolean;
  cacheSize: number;
  activeFrameIndex: number | null;
  hits: number;
  misses: number;
  decodes: number;
  errors: number;
}

interface UseVideoChunkDecoderArgs {
  taskId: string | null | undefined;
  /** feature flag 的解析结果由调用方传入（或缺省时本 hook 自行从环境探测）。 */
  enabled?: boolean;
  maxItems?: number;
}

const DEFAULT_MAX_ITEMS = 48;

/** 能力探测：当前运行环境是否提供 WebCodecs 的 `VideoDecoder`。jsdom 下为 false。 */
export function detectWebCodecsSupport(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { VideoDecoder?: unknown }).VideoDecoder !== "undefined" &&
    typeof globalThis.createImageBitmap === "function"
  );
}

/** 缓存键：与 useVideoBitmapCache 同构（`${taskId}:${frameIndex}`）。 */
export function chunkDecoderCacheKey(taskId: string, frameIndex: number): string {
  return `${taskId}:${frameIndex}`;
}

/**
 * 解析实验开关。优先级：URL query `?webcodecs=1` > localStorage `video.experimental.webcodecs`。
 * 任一为真值（"1" / "true"）即开启；缺省关闭。纯函数，便于单测。
 */
export function isWebCodecsExperimentEnabled(
  search?: string | null,
  storage?: Pick<Storage, "getItem"> | null,
): boolean {
  const truthy = (v: string | null | undefined) => v === "1" || v === "true";
  try {
    const params = new URLSearchParams(search ?? "");
    if (params.has(WEBCODECS_FLAG_QUERY_KEY)) {
      return truthy(params.get(WEBCODECS_FLAG_QUERY_KEY));
    }
  } catch {
    // 非法 search 串 → 忽略，继续看 localStorage。
  }
  try {
    return truthy(storage?.getItem(WEBCODECS_FLAG_STORAGE_KEY));
  } catch {
    // localStorage 在隐私模式 / SSR 下可能不可用。
    return false;
  }
}

/** 从当前浏览器环境读取 flag（window.location.search + localStorage）。 */
function resolveEnabledFromEnv(): boolean {
  if (typeof window === "undefined") return false;
  return isWebCodecsExperimentEnabled(window.location.search, window.localStorage);
}

function closeBitmap(bitmap: ImageBitmap) {
  try {
    bitmap.close();
  } catch {
    // 部分测试替身 / 老引擎没有 close。
  }
}

function closeFrame(frame: VideoFrame) {
  try {
    frame.close();
  } catch {
    // 同上。
  }
}

/**
 * 给定一组已 demux 的 EncodedVideoChunk + config，解码出目标帧的 VideoFrame，
 * 转成 ImageBitmap 返回。VideoFrame / VideoDecoder 在内部即时 close，避免泄漏
 * （WebCodecs 的 VideoFrame 持有 GPU/内存资源，必须显式释放）。
 *
 * 纯解码核心，不触碰 React state，便于在主进程跑真实/mock 解码单测。
 */
export async function decodeChunkToBitmap(
  config: VideoDecoderConfig,
  chunks: EncodedVideoChunk[],
  targetFrameIndex: number,
): Promise<DecodedVideoFrameBitmap | null> {
  if (!detectWebCodecsSupport()) return null;
  if (chunks.length === 0) return null;

  const frames: VideoFrame[] = [];
  // eslint-disable-next-line no-undef -- VideoDecoder 由 WebCodecs 提供，类型见 lib.dom。
  const decoder = new VideoDecoder({
    output: (frame) => frames.push(frame),
    error: () => {
      /* 错误由下方 flush 的 reject 路径感知。 */
    },
  });
  try {
    decoder.configure(config);
    for (const chunk of chunks) decoder.decode(chunk);
    await decoder.flush();
    const wanted = frames[targetFrameIndex] ?? frames[frames.length - 1];
    if (!wanted) return null;
    const bitmap = await globalThis.createImageBitmap(wanted);
    return {
      frameIndex: targetFrameIndex,
      bitmap,
      width: bitmap.width || wanted.displayWidth,
      height: bitmap.height || wanted.displayHeight,
    };
  } catch {
    return null;
  } finally {
    for (const frame of frames) closeFrame(frame);
    try {
      decoder.close();
    } catch {
      // decoder 可能已 close。
    }
  }
}

export function useVideoChunkDecoder({
  taskId,
  enabled,
  maxItems = DEFAULT_MAX_ITEMS,
}: UseVideoChunkDecoderArgs) {
  const supported = detectWebCodecsSupport();
  const resolvedEnabled = enabled ?? resolveEnabledFromEnv();
  const active = supported && resolvedEnabled;

  const cacheRef = useRef(new Map<string, DecodedVideoFrameBitmap>());
  const inFlightRef = useRef(new Set<string>());
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

  const [activeFrameIndex, setActiveFrameIndex] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [diagnostics, setDiagnostics] = useState<VideoChunkDecoderDiagnostics>({
    supported,
    enabled: resolvedEnabled,
    cacheSize: 0,
    activeFrameIndex: null,
    hits: 0,
    misses: 0,
    decodes: 0,
    errors: 0,
  });

  const bumpVersion = useCallback(() => setVersion((v) => v + 1), []);

  const remember = useCallback((key: string, entry: DecodedVideoFrameBitmap) => {
    const cache = cacheRef.current;
    const old = cache.get(key);
    if (old) closeBitmap(old.bitmap);
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > maxItems) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;
      const oldest = cache.get(oldestKey);
      if (oldest) closeBitmap(oldest.bitmap);
      cache.delete(oldestKey);
    }
    setDiagnostics((cur) => ({
      ...cur,
      supported,
      enabled: resolvedEnabled,
      cacheSize: cache.size,
      activeFrameIndex: entry.frameIndex,
      decodes: cur.decodes + 1,
    }));
    bumpVersion();
  }, [bumpVersion, maxItems, resolvedEnabled, supported]);

  /**
   * 解码目标帧并入缓存。flag 关闭 / 不支持时直接 no-op 返回 null（调用方降级到 <video>）。
   * @param config WebCodecs codec 配置（codec / description / coded 尺寸）。
   * @param chunks 已 demux 的该帧所需 EncodedVideoChunk（含其前置依赖帧）。
   * @param frameIndex 目标帧的全局帧号（作缓存键）。
   */
  const decodeChunks = useCallback(
    async (config: VideoDecoderConfig, chunks: EncodedVideoChunk[], frameIndex: number) => {
      if (!taskId || !active) return null;
      const normalizedFrame = Math.max(0, Math.round(frameIndex));
      const key = chunkDecoderCacheKey(taskId, normalizedFrame);
      const cached = cacheRef.current.get(key);
      if (cached) return cached;
      if (inFlightRef.current.has(key)) return null;
      inFlightRef.current.add(key);
      try {
        const decoded = await decodeChunkToBitmap(config, chunks, normalizedFrame);
        if (!decoded) {
          setDiagnostics((cur) => ({ ...cur, errors: cur.errors + 1 }));
          return null;
        }
        if (taskIdRef.current !== taskId) {
          closeBitmap(decoded.bitmap);
          return null;
        }
        const entry: DecodedVideoFrameBitmap = { ...decoded, frameIndex: normalizedFrame };
        remember(key, entry);
        setActiveFrameIndex(normalizedFrame);
        return entry;
      } finally {
        inFlightRef.current.delete(key);
      }
    },
    [active, remember, taskId],
  );

  /** 命中缓存则把它提到 LRU 末尾并设为 active；未命中返回 null（调用方走解码 / <video>）。 */
  const showFrame = useCallback((frameIndex: number) => {
    if (!taskId || !active) return null;
    const normalizedFrame = Math.max(0, Math.round(frameIndex));
    const key = chunkDecoderCacheKey(taskId, normalizedFrame);
    const cached = cacheRef.current.get(key);
    if (cached) {
      cacheRef.current.delete(key);
      cacheRef.current.set(key, cached);
      setActiveFrameIndex(normalizedFrame);
      setDiagnostics((cur) => ({
        ...cur,
        cacheSize: cacheRef.current.size,
        activeFrameIndex: normalizedFrame,
        hits: cur.hits + 1,
      }));
      bumpVersion();
      return cached;
    }
    setDiagnostics((cur) => ({ ...cur, misses: cur.misses + 1 }));
    return null;
  }, [active, bumpVersion, taskId]);

  const clear = useCallback(() => {
    for (const entry of cacheRef.current.values()) closeBitmap(entry.bitmap);
    cacheRef.current.clear();
    inFlightRef.current.clear();
    setActiveFrameIndex(null);
    setDiagnostics((cur) => ({ ...cur, cacheSize: 0, activeFrameIndex: null }));
    bumpVersion();
  }, [bumpVersion]);

  // 卸载清理：释放全部 ImageBitmap（仿 useVideoBitmapCache）。
  useEffect(() => () => {
    for (const entry of cacheRef.current.values()) closeBitmap(entry.bitmap);
    cacheRef.current.clear();
    inFlightRef.current.clear();
  }, []);

  // taskId 切换时清空缓存。
  useEffect(() => {
    clear();
  }, [clear, taskId]);

  const activeBitmap = useMemo(() => {
    if (!taskId || activeFrameIndex === null) return null;
    return cacheRef.current.get(chunkDecoderCacheKey(taskId, activeFrameIndex)) ?? null;
  }, [activeFrameIndex, taskId, version]);

  return {
    supported,
    enabled: resolvedEnabled,
    active,
    activeBitmap,
    activeFrameIndex,
    decodeChunks,
    showFrame,
    clear,
    diagnostics,
  };
}

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CocoRleMaskRef } from "@/types";
import type { CocoRle } from "./geometry/maskRle";
import { analyzeRasterMaskRleAsync, RasterMaskWorkerError } from "./rasterMaskCompute";
import {
  closeRasterMaskImage,
  createTintedRasterMaskImage,
  type RasterMaskAnalysis,
  type RasterMaskCroppedImage,
  type RasterMaskNormalizedBounds,
  type RasterMaskRenderRecord,
} from "./rasterMaskRender";

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_CACHED_RECORDS = 96;

export interface RasterMaskRecordDescriptor<TSource extends string = string> {
  id: string;
  source: TSource;
  ref: CocoRleMaskRef;
  /** Annotation version, keyframe revision, or another immutable content revision. */
  revision: string | number;
  color: string;
  /** Must change whenever the rendered category color changes. */
  colorRevision: string | number;
  zOrder: number;
  selected: boolean;
  load: () => Promise<CocoRle>;
}

export type RasterMaskLoadErrorReason =
  | "not_found"
  | "forbidden"
  | "corrupt"
  | "unavailable"
  | "invalid_content"
  | "render_failed"
  | "load_failed";

export type RasterMaskRecordStatus =
  | { state: "loading" }
  | {
      state: "ready";
      cacheKey: string;
      area: number;
      componentCount: number;
      bounds: RasterMaskNormalizedBounds;
    }
  | {
      state: "error";
      reason: RasterMaskLoadErrorReason;
      message: string;
      retryable: boolean;
      httpStatus?: number;
    };

export interface UseRasterMaskRecordsOptions<TSource extends string = string> {
  scopeKey: string | null;
  descriptors: readonly RasterMaskRecordDescriptor<TSource>[];
  maxConcurrent?: number;
  maxCachedRecords?: number;
}

export interface UseRasterMaskRecordsResult<TSource extends string = string> {
  records: RasterMaskRenderRecord<TSource>[];
  statusById: ReadonlyMap<string, RasterMaskRecordStatus>;
  retry: (id: string) => void;
}

interface CachedRasterMask {
  scopeKey: string | null;
  cacheKey: string;
  analysis: RasterMaskAnalysis;
  rendered: RasterMaskCroppedImage;
}

interface RasterMaskLoadJob<TSource extends string> {
  scopeGeneration: number;
  cacheKey: string;
  token: number;
  descriptor: RasterMaskRecordDescriptor<TSource>;
}

class InvalidRasterMaskContentError extends Error {}
class RasterMaskRenderError extends Error {}

export function rasterMaskRecordCacheKey(
  descriptor: Pick<
    RasterMaskRecordDescriptor,
    "id" | "revision" | "ref" | "colorRevision"
  >,
): string {
  return JSON.stringify([
    descriptor.id,
    descriptor.revision,
    descriptor.ref.sha256,
    descriptor.colorRevision,
  ]);
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function httpStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}

export function rasterMaskLoadError(error: unknown): Extract<RasterMaskRecordStatus, { state: "error" }> {
  if (error instanceof InvalidRasterMaskContentError) {
    return {
      state: "error",
      reason: "invalid_content",
      message: "Mask 内容无效或尺寸不一致",
      retryable: false,
    };
  }
  if (error instanceof RasterMaskRenderError) {
    return {
      state: "error",
      reason: "render_failed",
      message: "Mask 图像构建失败",
      retryable: true,
    };
  }
  const httpStatus = httpStatusOf(error);
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      state: "error",
      reason: "forbidden",
      message: "无权读取 Mask 内容",
      retryable: false,
      httpStatus,
    };
  }
  if (httpStatus === 404) {
    return {
      state: "error",
      reason: "not_found",
      message: "Mask 内容不存在",
      retryable: false,
      httpStatus,
    };
  }
  if (httpStatus === 409) {
    return {
      state: "error",
      reason: "corrupt",
      message: "Mask 内容已损坏或与引用不一致",
      retryable: false,
      httpStatus,
    };
  }
  if (httpStatus === 429 || (httpStatus != null && httpStatus >= 500)) {
    return {
      state: "error",
      reason: "unavailable",
      message: "Mask 内容暂时不可用",
      retryable: true,
      httpStatus,
    };
  }
  return {
    state: "error",
    reason: "load_failed",
    message: "Mask 内容加载失败",
    retryable: true,
    ...(httpStatus == null ? {} : { httpStatus }),
  };
}

function toRenderRecord<TSource extends string>(
  descriptor: RasterMaskRecordDescriptor<TSource>,
  cached: CachedRasterMask,
): RasterMaskRenderRecord<TSource> {
  return {
    id: descriptor.id,
    source: descriptor.source,
    image: cached.rendered.image,
    sourceWidth: cached.analysis.sourceWidth,
    sourceHeight: cached.analysis.sourceHeight,
    crop: cached.analysis.crop,
    bounds: cached.analysis.bounds,
    area: cached.analysis.area,
    componentCount: cached.analysis.componentCount,
    zOrder: descriptor.zOrder,
    selected: descriptor.selected,
    cacheKey: cached.cacheKey,
  };
}

export function useRasterMaskRecords<TSource extends string = string>(
  options: UseRasterMaskRecordsOptions<TSource>,
): UseRasterMaskRecordsResult<TSource> {
  const { scopeKey, descriptors } = options;
  const maxConcurrent = normalizePositiveLimit(options.maxConcurrent, DEFAULT_MAX_CONCURRENT);
  const maxCachedRecords = normalizePositiveLimit(
    options.maxCachedRecords,
    DEFAULT_MAX_CACHED_RECORDS,
  );
  const [, forceRender] = useState(0);
  const mountedRef = useRef(false);
  const scopeRef = useRef(scopeKey);
  const scopeGenerationRef = useRef(0);
  const tokenRef = useRef(0);
  const cacheRef = useRef(new Map<string, CachedRasterMask>());
  const errorsRef = useRef(new Map<string, Extract<RasterMaskRecordStatus, { state: "error" }>>());
  const activeDescriptorsRef = useRef(new Map<string, RasterMaskRecordDescriptor<TSource>>());
  const descriptorsByIdRef = useRef(new Map<string, RasterMaskRecordDescriptor<TSource>>());
  const requestTokensRef = useRef(new Map<string, number>());
  const queueRef = useRef<RasterMaskLoadJob<TSource>[]>([]);
  const inFlightRef = useRef(0);
  const maxConcurrentRef = useRef(maxConcurrent);
  const maxCachedRecordsRef = useRef(maxCachedRecords);
  const pumpRef = useRef<() => void>(() => undefined);
  const disposedImagesRef = useRef(new WeakSet<object>());

  maxConcurrentRef.current = maxConcurrent;
  maxCachedRecordsRef.current = maxCachedRecords;

  const descriptorState = useMemo(() => {
    const byId = new Map<string, RasterMaskRecordDescriptor<TSource>>();
    const entries = descriptors.map((descriptor) => {
      if (byId.has(descriptor.id)) {
        throw new Error(`duplicate raster mask descriptor id: ${descriptor.id}`);
      }
      byId.set(descriptor.id, descriptor);
      return [rasterMaskRecordCacheKey(descriptor), descriptor] as const;
    });
    return { byId, entries };
  }, [descriptors]);
  descriptorsByIdRef.current = descriptorState.byId;
  const descriptorEntries = descriptorState.entries;

  const publish = useCallback(() => {
    if (mountedRef.current) forceRender((value) => value + 1);
  }, []);

  const disposeImage = useCallback((image: CanvasImageSource) => {
    const object = image as object;
    if (disposedImagesRef.current.has(object)) return;
    disposedImagesRef.current.add(object);
    closeRasterMaskImage(image);
  }, []);

  const disposeCached = useCallback((cached: CachedRasterMask) => {
    disposeImage(cached.rendered.image);
  }, [disposeImage]);

  const evictLru = useCallback(() => {
    const cache = cacheRef.current;
    while (cache.size > maxCachedRecordsRef.current) {
      const evictKey = [...cache.keys()].find(
        (cacheKey) => !activeDescriptorsRef.current.has(cacheKey),
      );
      if (!evictKey) break;
      const cached = cache.get(evictKey);
      cache.delete(evictKey);
      if (cached) disposeCached(cached);
    }
  }, [disposeCached]);

  const isCurrentJob = useCallback((job: RasterMaskLoadJob<TSource>) => (
    mountedRef.current
    && job.scopeGeneration === scopeGenerationRef.current
    && requestTokensRef.current.get(job.cacheKey) === job.token
    && activeDescriptorsRef.current.has(job.cacheKey)
  ), []);

  const startJob = useCallback((job: RasterMaskLoadJob<TSource>) => {
    inFlightRef.current += 1;
    void (async () => {
      let rendered: RasterMaskCroppedImage | null = null;
      try {
        const rle = await job.descriptor.load();
        if (
          rle.size[0] !== job.descriptor.ref.size[0]
          || rle.size[1] !== job.descriptor.ref.size[1]
        ) {
          throw new InvalidRasterMaskContentError("mask content size does not match its reference");
        }
        let analysis: RasterMaskAnalysis;
        try {
          analysis = await analyzeRasterMaskRleAsync(rle);
          if (analysis.area === 0) {
            throw new InvalidRasterMaskContentError("mask content has no foreground pixels");
          }
        } catch (error) {
          if (error instanceof InvalidRasterMaskContentError) throw error;
          if (error instanceof RasterMaskWorkerError) throw new RasterMaskRenderError(error.message);
          throw new InvalidRasterMaskContentError(String(error));
        }
        try {
          rendered = await createTintedRasterMaskImage(analysis, job.descriptor.color);
        } catch (error) {
          throw new RasterMaskRenderError(String(error));
        }
        if (!rendered) {
          throw new InvalidRasterMaskContentError("mask content has no renderable foreground");
        }
        if (!isCurrentJob(job)) {
          disposeImage(rendered.image);
          rendered = null;
          return;
        }
        const previous = cacheRef.current.get(job.cacheKey);
        if (previous) disposeCached(previous);
        const cached: CachedRasterMask = {
          scopeKey: scopeRef.current,
          cacheKey: job.cacheKey,
          analysis,
          rendered,
        };
        rendered = null;
        cacheRef.current.delete(job.cacheKey);
        cacheRef.current.set(job.cacheKey, cached);
        errorsRef.current.delete(job.cacheKey);
        evictLru();
        publish();
      } catch (error) {
        if (rendered) disposeImage(rendered.image);
        if (isCurrentJob(job)) {
          errorsRef.current.set(job.cacheKey, rasterMaskLoadError(error));
          publish();
        }
      } finally {
        if (requestTokensRef.current.get(job.cacheKey) === job.token) {
          requestTokensRef.current.delete(job.cacheKey);
        }
        inFlightRef.current -= 1;
        pumpRef.current();
      }
    })();
  }, [disposeCached, disposeImage, evictLru, isCurrentJob, publish]);

  pumpRef.current = () => {
    while (
      mountedRef.current
      && inFlightRef.current < maxConcurrentRef.current
      && queueRef.current.length > 0
    ) {
      const job = queueRef.current.shift();
      if (!job || !isCurrentJob(job)) continue;
      startJob(job);
    }
  };

  const enqueue = useCallback((descriptor: RasterMaskRecordDescriptor<TSource>) => {
    const cacheKey = rasterMaskRecordCacheKey(descriptor);
    if (
      cacheRef.current.get(cacheKey)?.scopeKey === scopeRef.current
      || requestTokensRef.current.has(cacheKey)
    ) {
      return;
    }
    const token = ++tokenRef.current;
    requestTokensRef.current.set(cacheKey, token);
    queueRef.current.push({
      scopeGeneration: scopeGenerationRef.current,
      cacheKey,
      token,
      descriptor,
    });
  }, []);

  useLayoutEffect(() => {
    const activeDescriptors = activeDescriptorsRef;
    const requestTokens = requestTokensRef.current;
    const errors = errorsRef.current;
    const cache = cacheRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scopeGenerationRef.current += 1;
      activeDescriptors.current.clear();
      requestTokens.clear();
      queueRef.current = [];
      errors.clear();
      for (const cached of cache.values()) disposeCached(cached);
      cache.clear();
    };
  }, [disposeCached]);

  useLayoutEffect(() => {
    const scopeChanged = scopeRef.current !== scopeKey;
    if (scopeChanged) {
      scopeRef.current = scopeKey;
      scopeGenerationRef.current += 1;
      requestTokensRef.current.clear();
      queueRef.current = [];
      errorsRef.current.clear();
      for (const cached of cacheRef.current.values()) disposeCached(cached);
      cacheRef.current.clear();
    }

    const activeDescriptors = new Map(descriptorEntries);
    activeDescriptorsRef.current = activeDescriptors;
    for (const cacheKey of [...requestTokensRef.current.keys()]) {
      if (!activeDescriptors.has(cacheKey)) requestTokensRef.current.delete(cacheKey);
    }
    queueRef.current = queueRef.current.filter((job) => activeDescriptors.has(job.cacheKey));
    for (const cacheKey of [...errorsRef.current.keys()]) {
      if (!activeDescriptors.has(cacheKey)) errorsRef.current.delete(cacheKey);
    }

    for (const [cacheKey, descriptor] of descriptorEntries) {
      const cached = cacheRef.current.get(cacheKey);
      if (cached?.scopeKey === scopeKey) {
        cacheRef.current.delete(cacheKey);
        cacheRef.current.set(cacheKey, cached);
        continue;
      }
      if (!errorsRef.current.has(cacheKey)) enqueue(descriptor);
    }
    evictLru();
    pumpRef.current();
  }, [descriptorEntries, disposeCached, enqueue, evictLru, maxCachedRecords, maxConcurrent, scopeKey]);

  const retry = useCallback((id: string) => {
    const descriptor = descriptorsByIdRef.current.get(id);
    if (!descriptor) return;
    const cacheKey = rasterMaskRecordCacheKey(descriptor);
    const error = errorsRef.current.get(cacheKey);
    if (!error || !error.retryable) return;
    errorsRef.current.delete(cacheKey);
    enqueue(descriptor);
    publish();
    pumpRef.current();
  }, [enqueue, publish]);

  const records: RasterMaskRenderRecord<TSource>[] = [];
  const statusById = new Map<string, RasterMaskRecordStatus>();
  for (const [cacheKey, descriptor] of descriptorEntries) {
    const cached = cacheRef.current.get(cacheKey);
    if (cached?.scopeKey === scopeKey) {
      records.push(toRenderRecord(descriptor, cached));
      statusById.set(descriptor.id, {
        state: "ready",
        cacheKey,
        area: cached.analysis.area,
        componentCount: cached.analysis.componentCount,
        bounds: cached.analysis.bounds,
      });
      continue;
    }
    const error = scopeRef.current === scopeKey
      ? errorsRef.current.get(cacheKey)
      : undefined;
    statusById.set(descriptor.id, error ?? { state: "loading" });
  }

  return { records, statusById, retry };
}

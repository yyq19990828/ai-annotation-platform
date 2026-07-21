import { useEffect, useMemo, useRef, useState } from "react";
import type { AnnotationResponse, CocoRleMaskRef } from "@/types";
import type { VideoTrackerPreviewResult } from "@/api/videoTracker";
import { rasterMasksApi } from "@/api/rasterMasks";
import { videoTrackerApi } from "@/api/videoTracker";
import { decodeCocoRle, type CocoRle } from "./shared/geometry/maskRle";
import { isVideoMaskTrack, resolveVideoMaskTrackAtFrame } from "./videoStageGeometry";

const MAX_CACHED_MASKS = 96;

export interface VideoMaskCandidate {
  jobId: string;
  result: VideoTrackerPreviewResult;
  className?: string;
}

export interface VideoMaskRenderRecord {
  id: string;
  source: "annotation" | "tracker";
  image: CanvasImageSource;
  alpha: Uint8Array;
  width: number;
  height: number;
  geom: { x: number; y: number; w: number; h: number };
  zOrder: number;
  selected: boolean;
  cacheKey: string;
}

interface MaskDescriptor {
  id: string;
  source: VideoMaskRenderRecord["source"];
  ref: CocoRleMaskRef;
  color: string;
  zOrder: number;
  selected: boolean;
  cachePrefix: string;
  frameKey: number;
  load: () => Promise<CocoRle>;
}

interface CachedMask {
  image: CanvasImageSource;
  alpha: Uint8Array;
  width: number;
  height: number;
  geom: VideoMaskRenderRecord["geom"];
}

function closeImage(image: CanvasImageSource) {
  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
}

function parseHexColor(color: string): [number, number, number] {
  const normalized = color.startsWith("#") ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return [168, 85, 247];
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

export function buildTintedMaskRgba(alpha: Uint8Array, color: string): Uint8ClampedArray {
  const [red, green, blue] = parseHexColor(color);
  const rgba = new Uint8ClampedArray(alpha.length * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] === 0) continue;
    const offset = index * 4;
    rgba[offset] = red;
    rgba[offset + 1] = green;
    rgba[offset + 2] = blue;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

export function maskAlphaBounds(alpha: Uint8Array, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, w: 0, h: 0 };
  return {
    x: minX / width,
    y: minY / height,
    w: (maxX - minX + 1) / width,
    h: (maxY - minY + 1) / height,
  };
}

async function createMaskImage(alpha: Uint8Array, width: number, height: number, color: string) {
  const rgba = buildTintedMaskRgba(alpha, color);
  const imageData = new ImageData(rgba, width, height);
  if (typeof createImageBitmap === "function") return createImageBitmap(imageData);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas context is unavailable");
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function cacheKey(descriptor: MaskDescriptor) {
  return `${descriptor.cachePrefix}:frame:${descriptor.frameKey}:${descriptor.ref.sha256}:${descriptor.color}`;
}

export function useVideoMaskFrames(params: {
  taskId: string | null;
  annotations: readonly AnnotationResponse[];
  candidates: readonly VideoMaskCandidate[];
  frameIndex: number;
  selectedId: string | null;
  colorForAnnotation: (annotation: AnnotationResponse) => string;
}): VideoMaskRenderRecord[] {
  const { taskId, annotations, candidates, frameIndex, selectedId, colorForAnnotation } = params;
  const cacheRef = useRef(new Map<string, CachedMask>());
  const generationRef = useRef(0);
  const [records, setRecords] = useState<VideoMaskRenderRecord[]>([]);

  const descriptors = useMemo<MaskDescriptor[]>(() => {
    const committed = annotations.flatMap((annotation) => {
      if (!isVideoMaskTrack(annotation)) return [];
      const resolved = resolveVideoMaskTrackAtFrame(annotation.geometry, frameIndex);
      if (!resolved) return [];
      return [{
        id: annotation.id,
        source: "annotation" as const,
        ref: resolved.mask,
        color: colorForAnnotation(annotation),
        zOrder: annotation.z_order ?? 0,
        selected: annotation.id === selectedId,
        cachePrefix: `annotation:${annotation.id}:version:${annotation.version ?? 0}`,
        frameKey: resolved.keyframeFrame,
        load: () => rasterMasksApi.annotationVideoMaskContent(annotation.id, frameIndex),
      }];
    });
    const staged = candidates.flatMap((candidate, index) => {
      const geometry = candidate.result.geometry;
      if (candidate.result.outside || geometry.type !== "mask" || candidate.result.frame_index !== frameIndex) return [];
      const instance = candidate.result.instance_id ?? String(index + 1);
      return [{
        id: `tracker:${candidate.jobId}:${instance}:${frameIndex}`,
        source: "tracker" as const,
        ref: geometry.mask,
        color: "#a855f7",
        zOrder: Number.MAX_SAFE_INTEGER - index,
        selected: false,
        cachePrefix: `tracker:${candidate.jobId}:instance:${instance}`,
        frameKey: frameIndex,
        load: () => videoTrackerApi.maskContent(candidate.jobId, geometry.mask.sha256),
      }];
    });
    return [...committed, ...staged];
  }, [annotations, candidates, colorForAnnotation, frameIndex, selectedId]);

  useEffect(() => {
    generationRef.current += 1;
    for (const cached of cacheRef.current.values()) closeImage(cached.image);
    cacheRef.current.clear();
    setRecords((current) => current.length > 0 ? [] : current);
  }, [taskId]);

  useEffect(() => {
    const generation = ++generationRef.current;
    let cancelled = false;
    if (descriptors.length === 0) {
      setRecords((current) => current.length > 0 ? [] : current);
      return () => { cancelled = true; };
    }
    const activeKeys = new Set(descriptors.map(cacheKey));
    const committedIds = new Set(
      descriptors.filter((descriptor) => descriptor.source === "annotation").map((descriptor) => descriptor.id),
    );
    for (const [key, cached] of cacheRef.current) {
      const superseded = [...committedIds].some((id) => {
        const descriptor = descriptors.find((item) => item.id === id && item.source === "annotation");
        return key.startsWith(`annotation:${id}:version:`)
          && descriptor != null
          && !key.startsWith(`${descriptor.cachePrefix}:`);
      });
      if (superseded) {
        closeImage(cached.image);
        cacheRef.current.delete(key);
      }
    }

    const resolveRecords = async () => {
      const next = await Promise.all(descriptors.map(async (descriptor) => {
        const key = cacheKey(descriptor);
        let cached = cacheRef.current.get(key);
        if (!cached) {
          const rle = await descriptor.load();
          if (rle.size[0] !== descriptor.ref.size[0] || rle.size[1] !== descriptor.ref.size[1]) {
            throw new Error("mask content size does not match its reference");
          }
          const alpha = decodeCocoRle(rle);
          const [height, width] = rle.size;
          const image = await createMaskImage(alpha, width, height, descriptor.color);
          if (cancelled || generation !== generationRef.current) {
            closeImage(image);
            return null;
          }
          cached = { image, alpha, width, height, geom: maskAlphaBounds(alpha, width, height) };
          cacheRef.current.set(key, cached);
        } else {
          cacheRef.current.delete(key);
          cacheRef.current.set(key, cached);
        }
        return {
          id: descriptor.id,
          source: descriptor.source,
          image: cached.image,
          alpha: cached.alpha,
          width: cached.width,
          height: cached.height,
          geom: cached.geom,
          zOrder: descriptor.zOrder,
          selected: descriptor.selected,
          cacheKey: key,
        } satisfies VideoMaskRenderRecord;
      }));
      if (cancelled || generation !== generationRef.current) return;
      while (cacheRef.current.size > MAX_CACHED_MASKS) {
        const evictKey = [...cacheRef.current.keys()].find((key) => !activeKeys.has(key));
        if (!evictKey) break;
        const evicted = cacheRef.current.get(evictKey);
        if (evicted) closeImage(evicted.image);
        cacheRef.current.delete(evictKey);
      }
      setRecords(next.filter((record): record is VideoMaskRenderRecord => record !== null));
    };

    void resolveRecords().catch(() => {
      if (!cancelled && generation === generationRef.current) {
        setRecords((current) => current.length > 0 ? [] : current);
      }
    });
    return () => { cancelled = true; };
  }, [descriptors]);

  useEffect(() => () => {
    generationRef.current += 1;
    for (const cached of cacheRef.current.values()) closeImage(cached.image);
    cacheRef.current.clear();
  }, []);

  return records;
}

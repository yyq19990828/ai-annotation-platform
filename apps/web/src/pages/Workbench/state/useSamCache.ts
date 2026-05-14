/**
 * v0.10.4 I6.1 · SAM 候选前端 LRU 缓存。
 *
 * 重复点击同一坐标 / 拖同一框时，跳过对后端的重复请求；后端 embedding cache 减少了
 * encoder 开销但仍走 HTTP round-trip。前端缓存让重复操作秒回。
 *
 * Key 设计：
 *   `${taskId}|${mlBackendId}|${ctxKind}|${normalize(ctx)}`
 *
 * `normalize` 把可序列化字段（points / bbox / text / exemplar bbox / 额外参数）按 key
 * 排序后 JSON.stringify；点坐标按 4 位小数 round 防浮点抖动。
 *
 * Eviction：
 * - LRU 32 项；最久未访问的先淘汰。
 * - `clearAll()` 在 mlBackendId / capability 变更时调用。
 */
import type { PendingCandidate } from "./useInteractiveAI";

const DEFAULT_CAP = 32;
const COORD_PRECISION = 4;

function roundCoord(n: number): number {
  const f = 10 ** COORD_PRECISION;
  return Math.round(n * f) / f;
}

function normalizeCtx(ctx: Record<string, unknown>): string {
  // 浅 clone + 坐标 round；按 key 排序后 JSON。
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(ctx).sort()) {
    const v = ctx[k];
    if (Array.isArray(v)) {
      out[k] = v.map((entry) => {
        if (Array.isArray(entry) && entry.every((e) => typeof e === "number")) {
          return entry.map((n) => roundCoord(n as number));
        }
        return entry;
      });
    } else if (typeof v === "number") {
      out[k] = roundCoord(v);
    } else {
      out[k] = v;
    }
  }
  return JSON.stringify(out);
}

export interface SamCacheKeyArgs {
  taskId: string;
  mlBackendId: string;
  ctxKind: string;
  ctx: Record<string, unknown>;
}

export function makeSamCacheKey({ taskId, mlBackendId, ctxKind, ctx }: SamCacheKeyArgs): string {
  return `${taskId}|${mlBackendId}|${ctxKind}|${normalizeCtx(ctx)}`;
}

export interface SamCacheEntry {
  candidates: PendingCandidate[];
  timestamp: number;
}

export interface SamCache {
  get: (key: string) => PendingCandidate[] | undefined;
  set: (key: string, candidates: PendingCandidate[]) => void;
  clearAll: () => void;
  readonly size: number;
  readonly stats: { hits: number; misses: number };
}

export function createSamCache(cap: number = DEFAULT_CAP): SamCache {
  const map = new Map<string, SamCacheEntry>();
  let hits = 0;
  let misses = 0;

  return {
    get(key) {
      const entry = map.get(key);
      if (!entry) {
        misses += 1;
        return undefined;
      }
      // LRU 触摸：删后重插，迭代顺序末尾 = 最新。
      map.delete(key);
      map.set(key, { ...entry, timestamp: Date.now() });
      hits += 1;
      return entry.candidates;
    },
    set(key, candidates) {
      if (map.has(key)) {
        map.delete(key);
      } else if (map.size >= cap) {
        // 淘汰最早项
        const oldestKey = map.keys().next().value;
        if (oldestKey !== undefined) map.delete(oldestKey);
      }
      map.set(key, { candidates, timestamp: Date.now() });
    },
    clearAll() {
      map.clear();
    },
    get size() {
      return map.size;
    },
    get stats() {
      return { hits, misses };
    },
  };
}

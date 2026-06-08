/**
 * v0.14.13 冷启动 UX 本地猜测; v0.14.14 起被 PredictionResult.cache_hit 真信号替换.
 *
 * v0.14.14 双轨:
 * - **真信号路径 (主)**: 用 `recordPredictCacheHit` + `isVariantHot` 维护本会话内的 cache_hit
 *   Map (Map<key, boolean>). predict 响应回来时调 record; 下次同 variant 调用前查 Map 决定按钮文案.
 *   这是协议 §4.2 PredictionResult.cache_hit 的前端落地: 真信号优先.
 * - **sessionStorage 猜测 (deprecated, 兼容老 backend)**: isVariantWarm / markVariantWarm 仍在跑,
 *   只在 backend 未上报 cache_hit 时作 fallback (协议 §4.2 字段缺省时). 下版 v0.14.15 删除.
 *
 * Key 形式: `<backendId>|<axisKey>=<value>;<axisKey>=<value>` (axis 按字母排序保稳定).
 */

const STORAGE_KEY = "ai-annotation:variant-warm-cache:v1";

function loadSet(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveSet(set: Set<string>): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // quota exceeded / disabled → 静默放弃 (本机制是 best-effort UX 提示).
  }
}

function makeKey(
  backendId: string,
  variants: Record<string, unknown>,
): string {
  const parts: string[] = [];
  const keys = Object.keys(variants).sort();
  for (const k of keys) {
    const v = variants[k];
    if (typeof v === "string") parts.push(`${k}=${v}`);
  }
  return `${backendId}|${parts.join(";")}`;
}

export interface VariantWarmCache {
  isWarm(backendId: string | null | undefined, variants: Record<string, unknown>): boolean;
  markWarm(backendId: string | null | undefined, variants: Record<string, unknown>): void;
}

/**
 * 单实例 cache (模块级即可, 不需要 react context). 测试时可调 _reset() 清干净.
 */
let _cache: Set<string> | null = null;
function getSet(): Set<string> {
  if (_cache == null) _cache = loadSet();
  return _cache;
}

/**
 * v0.14.14 起被 isVariantHot (真信号 cache_hit) 替换. 留作老 backend (未上报
 * cache_hit) 的 fallback, 下版 v0.14.15 删除.
 *
 * 注: 不用 jsdoc @deprecated tag, 避免触发 TS 6385/6387 在所有调用点报 warning;
 * 本周期 fallback 路径仍主动调用本函数, 标黄无益.
 */
export function isVariantWarm(
  backendId: string | null | undefined,
  variants: Record<string, unknown>,
): boolean {
  if (!backendId) return false;
  return getSet().has(makeKey(backendId, variants));
}

/**
 * v0.14.14 起被 recordPredictCacheHit (真信号) 替换. 仅作 fallback 保留一版.
 *
 * 注: 不用 jsdoc @deprecated tag, 避免在调用点报 TS warning; 见 isVariantWarm 注释.
 */
export function markVariantWarm(
  backendId: string | null | undefined,
  variants: Record<string, unknown>,
): void {
  if (!backendId) return;
  const set = getSet();
  const k = makeKey(backendId, variants);
  if (set.has(k)) return;
  set.add(k);
  saveSet(set);
}

/** 仅供单测; 业务代码不要用. */
export function _resetVariantWarmCache(): void {
  _cache = null;
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

// ============================================================================
// v0.14.14: 真信号 (cache_hit) Map. 不持久化 sessionStorage, 仅本会话内有效.
// 后端 pool LRU evict / 服务重启后, Map 还以为热的 → 那一次仍误判, 但响应回来会
// 把对应 key 写为 false, 下次自我修正. 误判可接受 (一次的"加载中"显示偏差).
// ============================================================================

/** key → 上次 predict 响应里的 cache_hit. true=热(权重在 pool), false=冷(本次触发加载). */
const _hotMap = new Map<string, boolean>();

/**
 * predict / warmup 响应回来后调: 写入 (backendId, variants) → cache_hit.
 * 协议 §4.2 PredictionResult.cache_hit; 缺省 (null/undefined) 时忽略不污染 Map.
 */
export function recordPredictCacheHit(
  backendId: string | null | undefined,
  variants: Record<string, unknown>,
  cacheHit: boolean | null | undefined,
): void {
  if (!backendId) return;
  if (cacheHit !== true && cacheHit !== false) return;
  _hotMap.set(makeKey(backendId, variants), cacheHit);
}

/**
 * 查询本会话内是否记得该 (backendId, variants) 是热的.
 * 没记录 ⇒ undefined (调用方按"未知"路径处理: 不显示"加载中", 也不显示"已就绪",
 * 用更克制的提示如"首次可能略慢"). 协议 §4.2 真信号优先于 sessionStorage 猜测.
 */
export function isVariantHot(
  backendId: string | null | undefined,
  variants: Record<string, unknown>,
): boolean | undefined {
  if (!backendId) return undefined;
  return _hotMap.get(makeKey(backendId, variants));
}

/** 仅供单测. */
export function _resetVariantHotMap(): void {
  _hotMap.clear();
}

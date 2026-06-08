/**
 * 工作台 / 预标面板 variant 冷启动 UX hint 缓存.
 *
 * 单一存储 (Map<key, hot>, sessionStorage 持久化), 多源写入:
 *   - 异步 trigger / 批量预标 onSuccess → `markVariantHot(bid, vars)` 写 true (兜底猜测;
 *     成功推理意味着 backend 完成时该 variant 在 pool, 下一次大概率仍热).
 *   - 同步 predict 响应回来 → `recordPredictCacheHit(bid, vars, cache_hit)` 写真信号
 *     (cache_hit=false 反映本次冷启动 / pool LRU evict, 让下次显示退回到"冷").
 *
 * 查询: `isVariantHot(bid, vars)` 默认 false.
 *
 * Key 形式: `<backendId>|<axisKey>=<value>;<axisKey>=<value>` (axis 按字母排序保稳定).
 */

const STORAGE_KEY = "ai-annotation:variant-hot-cache:v1";

interface PersistShape {
  // key → hot (true = pool 有该 variant; false = 真信号上报冷).
  // 仅持久化 true 项 (节省空间); false 项进 _hotMap 但不写回 sessionStorage,
  // 这样新会话起步默认 false, 上次会话残留的"热"提示得以保留.
  hot: string[];
}

function loadMap(): Map<string, boolean> {
  if (typeof sessionStorage === "undefined") return new Map();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Partial<PersistShape>;
    const arr = Array.isArray(obj?.hot) ? obj!.hot : [];
    const m = new Map<string, boolean>();
    for (const k of arr) if (typeof k === "string") m.set(k, true);
    return m;
  } catch {
    return new Map();
  }
}

function saveMap(map: Map<string, boolean>): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const hot: string[] = [];
    for (const [k, v] of map) if (v) hot.push(k);
    const payload: PersistShape = { hot };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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

let _map: Map<string, boolean> | null = null;
function getMap(): Map<string, boolean> {
  if (_map == null) _map = loadMap();
  return _map;
}

export function isVariantHot(
  backendId: string | null | undefined,
  variants: Record<string, unknown>,
): boolean {
  if (!backendId) return false;
  return getMap().get(makeKey(backendId, variants)) === true;
}

/**
 * 兜底标热: 异步 trigger / 批量预标成功后调 (前端拿不到 PredictionResult.cache_hit,
 * 但推理成功本身意味着 backend 此时 pool 中有此 variant).
 */
export function markVariantHot(
  backendId: string | null | undefined,
  variants: Record<string, unknown>,
): void {
  if (!backendId) return;
  const m = getMap();
  const k = makeKey(backendId, variants);
  if (m.get(k) === true) return;
  m.set(k, true);
  saveMap(m);
}

/**
 * 同步 predict 响应真信号 (协议 §4.2 PredictionResult.cache_hit). 缺省 (null/undefined)
 * 不写; 显式 false 落库 (反映 pool LRU evict 后再次冷启动).
 *
 * 注: 当前业务代码尚未串通同步 predict 响应到本函数; 仅 interactive 路径
 * (sam.warmup / shift+T 视频预标) 后续接通时会调用. 单测覆盖签名稳定性.
 */
export function recordPredictCacheHit(
  backendId: string | null | undefined,
  variants: Record<string, unknown>,
  cacheHit: boolean | null | undefined,
): void {
  if (!backendId) return;
  if (cacheHit !== true && cacheHit !== false) return;
  const m = getMap();
  const k = makeKey(backendId, variants);
  if (m.get(k) === cacheHit) return;
  m.set(k, cacheHit);
  saveMap(m);
}

/** 仅供单测; 业务代码不要用. */
export function _resetVariantHotCache(): void {
  _map = null;
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

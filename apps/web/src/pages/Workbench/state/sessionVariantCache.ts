/**
 * v0.14.13 · 冷启动 UX 本地猜测 (sessionStorage 命中集合).
 *
 * 现状: 后端 /predict 响应不暴露 cache_hit / model_load_ms, 前端无法区分是否首次冷加载.
 * 临时方案: 前端维护"本会话内见过的 variant 组合"集合, 没见过 ⇒ 按钮文案显示"加载模型中…",
 * 见过 ⇒ "预标注中". 失败不入集合 (下次重试还提示加载).
 *
 * 误判:
 * - backend pool LRU evict 后, 前端缓存仍以为热命中 → 那次会感觉慢却显示"预标注中".
 * - 服务重启后前端 sessionStorage 还在 → 同上.
 * 这俩误判可接受, 等 v0.14.14 后端加 cache_hit 真信号后替换本机制.
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

export function isVariantWarm(
  backendId: string | null | undefined,
  variants: Record<string, unknown>,
): boolean {
  if (!backendId) return false;
  return getSet().has(makeKey(backendId, variants));
}

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

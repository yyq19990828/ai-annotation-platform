// v0.6.5：HotkeyCheatSheet 「按使用频率排」的存储层。
//
// 把 dispatch 出的每个 action.type 在 localStorage 累加计数。
// 同 type 跨多个 HotkeyDef 共享（例如 setTool 涵盖 B/V/P 三键）— 已是合理近似。
const KEY = "hotkey_usage_v1";
const MAX_BUCKET = 10000; // 防止单 bucket 无限膨胀的简易上限

type Counts = Record<string, number>;

function readAll(): Counts {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? (parsed as Counts) : {};
  } catch {
    return {};
  }
}

export function recordHotkeyUsage(actionType: string): void {
  if (!actionType) return;
  const all = readAll();
  const cur = all[actionType] ?? 0;
  if (cur >= MAX_BUCKET) return;
  all[actionType] = cur + 1;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* quota */ }
}

export function getHotkeyUsage(): Counts {
  return readAll();
}

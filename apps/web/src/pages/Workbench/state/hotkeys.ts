// Single source of truth for Workbench shortcuts.
// useEffect 注册和 HotkeyCheatSheet 都从这里读，避免漂移。

export type HotkeyGroup = "view" | "draw" | "ai" | "nav" | "system";

export interface HotkeyDef {
  keys: string[];        // display labels e.g. ["Ctrl", "Z"]
  desc: string;
  group: HotkeyGroup;
  /** v0.6.5：与 dispatch 出的 action.type 关联，用于「按使用频率排」。
   *  同 action.type 多 HotkeyDef 时共享同一计数（如 setTool 三键合并）。
   *  无明确 action 的演示类（如「拖动顶点」）留空，频率排时排到最后。 */
  actionType?: string;
}

export const HOTKEYS: HotkeyDef[] = [
  { keys: ["B"], desc: "矩形框工具", group: "draw", actionType: "setTool" },
  { keys: ["S"], desc: "SAM 智能工具（再按循环切子工具：点 → 框 → 文本 → 退出）", group: "ai", actionType: "setTool" },
  { keys: ["= / +"], desc: "SAM 子工具栏：正向点 (sam-point 子工具下生效)", group: "ai", actionType: "samPolarity" },
  { keys: ["-"], desc: "SAM 子工具栏：负向点 (sam-point 子工具下生效)", group: "ai", actionType: "samPolarity" },
  { keys: ["P"], desc: "多边形工具", group: "draw", actionType: "setTool" },
  { keys: ["V"], desc: "平移工具", group: "draw", actionType: "setTool" },
  { keys: ["Enter"], desc: "闭合多边形（≥3 顶点）", group: "draw" },
  { keys: ["Backspace"], desc: "删除多边形最后一点 / 删除选中框", group: "draw", actionType: "deleteSelected" },
  { keys: ["拖动顶点"], desc: "多边形顶点拖动（选中时）", group: "draw" },
  { keys: ["Alt", "click 边"], desc: "多边形边上插入新顶点", group: "draw" },
  { keys: ["Shift", "click 顶点"], desc: "多边形删除该顶点（≤3 拒绝）", group: "draw" },
  { keys: ["1 — 9"], desc: "切换类别", group: "draw", actionType: "setClassByDigit" },
  { keys: ["Delete"], desc: "删除选中框（多选时批量）", group: "draw", actionType: "deleteSelected" },
  { keys: ["Tab"], desc: "下一个 user 框（循环）", group: "draw", actionType: "cycleUser" },
  { keys: ["Shift", "Tab"], desc: "上一个 user 框（循环）", group: "draw", actionType: "cycleUser" },
  { keys: ["J"], desc: "下一个 user 框（不循环）", group: "draw", actionType: "cycleUser" },
  { keys: ["K"], desc: "上一个 user 框（不循环）", group: "draw", actionType: "cycleUser" },
  { keys: ["↑ ↓ ← →"], desc: "选中框 1px 平移（Shift = 10px）", group: "draw", actionType: "arrowNudge" },
  { keys: ["Shift", "click"], desc: "叠加多选 user 框", group: "draw" },
  { keys: ["Ctrl", "A"], desc: "全选当前帧 user 框", group: "draw", actionType: "selectAllUser" },
  { keys: ["Ctrl", "C"], desc: "复制选中框", group: "draw", actionType: "copy" },
  { keys: ["Ctrl", "V"], desc: "粘贴（偏移 +10px）", group: "draw", actionType: "paste" },
  { keys: ["Ctrl", "D"], desc: "原地复制（偏移 +10px）", group: "draw", actionType: "duplicate" },

  { keys: ["Ctrl", "Z"], desc: "撤销", group: "draw", actionType: "undo" },
  { keys: ["Ctrl", "Shift", "Z"], desc: "重做", group: "draw", actionType: "redo" },
  { keys: ["Ctrl", "Y"], desc: "重做（备用）", group: "draw", actionType: "redo" },

  { keys: ["Ctrl", "+ wheel"], desc: "以光标为锚点缩放", group: "view" },
  { keys: ["Ctrl", "0"], desc: "重置缩放与平移", group: "view", actionType: "fitReset" },
  { keys: ["Space", "+ drag"], desc: "平移画布", group: "view", actionType: "spacePanOn" },
  { keys: ["双击空白"], desc: "适应视口", group: "view" },

  { keys: ["A"], desc: "采纳选中 AI 框", group: "ai", actionType: "acceptAi" },
  { keys: ["D"], desc: "驳回选中 AI 框", group: "ai", actionType: "rejectAi" },
  { keys: ["["], desc: "降低置信度阈值 (-0.05)", group: "ai", actionType: "thresholdAdjust" },
  { keys: ["]"], desc: "提高置信度阈值 (+0.05)", group: "ai", actionType: "thresholdAdjust" },

  { keys: ["Ctrl", "→"], desc: "下一题", group: "nav", actionType: "navigateTask" },
  { keys: ["Ctrl", "←"], desc: "上一题", group: "nav", actionType: "navigateTask" },
  { keys: ["N"], desc: "智能切题：下一未标注", group: "nav", actionType: "smartNext" },
  { keys: ["U"], desc: "智能切题：下一最不确定", group: "nav", actionType: "smartNext" },
  { keys: ["E"], desc: "提交质检", group: "nav", actionType: "submit" },

  { keys: ["?"], desc: "打开本面板", group: "system", actionType: "showHotkeys" },
  { keys: ["Esc"], desc: "取消选择 / 关闭弹窗", group: "system", actionType: "cancel" },
];

export const GROUP_LABEL: Record<HotkeyGroup, string> = {
  view: "视图",
  draw: "绘制",
  ai: "AI",
  nav: "导航",
  system: "系统",
};

// ── pure dispatch ───────────────────────────────────────────────────────────
// 把 KeyboardEvent + 简单上下文映射为 HotkeyAction。
// WorkbenchShell 的 useEffect 据此 switch；hotkeys.test.ts 据此覆盖分支。

export type HotkeyAction =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "fitReset" }
  | { type: "navigateTask"; dir: "next" | "prev" }
  | { type: "selectAllUser" }
  | { type: "copy" }
  | { type: "paste" }
  | { type: "duplicate" }
  | { type: "cancel" }
  | { type: "showHotkeys" }
  | { type: "spacePanOn" }
  | { type: "arrowNudge"; dx: number; dy: number }
  | { type: "thresholdAdjust"; delta: number }
  | { type: "cycleUser"; dir: 1 | -1; loop: boolean }
  | { type: "smartNext"; mode: "open" | "uncertain" }
  | { type: "changeClass" }
  | { type: "setTool"; tool: "box" | "hand" | "polygon" | "sam" }
  | { type: "setClassByDigit"; idx: number }
  | { type: "setClassByLetter"; letter: string }
  | { type: "setAttribute"; key: string; value: unknown }
  | { type: "deleteSelected" }
  | { type: "submit" }
  | { type: "acceptAi" }
  | { type: "rejectAi" }
  | { type: "samPolarity"; polarity: "positive" | "negative" };

/** 属性 hotkey 解析结果（D.1）：
 * 由 WorkbenchShell 根据当前 selected box 的 class_name + project.attribute_schema 计算
 * 当某个数字键命中某个 boolean / select 字段时，dispatcher 决策接下来的下一个值。
 */
export interface AttributeHotkeyHit {
  key: string;
  type: "boolean" | "select";
  /** select 类型必填；boolean 忽略。 */
  options?: string[];
  /** 当前值（用于 select 计算 next；boolean 用于反转）。 */
  currentValue?: unknown;
}

export interface DispatchCtx {
  /** 焦点在 input/textarea/contenteditable 上时，禁用 hotkey。 */
  isInputFocused: boolean;
  /** 是否有任意选中（决定方向键 nudge / a/d AI accept-reject 等是否激活）。 */
  hasSelection: boolean;
  /** pendingDrawing | editingClass | batchChanging 中任一活跃 → 类别按键归 popover 消费。 */
  pendingActive: boolean;
  /** D.1：选中标注且当前数字键命中某个属性 hotkey 时，返回属性元数据；否则返回 null。
   *  实现由 WorkbenchShell 层注入（绑了项目 schema 与当前 annotation.attributes）。
   */
  attributeHotkey?: (digit: string) => AttributeHotkeyHit | null;
}

const RESERVED_LETTERS = new Set(["v","V","b","B","p","P","s","S","a","A","d","D","e","E","n","N","u","U","j","J","k","K","c","C"]);

/** 纯函数：解析 keydown 事件为 HotkeyAction。返回 null 表示不消费。 */
export function dispatchKey(e: KeyboardEvent, ctx: DispatchCtx): HotkeyAction | null {
  if (ctx.isInputFocused) return null;

  // 系统级（带 Ctrl/Meta）
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === "z") return e.shiftKey ? { type: "redo" } : { type: "undo" };
    if (k === "y") return { type: "redo" };
    if (e.key === "0") return { type: "fitReset" };
    if (e.key === "ArrowRight") return { type: "navigateTask", dir: "next" };
    if (e.key === "ArrowLeft")  return { type: "navigateTask", dir: "prev" };
    if (k === "a") return { type: "selectAllUser" };
    if (k === "c") return { type: "copy" };
    if (k === "v") return { type: "paste" };
    if (k === "d") return { type: "duplicate" };
    return null;
  }

  // 方向键 nudge（仅在有选中时；上层进一步过滤是否含 user 框）
  if (ctx.hasSelection) {
    const ARR: Record<string, [number, number]> = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    };
    if (e.key in ARR) {
      const step = e.shiftKey ? 10 : 1;
      const [ux, uy] = ARR[e.key];
      return { type: "arrowNudge", dx: ux * step, dy: uy * step };
    }
  }

  if (e.key === " ")    return { type: "spacePanOn" };
  if (e.key === "?")    return { type: "showHotkeys" };
  if (e.key === "Escape") return { type: "cancel" };

  // popover 活跃时，类别字母 / 数字键归它消费
  if (ctx.pendingActive) return null;

  if (e.key === "[")  return { type: "thresholdAdjust", delta: -0.05 };
  if (e.key === "]")  return { type: "thresholdAdjust", delta:  0.05 };

  // v0.9.4 phase 2 · SAM 子工具栏 polarity (sam-point 下生效, 由消费端 gate by tool/samSubTool).
  // "+" 需要 Shift+=, "=" 单按 = SAM positive; "-" 单按 = SAM negative.
  if (e.key === "+" || e.key === "=") return { type: "samPolarity", polarity: "positive" };
  if (e.key === "-") return { type: "samPolarity", polarity: "negative" };

  if (e.key === "Tab") return { type: "cycleUser", dir: e.shiftKey ? -1 : 1, loop: true };
  if (e.key === "j" || e.key === "J") return { type: "cycleUser", dir: 1, loop: false };
  if (e.key === "k" || e.key === "K") return { type: "cycleUser", dir: -1, loop: false };

  if (e.key === "n" || e.key === "N") return { type: "smartNext", mode: "open" };
  if (e.key === "u" || e.key === "U") return { type: "smartNext", mode: "uncertain" };

  // C 键（无修饰）：选中态走改类别；否则不消费。a/d 同理（接 AI accept/reject）。
  if ((e.key === "c" || e.key === "C") && ctx.hasSelection) return { type: "changeClass" };

  if (e.key === "v" || e.key === "V") return { type: "setTool", tool: "hand" };
  if (e.key === "b" || e.key === "B") return { type: "setTool", tool: "box" };
  if (e.key === "s" || e.key === "S") return { type: "setTool", tool: "sam" };
  if (e.key === "p" || e.key === "P") return { type: "setTool", tool: "polygon" };

  if (e.key >= "1" && e.key <= "9") {
    // D.1：选中态下，如属性 schema 在该数字键有命中，优先走属性切换；否则保留类别 fallback
    if (ctx.hasSelection && ctx.attributeHotkey) {
      const hit = ctx.attributeHotkey(e.key);
      if (hit) {
        if (hit.type === "boolean") {
          return { type: "setAttribute", key: hit.key, value: !hit.currentValue };
        }
        if (hit.type === "select" && hit.options && hit.options.length > 0) {
          const cur = hit.currentValue == null ? "" : String(hit.currentValue);
          const idx = hit.options.indexOf(cur);
          const next = hit.options[(idx + 1) % hit.options.length];
          return { type: "setAttribute", key: hit.key, value: next };
        }
      }
    }
    return { type: "setClassByDigit", idx: parseInt(e.key, 10) - 1 };
  }

  if (/^[a-z]$/i.test(e.key) && !RESERVED_LETTERS.has(e.key)) {
    return { type: "setClassByLetter", letter: e.key.toLowerCase() };
  }

  if (e.key === "Delete" || e.key === "Backspace") return { type: "deleteSelected" };
  if (e.key === "e" || e.key === "E") return { type: "submit" };

  if ((e.key === "a" || e.key === "A") && ctx.hasSelection) return { type: "acceptAi" };
  if ((e.key === "d" || e.key === "D") && ctx.hasSelection) return { type: "rejectAi" };

  return null;
}

export const ARROW_KEY_SET = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

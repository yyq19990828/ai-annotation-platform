// Single source of truth for Workbench shortcuts.
// useEffect 注册和 HotkeyCheatSheet 都从这里读，避免漂移。

export type HotkeyGroup = "view" | "draw" | "ai" | "nav" | "video" | "system";

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
  { keys: ["Alt", "1"], desc: "矩形框工具（备用，避免与切类别冲突）", group: "draw", actionType: "setTool" },
  { keys: ["W"], desc: "旋转框 (OBB) 工具：拖框后用顶部手柄旋转", group: "draw", actionType: "setTool" },
  { keys: ["S"], desc: "AI 工具循环：智能点 → 智能框 → Magic Box → 文本提示 → Exemplar → 退出（跳过置灰）", group: "ai", actionType: "setTool" },
  { keys: ["Alt", "3"], desc: "AI 工具（备用）", group: "ai", actionType: "setTool" },
  { keys: ["G"], desc: "Magic Box: 粗框 → SAM 收紧到对象紧凑外接矩形 → 落 bbox（v0.10.17+）", group: "ai", actionType: "setTool" },
  { keys: ["= / +"], desc: "智能点工具：切正向", group: "ai", actionType: "samPolarity" },
  { keys: ["-"], desc: "智能点工具：切负向", group: "ai", actionType: "samPolarity" },
  { keys: ["P"], desc: "多边形工具", group: "draw", actionType: "setTool" },
  { keys: ["L"], desc: "折线工具（开放、不闭合；无选中时生效）", group: "draw", actionType: "setTool" },
  { keys: ["F"], desc: "关键点工具：按骨骼模板依次落点（Alt = 遮挡，右键 = 跳过）", group: "draw", actionType: "setTool" },
  // v0.10.8 · I11 Mask 编辑器: 全局 M 切工具; 工具内 B/E 切笔刷/橡皮 (capture, dispatchKey 之前).
  { keys: ["M"], desc: "Mask 笔刷工具", group: "draw", actionType: "setTool" },
  { keys: ["Shift", "+ wheel"], desc: "Mask 工具: 调笔刷半径 (±2px)", group: "draw" },
  { keys: ["B"], desc: "Mask 工具激活时: 切笔刷模式", group: "draw" },
  { keys: ["E"], desc: "Mask 工具激活时: 切橡皮模式", group: "draw" },
  { keys: ["Enter"], desc: "Mask 工具激活时: 提交 mask → polygon 落库", group: "draw" },
  { keys: ["Alt", "3"], desc: "多边形工具（备用）", group: "draw", actionType: "setTool" },
  { keys: ["V"], desc: "平移工具", group: "draw", actionType: "setTool" },
  { keys: ["Alt", "4"], desc: "平移工具（备用）", group: "draw", actionType: "setTool" },
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
  // I12 · Object Group + 批量编辑
  { keys: ["Ctrl", "G"], desc: "把选中的 ≥2 个标注合并为一个组（同色虚线外框）", group: "draw", actionType: "annotationGroup" },
  { keys: ["Ctrl", "Shift", "G"], desc: "把选中的标注从组里拆出（剩 1 个成员的组自动解散）", group: "draw", actionType: "annotationUngroup" },

  { keys: ["Ctrl", "Z"], desc: "撤销", group: "draw", actionType: "undo" },
  { keys: ["Ctrl", "Shift", "Z"], desc: "重做", group: "draw", actionType: "redo" },
  { keys: ["Ctrl", "Y"], desc: "重做（备用）", group: "draw", actionType: "redo" },

  { keys: ["Ctrl", "+ wheel"], desc: "以光标为锚点缩放", group: "view" },
  { keys: ["Ctrl", "0"], desc: "重置缩放与平移", group: "view", actionType: "fitReset" },
  { keys: ["Space", "+ drag"], desc: "平移画布", group: "view", actionType: "spacePanOn" },
  { keys: ["双击空白"], desc: "适应视口", group: "view" },

  { keys: ["Space"], desc: "视频播放 / 暂停", group: "video", actionType: "videoTogglePlayback" },
  { keys: ["J / K / L"], desc: "视频反向 / 暂停 / 正向多速率播放", group: "video", actionType: "videoJogPlayback" },
  { keys: ["B"], desc: "视频矩形框工具", group: "video", actionType: "setVideoTool" },
  { keys: ["T"], desc: "视频轨迹工具", group: "video", actionType: "setVideoTool" },
  { keys: ["← / →"], desc: "视频逐帧后退 / 前进（采样开启时按网格跳）", group: "video", actionType: "videoSeek" },
  { keys: [", / ."], desc: "选中轨迹时跳上/下关键帧；否则上一帧 / 下一帧（采样开启时为 ±1 微调）", group: "video", actionType: "videoSeek" },
  { keys: ["Home / End"], desc: "选中轨迹时跳该轨迹首次 / 最后出现帧", group: "video", actionType: "videoSeekKeyframe" },
  { keys: ["Shift", "← / →"], desc: "采样开启：±1 源帧微调（逃生口）；否则选中轨迹跳关键帧 / ±10 帧", group: "video", actionType: "videoSeekKeyframe" },
  { keys: ["Alt", "← / →"], desc: "采样开启：选中轨迹跳上/下关键帧", group: "video", actionType: "videoSeekKeyframe" },
  { keys: ["Ctrl", "M"], desc: "视频当前帧添加 / 移除书签", group: "video", actionType: "videoToggleBookmark" },
  { keys: ["Ctrl", "[ / ]"], desc: "视频跳转历史后退 / 前进", group: "video", actionType: "videoJumpHistory" },
  { keys: ["Alt", "L"], desc: "清除视频播放范围", group: "video", actionType: "videoClearLoopRegion" },
  { keys: ["Delete / Backspace"], desc: "删除选中轨迹", group: "video", actionType: "videoDeleteSelected" },
  { keys: ["PageUp"], desc: "跳到上一章节", group: "video" },
  { keys: ["PageDown"], desc: "跳到下一章节", group: "video" },
  { keys: ["Tab"], desc: "下一个轨迹（循环）", group: "video", actionType: "videoCycleTrack" },
  { keys: ["Shift", "Tab"], desc: "上一个轨迹（循环）", group: "video", actionType: "videoCycleTrack" },
  { keys: ["Esc"], desc: "取消选择", group: "video", actionType: "cancel" },
  { keys: ["1 — 9"], desc: "切换视频类别（有选中则改选中对象）", group: "video", actionType: "setClassByDigit" },

  { keys: ["A"], desc: "采纳选中 AI 框", group: "ai", actionType: "acceptAi" },
  { keys: ["D"], desc: "驳回选中 AI 框", group: "ai", actionType: "rejectAi" },
  { keys: ["["], desc: "选中态：z_order -1；否则降置信度阈值", group: "ai", actionType: "thresholdAdjust" },
  { keys: ["]"], desc: "选中态：z_order +1；否则升置信度阈值", group: "ai", actionType: "thresholdAdjust" },
  { keys: ["L"], desc: "切换选中 shape 锁定状态", group: "draw", actionType: "toggleShapeFlag" },
  { keys: ["H"], desc: "切换选中 shape 隐藏状态", group: "draw", actionType: "toggleShapeFlag" },
  { keys: ["O"], desc: "切换选中 shape 遮挡 (occluded) 状态", group: "draw", actionType: "toggleShapeFlag" },

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
  video: "视频",
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
  | { type: "setTool"; tool: "box" | "rotated-box" | "hand" | "polygon" | "polyline" | "keypoint" | "mask" | "smart-point" | "smart-box" | "text-prompt" | "exemplar" | "magic-box" | "ai-cycle" }
  | { type: "setVideoTool"; tool: "box" | "track" }
  | { type: "setClassByDigit"; idx: number }
  | { type: "setClassByLetter"; letter: string }
  | { type: "setAttribute"; key: string; value: unknown }
  | { type: "deleteSelected" }
  // v0.10.5 M4-β · I15 shape 状态位快捷键。
  | { type: "toggleShapeFlag"; flag: "is_locked" | "is_hidden" | "is_occluded" }
  | { type: "bumpZOrder"; delta: -1 | 1 }
  | { type: "submit" }
  | { type: "acceptAi" }
  | { type: "rejectAi" }
  | { type: "samPolarity"; polarity: "positive" | "negative" }
  | { type: "videoTogglePlayback" }
  | { type: "videoJogPlayback"; dir: -1 | 1 }
  | { type: "videoPausePlayback" }
  | { type: "videoSeek"; delta: number }
  // v0.10.29 · 软网格导航：采样开启 (step>1) 时 ←/→ 走网格跳。
  | { type: "videoSeekGrid"; dir: -1 | 1 }
  // v0.10.29 · 逃生口：±1 源帧微调 (采样开启时 Shift+←/→ 与 ,/. )。
  | { type: "videoMicroStep"; dir: -1 | 1 }
  | { type: "videoSeekKeyframe"; dir: -1 | 1 }
  | { type: "videoToggleBookmark" }
  | { type: "videoJumpHistory"; dir: -1 | 1 }
  | { type: "videoClearLoopRegion" }
  | { type: "videoDeleteSelected" }
  | { type: "videoCycleTrack"; dir: 1 | -1 }
  // I12 · Object Group
  | { type: "annotationGroup" }
  | { type: "annotationUngroup" };

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
  /** video stage active: consume video namespace before image drawing shortcuts. */
  videoMode?: boolean;
  /** selected annotation is a video_track; used for contextual video timeline shortcuts. */
  hasSelectedVideoTrack?: boolean;
  /** v0.10.29 · 视频采样网格生效 (step>1)：←/→ 改为网格跳，Shift/Alt 重映射。
   *  step=1 (不采样) 时为 false，键位维持现状不变 (向后兼容)。 */
  samplingActive?: boolean;
}

// v0.10.5 M4-β · L/H/O 用于 shape 状态位切换（仅选中态消费；保留以防 setClassByLetter 抢键）。
const RESERVED_LETTERS = new Set(["v","V","b","B","w","W","p","P","s","S","a","A","d","D","e","E","f","F","n","N","u","U","j","J","k","K","c","C","l","L","h","H","o","O","m","M"]);

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
    if (ctx.videoMode && k === "m") return { type: "videoToggleBookmark" };
    if (ctx.videoMode && e.key === "[") return { type: "videoJumpHistory", dir: -1 };
    if (ctx.videoMode && e.key === "]") return { type: "videoJumpHistory", dir: 1 };
    if (k === "a") return { type: "selectAllUser" };
    if (k === "c") return { type: "copy" };
    if (k === "v") return { type: "paste" };
    if (k === "d") return { type: "duplicate" };
    // I12 · Ctrl+G group / Ctrl+Shift+G ungroup; 仅在有选中时消费
    if (k === "g" && ctx.hasSelection) {
      return e.shiftKey ? { type: "annotationUngroup" } : { type: "annotationGroup" };
    }
    return null;
  }

  if (ctx.videoMode) {
    if (ctx.pendingActive) {
      if (e.key === "Escape") return { type: "cancel" };
      return null;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.key === "1") return { type: "setVideoTool", tool: "box" };
      if (e.key === "2") return { type: "setVideoTool", tool: "track" };
      if (e.key === "l" || e.key === "L") return { type: "videoClearLoopRegion" };
      // v0.10.29 · 采样开启时 Alt+←/→ 承接「选中轨迹跳关键帧」(原 Shift 行为迁移至此)。
      if (ctx.samplingActive && ctx.hasSelectedVideoTrack) {
        if (e.key === "ArrowRight") return { type: "videoSeekKeyframe", dir: 1 };
        if (e.key === "ArrowLeft") return { type: "videoSeekKeyframe", dir: -1 };
      }
    }
    if (e.key === " ") return { type: "videoTogglePlayback" };
    if (e.key === "j" || e.key === "J") return { type: "videoJogPlayback", dir: -1 };
    if (e.key === "k" || e.key === "K") return { type: "videoPausePlayback" };
    if (e.key === "l" || e.key === "L") return { type: "videoJogPlayback", dir: 1 };
    if (e.key === "b" || e.key === "B") return { type: "setVideoTool", tool: "box" };
    if (e.key === "t" || e.key === "T") return { type: "setVideoTool", tool: "track" };
    // v0.10.29 · 采样开启 (step>1)：←/→ 网格跳；Shift+←/→ 与 ,/. 走 ±1 源帧微调 (逃生口)。
    //            采样关闭 (step=1)：维持现状键位 (向后兼容)。
    if (ctx.samplingActive) {
      if (e.key === "ArrowRight") {
        if (e.shiftKey) return { type: "videoMicroStep", dir: 1 };
        return { type: "videoSeekGrid", dir: 1 };
      }
      if (e.key === "ArrowLeft") {
        if (e.shiftKey) return { type: "videoMicroStep", dir: -1 };
        return { type: "videoSeekGrid", dir: -1 };
      }
      if (e.key === ".") return { type: "videoMicroStep", dir: 1 };
      if (e.key === ",") return { type: "videoMicroStep", dir: -1 };
    } else {
      if (e.key === "ArrowRight") {
        if (e.shiftKey && ctx.hasSelectedVideoTrack) return { type: "videoSeekKeyframe", dir: 1 };
        return { type: "videoSeek", delta: e.shiftKey ? 10 : 1 };
      }
      if (e.key === "ArrowLeft") {
        if (e.shiftKey && ctx.hasSelectedVideoTrack) return { type: "videoSeekKeyframe", dir: -1 };
        return { type: "videoSeek", delta: e.shiftKey ? -10 : -1 };
      }
      // v0.10.30 · 选中 track 时 ,/. 跳上/下关键帧 (对齐 CVAT); 否则 ±1 帧。
      if (e.key === ".") {
        return ctx.hasSelectedVideoTrack
          ? { type: "videoSeekKeyframe", dir: 1 }
          : { type: "videoSeek", delta: 1 };
      }
      if (e.key === ",") {
        return ctx.hasSelectedVideoTrack
          ? { type: "videoSeekKeyframe", dir: -1 }
          : { type: "videoSeek", delta: -1 };
      }
    }
    if (e.key === "Tab") return { type: "videoCycleTrack", dir: e.shiftKey ? -1 : 1 };
    if (e.key === "Escape") return { type: "cancel" };
    if (e.key === "Delete" || e.key === "Backspace") return { type: "videoDeleteSelected" };
    if (e.key >= "1" && e.key <= "9") {
      return { type: "setClassByDigit", idx: parseInt(e.key, 10) - 1 };
    }
    if (e.key === "?") return { type: "showHotkeys" };
    return null;
  }

  // v0.9.6 P2-b · Alt+1/2/3/4 备用切工具 (避免单数字键 1-9 切类别冲突).
  // 单按 1-9 仍切类别 (老用户肌肉记忆不变); Alt+digit 仅在画布无 input 聚焦时生效.
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    if (e.key === "1") return { type: "setTool", tool: "box" };
    if (e.key === "2") return { type: "setTool", tool: "polygon" };
    // v0.10.2 · Alt+3 进入 AI 工具组 (循环). 单按 S 同样进入循环.
    if (e.key === "3") return { type: "setTool", tool: "ai-cycle" };
    if (e.key === "4") return { type: "setTool", tool: "hand" };
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

  // v0.10.5 M4-β I15 · 有选中时 `[`/`]` 调 z_order（向下/向上）；无选中时维持原 threshold 行为。
  if (e.key === "[") {
    if (ctx.hasSelection) return { type: "bumpZOrder", delta: -1 };
    return { type: "thresholdAdjust", delta: -0.05 };
  }
  if (e.key === "]") {
    if (ctx.hasSelection) return { type: "bumpZOrder", delta: 1 };
    return { type: "thresholdAdjust", delta:  0.05 };
  }

  // v0.10.5 M4-β I15 · L/H/O 切换选中 shape 的 lock/hidden/occluded。仅在有选中时消费。
  if (ctx.hasSelection) {
    if (e.key === "l" || e.key === "L") return { type: "toggleShapeFlag", flag: "is_locked" };
    if (e.key === "h" || e.key === "H") return { type: "toggleShapeFlag", flag: "is_hidden" };
    if (e.key === "o" || e.key === "O") return { type: "toggleShapeFlag", flag: "is_occluded" };
  }
  // v0.10.28 · 无选中时 L → 折线工具（与上方 L=lock 互补：lock 仅选中态消费）。
  if ((e.key === "l" || e.key === "L") && !ctx.hasSelection) return { type: "setTool", tool: "polyline" };

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
  // v0.10.28 · W 单键直达旋转框 (OBB) 工具 (O 已被 occluded 占用)。
  if (e.key === "w" || e.key === "W") return { type: "setTool", tool: "rotated-box" };
  // v0.10.28 · F 单键直达关键点工具 (K 已被 cycleUser「上一个框」占用)。
  if (e.key === "f" || e.key === "F") return { type: "setTool", tool: "keypoint" };
  // v0.10.2 · S 循环 5 个 AI 工具 (具体下一个工具由消费侧根据 capabilities 决定).
  if (e.key === "s" || e.key === "S") return { type: "setTool", tool: "ai-cycle" };
  // v0.10.17 · G 单键直达 Magic Box.
  if (e.key === "g" || e.key === "G") return { type: "setTool", tool: "magic-box" };
  if (e.key === "p" || e.key === "P") return { type: "setTool", tool: "polygon" };
  // v0.10.8 · I11 · M 切 mask 工具。注意：mask 工具激活后 B/E 是模式切换 (capture 阶段 useEffect 抢键)，
  // 不会落到这里；这里 B 仍然返回 setTool("box")。
  if (e.key === "m" || e.key === "M") return { type: "setTool", tool: "mask" };

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

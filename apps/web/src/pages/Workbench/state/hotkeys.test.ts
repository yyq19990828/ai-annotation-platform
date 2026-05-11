import { describe, expect, it } from "vitest";
import { dispatchKey, type DispatchCtx, type HotkeyAction } from "./hotkeys";

const baseCtx: DispatchCtx = {
  isInputFocused: false,
  hasSelection: false,
  pendingActive: false,
};

// 鸭子类型：dispatchKey 只读 key / *Key 修饰键，构造一个兼容 shape 即可，
// 避免依赖 jsdom 等 DOM 环境。
type FakeEvent = Pick<KeyboardEventInit, "ctrlKey" | "metaKey" | "shiftKey" | "altKey"> & { key: string };

function dispatch(e: FakeEvent, ctx: Partial<DispatchCtx> = {}): HotkeyAction | null {
  return dispatchKey(e as unknown as KeyboardEvent, { ...baseCtx, ...ctx });
}

describe("dispatchKey · 修饰键", () => {
  it("Ctrl+Z → undo", () => {
    expect(dispatch({ key: "z", ctrlKey: true })).toEqual({ type: "undo" });
  });
  it("Ctrl+Shift+Z → redo", () => {
    expect(dispatch({ key: "z", ctrlKey: true, shiftKey: true })).toEqual({ type: "redo" });
  });
  it("Ctrl+Y → redo (备用)", () => {
    expect(dispatch({ key: "y", ctrlKey: true })).toEqual({ type: "redo" });
  });
  it("Ctrl+0 → fitReset", () => {
    expect(dispatch({ key: "0", ctrlKey: true })).toEqual({ type: "fitReset" });
  });
  it("Ctrl+ArrowRight → next task", () => {
    expect(dispatch({ key: "ArrowRight", ctrlKey: true })).toEqual({ type: "navigateTask", dir: "next" });
  });
  it("Ctrl+A → selectAllUser", () => {
    expect(dispatch({ key: "a", ctrlKey: true })).toEqual({ type: "selectAllUser" });
  });
  it("Ctrl+C / V / D → 剪贴板", () => {
    expect(dispatch({ key: "c", ctrlKey: true })).toEqual({ type: "copy" });
    expect(dispatch({ key: "v", ctrlKey: true })).toEqual({ type: "paste" });
    expect(dispatch({ key: "d", ctrlKey: true })).toEqual({ type: "duplicate" });
  });
  it("Meta key 等价于 Ctrl（Mac）", () => {
    expect(dispatch({ key: "z", metaKey: true })).toEqual({ type: "undo" });
  });
});

describe("dispatchKey · 单键", () => {
  it("B / V / P / S → setTool", () => {
    expect(dispatch({ key: "b" })).toEqual({ type: "setTool", tool: "box" });
    expect(dispatch({ key: "v" })).toEqual({ type: "setTool", tool: "hand" });
    expect(dispatch({ key: "p" })).toEqual({ type: "setTool", tool: "polygon" });
    expect(dispatch({ key: "s" })).toEqual({ type: "setTool", tool: "sam" });
    expect(dispatch({ key: "S" })).toEqual({ type: "setTool", tool: "sam" });
  });
  it("数字键 1-9 → setClassByDigit", () => {
    expect(dispatch({ key: "3" })).toEqual({ type: "setClassByDigit", idx: 2 });
    expect(dispatch({ key: "9" })).toEqual({ type: "setClassByDigit", idx: 8 });
  });
  it("Alt+1/2/3/4 → setTool (v0.9.6 P2-b 备用切工具)", () => {
    expect(dispatch({ key: "1", altKey: true })).toEqual({ type: "setTool", tool: "box" });
    expect(dispatch({ key: "2", altKey: true })).toEqual({ type: "setTool", tool: "sam" });
    expect(dispatch({ key: "3", altKey: true })).toEqual({ type: "setTool", tool: "polygon" });
    expect(dispatch({ key: "4", altKey: true })).toEqual({ type: "setTool", tool: "hand" });
  });
  it("Alt+5..9 不映射 (5-9 留给数字切类别 fallback)", () => {
    expect(dispatch({ key: "5", altKey: true })).toEqual({ type: "setClassByDigit", idx: 4 });
  });
  it("Alt 仅与单字组合生效 (Alt+Ctrl+1 走 ctrl 分支不动 setTool)", () => {
    expect(dispatch({ key: "1", altKey: true, ctrlKey: true })).toBeNull();
  });
  it("字母键（非保留）→ setClassByLetter", () => {
    expect(dispatch({ key: "f" })).toEqual({ type: "setClassByLetter", letter: "f" });
    expect(dispatch({ key: "z" })).toEqual({ type: "setClassByLetter", letter: "z" });
  });
  it("保留字母（v/b/a/d/e/n/u/j/k/c）走专用 action 而非 letter", () => {
    expect(dispatch({ key: "n" })).toEqual({ type: "smartNext", mode: "open" });
    expect(dispatch({ key: "u" })).toEqual({ type: "smartNext", mode: "uncertain" });
    expect(dispatch({ key: "e" })).toEqual({ type: "submit" });
  });
  it("Tab / Shift+Tab → cycleUser loop", () => {
    expect(dispatch({ key: "Tab" })).toEqual({ type: "cycleUser", dir: 1, loop: true });
    expect(dispatch({ key: "Tab", shiftKey: true })).toEqual({ type: "cycleUser", dir: -1, loop: true });
  });
  it("J / K → cycleUser 不循环", () => {
    expect(dispatch({ key: "j" })).toEqual({ type: "cycleUser", dir: 1, loop: false });
    expect(dispatch({ key: "k" })).toEqual({ type: "cycleUser", dir: -1, loop: false });
  });
  it("[ / ] → 阈值微调", () => {
    expect(dispatch({ key: "[" })).toEqual({ type: "thresholdAdjust", delta: -0.05 });
    expect(dispatch({ key: "]" })).toEqual({ type: "thresholdAdjust", delta: 0.05 });
  });
  it("Delete / Backspace → deleteSelected", () => {
    expect(dispatch({ key: "Delete" })).toEqual({ type: "deleteSelected" });
    expect(dispatch({ key: "Backspace" })).toEqual({ type: "deleteSelected" });
  });
  it("Space → spacePanOn", () => {
    expect(dispatch({ key: " " })).toEqual({ type: "spacePanOn" });
  });
  it("? → showHotkeys", () => {
    expect(dispatch({ key: "?" })).toEqual({ type: "showHotkeys" });
  });
  it("Esc → cancel", () => {
    expect(dispatch({ key: "Escape" })).toEqual({ type: "cancel" });
  });
});

describe("dispatchKey · 上下文相关", () => {
  it("input 聚焦时禁用所有 hotkey", () => {
    expect(dispatch({ key: "b" }, { isInputFocused: true })).toBeNull();
    expect(dispatch({ key: "z", ctrlKey: true }, { isInputFocused: true })).toBeNull();
  });

  it("popover 活跃时类别字母不消费", () => {
    expect(dispatch({ key: "f" }, { pendingActive: true })).toBeNull();
    // 但 Ctrl+Z 等系统级仍消费
    expect(dispatch({ key: "z", ctrlKey: true }, { pendingActive: true })).toEqual({ type: "undo" });
    // Esc 也仍消费
    expect(dispatch({ key: "Escape" }, { pendingActive: true })).toEqual({ type: "cancel" });
  });

  it("无选中时 a/d 不映射为 acceptAi/rejectAi", () => {
    expect(dispatch({ key: "a" }, { hasSelection: false })).toBeNull();
    expect(dispatch({ key: "d" }, { hasSelection: false })).toBeNull();
  });
  it("有选中时 a/d → acceptAi/rejectAi", () => {
    expect(dispatch({ key: "a" }, { hasSelection: true })).toEqual({ type: "acceptAi" });
    expect(dispatch({ key: "d" }, { hasSelection: true })).toEqual({ type: "rejectAi" });
  });

  it("有选中时 c → changeClass", () => {
    expect(dispatch({ key: "c" }, { hasSelection: true })).toEqual({ type: "changeClass" });
  });
  it("无选中时 c 不消费", () => {
    expect(dispatch({ key: "c" })).toBeNull();
  });

  it("方向键 nudge 仅在有选中时映射", () => {
    expect(dispatch({ key: "ArrowUp" })).toBeNull();
    expect(dispatch({ key: "ArrowUp" }, { hasSelection: true })).toEqual({ type: "arrowNudge", dx: 0, dy: -1 });
    expect(dispatch({ key: "ArrowRight" }, { hasSelection: true })).toEqual({ type: "arrowNudge", dx: 1, dy: 0 });
  });
  it("Shift + 方向键 → 10x 步长", () => {
    expect(dispatch({ key: "ArrowDown", shiftKey: true }, { hasSelection: true }))
      .toEqual({ type: "arrowNudge", dx: 0, dy: 10 });
  });
});

describe("dispatchKey · video mode", () => {
  const videoCtx: Partial<DispatchCtx> = { videoMode: true };

  it("Space → videoTogglePlayback", () => {
    expect(dispatch({ key: " " }, videoCtx)).toEqual({ type: "videoTogglePlayback" });
  });

  it("ArrowLeft / ArrowRight → videoSeek", () => {
    expect(dispatch({ key: "ArrowRight" }, videoCtx)).toEqual({ type: "videoSeek", delta: 1 });
    expect(dispatch({ key: "ArrowLeft" }, videoCtx)).toEqual({ type: "videoSeek", delta: -1 });
  });

  it(", / . → videoSeek as frame-step aliases", () => {
    expect(dispatch({ key: "." }, videoCtx)).toEqual({ type: "videoSeek", delta: 1 });
    expect(dispatch({ key: "," }, videoCtx)).toEqual({ type: "videoSeek", delta: -1 });
  });

  it("Shift + ArrowLeft / ArrowRight → videoSeek 10 frames", () => {
    expect(dispatch({ key: "ArrowRight", shiftKey: true }, videoCtx)).toEqual({ type: "videoSeek", delta: 10 });
    expect(dispatch({ key: "ArrowLeft", shiftKey: true }, videoCtx)).toEqual({ type: "videoSeek", delta: -10 });
  });

  it("Delete / Backspace → videoDeleteSelected", () => {
    expect(dispatch({ key: "Delete" }, videoCtx)).toEqual({ type: "videoDeleteSelected" });
    expect(dispatch({ key: "Backspace" }, videoCtx)).toEqual({ type: "videoDeleteSelected" });
  });

  it("Tab / Shift+Tab → videoCycleTrack", () => {
    expect(dispatch({ key: "Tab" }, videoCtx)).toEqual({ type: "videoCycleTrack", dir: 1 });
    expect(dispatch({ key: "Tab", shiftKey: true }, videoCtx)).toEqual({ type: "videoCycleTrack", dir: -1 });
  });

  it("Esc → cancel", () => {
    expect(dispatch({ key: "Escape" }, videoCtx)).toEqual({ type: "cancel" });
  });

  it("1-9 → setClassByDigit and image tool letters are disabled", () => {
    expect(dispatch({ key: "4" }, videoCtx)).toEqual({ type: "setClassByDigit", idx: 3 });
    expect(dispatch({ key: "b" }, videoCtx)).toBeNull();
    expect(dispatch({ key: "s" }, videoCtx)).toBeNull();
    expect(dispatch({ key: "p" }, videoCtx)).toBeNull();
  });
});

describe("dispatchKey · 属性 hotkey 绑定 (D.1)", () => {
  it("无选中按 1 → setClassByDigit (保留原行为)", () => {
    expect(dispatch({ key: "1" }, { hasSelection: false }))
      .toEqual({ type: "setClassByDigit", idx: 0 });
  });

  it("选中态 + boolean hotkey 命中 → setAttribute toggle", () => {
    const lookup = (digit: string) =>
      digit === "2" ? { key: "occluded", type: "boolean" as const, currentValue: false } : null;
    expect(dispatch({ key: "2" }, { hasSelection: true, attributeHotkey: lookup }))
      .toEqual({ type: "setAttribute", key: "occluded", value: true });
    // current=true 时 toggle 为 false
    const lookupTrue = (digit: string) =>
      digit === "2" ? { key: "occluded", type: "boolean" as const, currentValue: true } : null;
    expect(dispatch({ key: "2" }, { hasSelection: true, attributeHotkey: lookupTrue }))
      .toEqual({ type: "setAttribute", key: "occluded", value: false });
  });

  it("选中态 + select hotkey 命中 → setAttribute cycle", () => {
    const lookup = (digit: string) =>
      digit === "3"
        ? { key: "orientation", type: "select" as const, options: ["north", "south", "east", "west"], currentValue: "north" }
        : null;
    expect(dispatch({ key: "3" }, { hasSelection: true, attributeHotkey: lookup }))
      .toEqual({ type: "setAttribute", key: "orientation", value: "south" });
  });

  it("select cycle 至末尾绕回首项", () => {
    const lookup = (digit: string) =>
      digit === "3"
        ? { key: "orientation", type: "select" as const, options: ["a", "b", "c"], currentValue: "c" }
        : null;
    expect(dispatch({ key: "3" }, { hasSelection: true, attributeHotkey: lookup }))
      .toEqual({ type: "setAttribute", key: "orientation", value: "a" });
  });

  it("选中态但 hotkey 未命中 → fallback 到 setClassByDigit", () => {
    const lookup = () => null;
    expect(dispatch({ key: "1" }, { hasSelection: true, attributeHotkey: lookup }))
      .toEqual({ type: "setClassByDigit", idx: 0 });
  });
});

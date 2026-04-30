// Single source of truth for Workbench shortcuts.
// useEffect 注册和 HotkeyCheatSheet 都从这里读，避免漂移。

export type HotkeyGroup = "view" | "draw" | "ai" | "nav" | "system";

export interface HotkeyDef {
  keys: string[];        // display labels e.g. ["Ctrl", "Z"]
  desc: string;
  group: HotkeyGroup;
}

export const HOTKEYS: HotkeyDef[] = [
  { keys: ["B"], desc: "矩形框工具", group: "draw" },
  { keys: ["V"], desc: "平移工具", group: "draw" },
  { keys: ["1 — 9"], desc: "切换类别", group: "draw" },
  { keys: ["Delete"], desc: "删除选中框（多选时批量）", group: "draw" },
  { keys: ["Tab"], desc: "下一个 user 框（循环）", group: "draw" },
  { keys: ["Shift", "Tab"], desc: "上一个 user 框（循环）", group: "draw" },
  { keys: ["J"], desc: "下一个 user 框（不循环）", group: "draw" },
  { keys: ["K"], desc: "上一个 user 框（不循环）", group: "draw" },
  { keys: ["↑ ↓ ← →"], desc: "选中框 1px 平移（Shift = 10px）", group: "draw" },
  { keys: ["Shift", "click"], desc: "叠加多选 user 框", group: "draw" },
  { keys: ["Ctrl", "A"], desc: "全选当前帧 user 框", group: "draw" },
  { keys: ["Ctrl", "C"], desc: "复制选中框", group: "draw" },
  { keys: ["Ctrl", "V"], desc: "粘贴（偏移 +10px）", group: "draw" },
  { keys: ["Ctrl", "D"], desc: "原地复制（偏移 +10px）", group: "draw" },

  { keys: ["Ctrl", "Z"], desc: "撤销", group: "draw" },
  { keys: ["Ctrl", "Shift", "Z"], desc: "重做", group: "draw" },
  { keys: ["Ctrl", "Y"], desc: "重做（备用）", group: "draw" },

  { keys: ["Ctrl", "+ wheel"], desc: "以光标为锚点缩放", group: "view" },
  { keys: ["Ctrl", "0"], desc: "重置缩放与平移", group: "view" },
  { keys: ["Space", "+ drag"], desc: "平移画布", group: "view" },
  { keys: ["双击空白"], desc: "适应视口", group: "view" },

  { keys: ["A"], desc: "采纳选中 AI 框", group: "ai" },
  { keys: ["D"], desc: "驳回选中 AI 框", group: "ai" },
  { keys: ["["], desc: "降低置信度阈值 (-0.05)", group: "ai" },
  { keys: ["]"], desc: "提高置信度阈值 (+0.05)", group: "ai" },

  { keys: ["Ctrl", "→"], desc: "下一题", group: "nav" },
  { keys: ["Ctrl", "←"], desc: "上一题", group: "nav" },
  { keys: ["N"], desc: "智能切题：下一未标注", group: "nav" },
  { keys: ["U"], desc: "智能切题：下一最不确定", group: "nav" },
  { keys: ["E"], desc: "提交质检", group: "nav" },

  { keys: ["?"], desc: "打开本面板", group: "system" },
  { keys: ["Esc"], desc: "取消选择 / 关闭弹窗", group: "system" },
];

export const GROUP_LABEL: Record<HotkeyGroup, string> = {
  view: "视图",
  draw: "绘制",
  ai: "AI",
  nav: "导航",
  system: "系统",
};

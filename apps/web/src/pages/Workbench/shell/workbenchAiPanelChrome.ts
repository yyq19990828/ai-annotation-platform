// 工作台 AI 单题与视频 AI 追踪共用的浮层视觉骨架。
// 这里只收口表面、头部、图标与内容分区，定位和交互仍由各面板自行负责。
export const AI_PANEL_SURFACE_CLASS =
  "overflow-hidden rounded-lg border border-violet-500/35 bg-card shadow-xl";

export const AI_PANEL_HEADER_CLASS =
  "border-b border-border bg-gradient-to-b from-violet-500/10 to-transparent px-3.5 py-3";

export const AI_PANEL_ICON_CLASS =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-sm bg-violet-500/[0.18] text-status-info";

export const AI_PANEL_SECTION_CLASS =
  "border-b border-border bg-muted px-3.5 py-2.5";

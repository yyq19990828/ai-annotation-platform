import { Fragment, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { ALL_TOOLS, type CanvasTool, type ToolId } from "../stage/tools";
import type { VideoTool } from "../state/useWorkbenchState";

interface ToolDockProps {
  tool: ToolId;
  onSetTool: (t: ToolId) => void;
  videoTool?: VideoTool;
  onSetVideoTool?: (t: VideoTool) => void;
  /** v0.10.2 · 由 useMLCapabilities 注入. tool.requiredPrompt 不在 supported 集合 → 置灰. */
  isPromptSupported?: (type: string) => boolean;
  /** v0.10.2 · capability 加载中: AI 工具组半透 + 不可点 (避免误用回退到的 fallback). */
  capabilitiesLoading?: boolean;
  /**
   * v0.10.2 · AI 工具激活时由父层渲染的右侧抽屉 (AIToolDrawer).
   * ToolDock 自身不持有 schema/params 状态, 只负责定位.
   */
  aiToolDrawer?: ReactNode;
  /** M2 · review 模式下只显示 Hand 工具. */
  reviewMode?: boolean;
  /** v0.9.20 · 视频工作台分离单帧 bbox 与 track 工具. */
  videoMode?: boolean;
}

interface ToolDescriptor {
  desc: string;
  altDigit?: number;
}

/** v0.10.2 · Tooltip + Alt+digit 副 hotkey. */
const TOOL_DESCRIPTORS: Record<ToolId, ToolDescriptor> = {
  box: { desc: "拖鼠标画矩形框", altDigit: 1 },
  polygon: { desc: "逐点画多边形 (Enter 闭合)", altDigit: 2 },
  "smart-point": { desc: "单击 = 正向点；Alt+点 = 负向点", altDigit: 3 },
  "smart-box": { desc: "拖框作为 SAM 提示" },
  "text-prompt": { desc: "文本召回 (右侧 AI 面板输入)" },
  exemplar: { desc: "拖框示例 → 全图相似实例 (SAM 3)" },
  hand: { desc: "拖拽平移画布", altDigit: 4 },
  canvas: { desc: "评论批注 (内部, 不展示)" },
};

const VIDEO_TOOLS: Array<{ id: VideoTool; hotkey: string; label: string; icon: IconName; desc: string; altDigit: number }> = [
  { id: "box", hotkey: "B", label: "矩形框", icon: "rect", desc: "当前帧独立矩形框", altDigit: 1 },
  { id: "track", hotkey: "T", label: "轨迹", icon: "target", desc: "跨帧对象轨迹", altDigit: 2 },
];

/**
 * v0.10.2 · 左侧垂直工具栏 (Prompt-first 重构).
 *
 * 工具分组:
 *   普通绘制: box, polygon
 *   ─── 分隔 ───
 *   AI 工具 (按 prompt 范式): smart-point, smart-box, text-prompt, exemplar
 *     每个工具声明 requiredPrompt; backend 不支持时按钮置灰 + tooltip 提示.
 *     任一 AI 工具激活时, 其右侧抽屉显示 AIToolDrawer (后端 + 参数 + 工具控件).
 *   ─── 分隔 ───
 *   视图: hand
 */
export function ToolDock({
  tool,
  onSetTool,
  videoTool = "box",
  onSetVideoTool,
  isPromptSupported,
  capabilitiesLoading = false,
  aiToolDrawer,
  reviewMode = false,
  videoMode = false,
}: ToolDockProps) {
  if (videoMode) {
    return (
      <div
        style={{
          position: "relative",
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "10px 4px", gap: 6,
          background: "var(--color-bg-elev)",
          borderRight: "1px solid var(--color-border)",
        }}
      >
        {VIDEO_TOOLS.map((t) => {
          const active = videoTool === t.id;
          return (
            <Tooltip
              key={t.id}
              name={t.label}
              desc={`${t.desc} · 备用 Alt+${t.altDigit}`}
              hotkey={t.hotkey}
              side="right"
              delay={250}
            >
              <button
                type="button"
                onClick={() => onSetVideoTool?.(t.id)}
                aria-label={t.label}
                aria-pressed={active}
                data-testid={`video-tool-btn-${t.id}`}
                style={{
                  position: "relative",
                  width: 38, height: 38,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: active ? "var(--color-accent)" : "transparent",
                  color: active ? "white" : "var(--color-fg-muted)",
                  border: "1px solid " + (active ? "var(--color-accent)" : "transparent"),
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                }}
              >
                <Icon name={t.icon} size={17} />
                <span aria-hidden style={{ position: "absolute", right: 3, bottom: 1, fontSize: 8, fontWeight: 700, lineHeight: 1 }}>
                  {t.hotkey}
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  const visibleTools = reviewMode
    ? ALL_TOOLS.filter((t) => t.id === "hand")
    : ALL_TOOLS;

  // 分组分隔: 普通绘制 → AI 工具 → 视图工具
  const isAITool = (t: CanvasTool) => !!t.requiredPrompt;
  const groupOf = (t: CanvasTool): "draw" | "ai" | "view" =>
    t.id === "hand" ? "view" : isAITool(t) ? "ai" : "draw";

  return (
    <div
      style={{
        position: "relative",
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "10px 4px", gap: 6,
        background: "var(--color-bg-elev)",
        borderRight: "1px solid var(--color-border)",
      }}
    >
      {visibleTools.map((t, idx) => {
        const active = tool === t.id;
        const prevGroup = idx > 0 ? groupOf(visibleTools[idx - 1]) : null;
        const curGroup = groupOf(t);
        const showDivider = prevGroup !== null && prevGroup !== curGroup;
        const descriptor = TOOL_DESCRIPTORS[t.id];
        const desc = descriptor?.desc ?? "";
        const altDigit = descriptor?.altDigit;
        const tooltipDesc = altDigit ? `${desc} · 备用 Alt+${altDigit}` : desc;
        const requiredPrompt = t.requiredPrompt;
        const supported = requiredPrompt
          ? (isPromptSupported ? isPromptSupported(requiredPrompt) : true)
          : true;
        const disabled = requiredPrompt
          ? capabilitiesLoading || !supported
          : false;
        const disabledHint = requiredPrompt && !capabilitiesLoading && !supported
          ? "当前后端不支持此交互模式"
          : capabilitiesLoading && requiredPrompt
          ? "正在协商后端能力…"
          : null;
        return (
          <Fragment key={t.id}>
            {showDivider && (
              <div
                aria-hidden
                style={{
                  width: 24,
                  height: 1,
                  background: "var(--color-border-subtle, var(--color-border))",
                  margin: "2px 0",
                }}
              />
            )}
            <div style={{ position: "relative", display: "flex" }}>
              <Tooltip
                name={t.label}
                desc={disabledHint ?? tooltipDesc}
                hotkey={t.hotkey}
                side="right"
                delay={250}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (disabled) return;
                    onSetTool(t.id);
                  }}
                  aria-label={t.label}
                  aria-pressed={active}
                  aria-disabled={disabled || undefined}
                  data-testid={`tool-btn-${t.id}`}
                  disabled={disabled}
                  style={{
                    position: "relative",
                    width: 38, height: 38,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: active ? "var(--color-accent)" : "transparent",
                    color: active ? "white" : "var(--color-fg-muted)",
                    border: "1px solid " + (active ? "var(--color-accent)" : "transparent"),
                    borderRadius: "var(--radius-md)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.4 : 1,
                    transition: "background 0.12s, color 0.12s, opacity 0.12s",
                    boxShadow: active
                      ? "inset 2px 0 0 color-mix(in oklab, var(--color-accent) 70%, white), 0 2px 6px color-mix(in oklab, var(--color-accent) 45%, transparent)"
                      : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!active && !disabled) {
                      e.currentTarget.style.background = "var(--color-bg-hover)";
                      e.currentTarget.style.color = "var(--color-fg)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active && !disabled) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--color-fg-muted)";
                    }
                  }}
                >
                  <Icon name={t.icon as IconName} size={17} />
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      right: 3, bottom: 1,
                      fontSize: 8, fontWeight: 700, lineHeight: 1,
                      color: active
                        ? "color-mix(in oklab, white 80%, transparent)"
                        : "color-mix(in oklab, var(--color-fg-muted) 65%, transparent)",
                      pointerEvents: "none",
                    }}
                  >
                    {t.hotkey.toUpperCase()}
                  </span>
                </button>
              </Tooltip>
              {/* AIToolDrawer 在 AI 工具激活时挂在该按钮右侧 */}
              {active && isAITool(t) && aiToolDrawer && (
                <div
                  style={{
                    position: "absolute",
                    left: "100%",
                    top: -6,
                    marginLeft: 8,
                    zIndex: 5,
                  }}
                >
                  {aiToolDrawer}
                </div>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

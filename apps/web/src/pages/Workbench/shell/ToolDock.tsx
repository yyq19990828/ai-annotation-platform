import { Fragment } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { ALL_TOOLS, type ToolId } from "../stage/tools";
import type { SamPolarity, SamSubTool } from "../state/useWorkbenchState";
import { SamSubToolbar } from "./SamSubToolbar";

interface ToolDockProps {
  tool: ToolId;
  onSetTool: (t: ToolId) => void;
  /** v0.9.4 phase 2 · 仅 tool === "sam" 时浮出子工具栏. */
  samSubTool?: SamSubTool;
  onSetSamSubTool?: (sub: SamSubTool) => void;
  samPolarity?: SamPolarity;
  onSetSamPolarity?: (p: SamPolarity) => void;
}

interface ToolDescriptor {
  desc: string;
}

/** v0.9.6 P2-b · 主工具栏 Tooltip 描述 + Alt+digit 副 hotkey (避免与数字切类别冲突). */
const TOOL_DESCRIPTORS: Record<ToolId, ToolDescriptor & { altDigit?: number }> = {
  box: { desc: "拖鼠标画矩形框", altDigit: 1 },
  sam: { desc: "AI 智能分割：点 / 框 / 文本", altDigit: 2 },
  polygon: { desc: "逐点画多边形 (Enter 闭合)", altDigit: 3 },
  hand: { desc: "拖拽平移画布", altDigit: 4 },
  canvas: { desc: "评论批注 (内部, 不展示)" },
};

/**
 * 左侧垂直工具栏（v0.5.3）。
 *
 * v0.9.4 phase 2 · SAM 子工具栏拆分（点 / 框 / 文本）
 * v0.9.6 P2-b · UX 重构:
 *   - native title 替为 Tooltip 组件 (3 行: name + desc + hotkey 徽)
 *   - 主按钮右下加 hotkey 角标 (8px 字母, 不靠 hover 即可见)
 *   - 激活态加 inset 2px 左侧 accent 边条
 *   - 在 Polygon 与 Hand 之间插入 1px 分组分隔线 (操作工具 vs 视图工具)
 *   - SAM 子工具栏从主按钮下方迁出, 改为 SAM 主按钮右侧 absolute 抽屉 (SamSubToolbar.tsx)
 */
export function ToolDock({
  tool,
  onSetTool,
  samSubTool = "point",
  onSetSamSubTool,
  samPolarity = "positive",
  onSetSamPolarity,
}: ToolDockProps) {
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
      {ALL_TOOLS.map((t, idx) => {
        const active = tool === t.id;
        const isSamActive = t.id === "sam" && active;
        const descriptor = TOOL_DESCRIPTORS[t.id];
        const desc = descriptor?.desc ?? "";
        const altDigit = descriptor?.altDigit;
        const tooltipDesc = altDigit ? `${desc} · 备用 Alt+${altDigit}` : desc;
        // 在 Hand 之前 (即 Polygon 与 Hand 之间) 插入分组分隔
        const showDivider = t.id === "hand" && idx > 0;
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
              <Tooltip name={t.label} desc={tooltipDesc} hotkey={t.hotkey} side="right" delay={250}>
                <button
                  type="button"
                  onClick={() => onSetTool(t.id)}
                  aria-label={t.label}
                  aria-pressed={active}
                  data-testid={`tool-btn-${t.id}`}
                  style={{
                    position: "relative",
                    width: 38, height: 38,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: active ? "var(--color-accent)" : "transparent",
                    color: active ? "white" : "var(--color-fg-muted)",
                    border: "1px solid " + (active ? "var(--color-accent)" : "transparent"),
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    transition: "background 0.12s, color 0.12s, transform 0.08s, box-shadow 0.12s",
                    boxShadow: active
                      ? "inset 2px 0 0 color-mix(in oklab, var(--color-accent) 70%, white), 0 2px 6px color-mix(in oklab, var(--color-accent) 45%, transparent)"
                      : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "var(--color-bg-hover)";
                      e.currentTarget.style.color = "var(--color-fg)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
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
                      right: 3,
                      bottom: 1,
                      fontSize: 8,
                      fontWeight: 700,
                      lineHeight: 1,
                      color: active
                        ? "color-mix(in oklab, white 80%, transparent)"
                        : "color-mix(in oklab, var(--color-fg-muted) 65%, transparent)",
                      pointerEvents: "none",
                      letterSpacing: 0,
                    }}
                  >
                    {t.hotkey.toUpperCase()}
                  </span>
                </button>
              </Tooltip>
              {isSamActive && onSetSamSubTool && onSetSamPolarity && (
                <div
                  style={{
                    position: "absolute",
                    left: "100%",
                    top: -6,
                    marginLeft: 8,
                    zIndex: 5,
                  }}
                >
                  <SamSubToolbar
                    samSubTool={samSubTool}
                    onSetSamSubTool={onSetSamSubTool}
                    samPolarity={samPolarity}
                    onSetSamPolarity={onSetSamPolarity}
                  />
                </div>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

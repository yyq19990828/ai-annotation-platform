import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { TaskResponse } from "@/types";

interface TopbarProps {
  task: TaskResponse | undefined;
  taskIdx: number;
  taskTotal: number;
  aiRunning: boolean;
  isSubmitting: boolean;
  /** 当前置信度阈值（0~1）；变化时短暂浮出反馈，给 [ ] 盲调用。 */
  confThreshold?: number;
  onShowHotkeys: () => void;
  onRunAi: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: () => void;
  onSmartNextOpen?: () => void;
  onSmartNextUncertain?: () => void;
  /** 溢出菜单内嵌槽位（Phase 3 用于主题切换）。 */
  overflowSlot?: React.ReactNode;
}

/**
 * Topbar 三段（v0.5.3）：
 * - 左：标题 / 索引（task.display_id · file_name · n / total）
 * - 中：上一题 / 提交 / 下一题 / ⌄ 智能切题
 * - 右：阈值反馈浮 + AI 一键预标 + ⋯ 溢出菜单（? 帮助 + 主题 + ...）
 *
 * 工具切换 → ToolDock（左侧垂直）；撤销/重做/缩放/适应 → FloatingDock（画布右下）。
 */
export function Topbar({
  task, taskIdx, taskTotal, aiRunning, isSubmitting, confThreshold,
  onShowHotkeys, onRunAi, onPrev, onNext, onSubmit, onSmartNextOpen, onSmartNextUncertain,
  overflowSlot,
}: TopbarProps) {
  // 阈值变化时浮出 1.5s 数值反馈（[ ] 键盲调反馈）
  const [showThr, setShowThr] = useState(false);
  const lastThrRef = useRef<number | undefined>(confThreshold);
  useEffect(() => {
    if (confThreshold === undefined) return;
    if (lastThrRef.current === undefined) { lastThrRef.current = confThreshold; return; }
    if (Math.abs(confThreshold - lastThrRef.current) < 1e-6) return;
    lastThrRef.current = confThreshold;
    setShowThr(true);
    const t = setTimeout(() => setShowThr(false), 1500);
    return () => clearTimeout(t);
  }, [confThreshold]);

  // 智能切题菜单
  const [smartOpen, setSmartOpen] = useState(false);
  const smartRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!smartOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (smartRef.current && !smartRef.current.contains(e.target as Node)) setSmartOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [smartOpen]);

  // 溢出菜单
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!overflowOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) setOverflowOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [overflowOpen]);

  const indexLabel = taskTotal > 0 && taskIdx >= 0 ? `${taskIdx + 1} / ${taskTotal}` : "";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: 12,
        padding: "8px 14px",
        background: "var(--color-bg-elev)", borderBottom: "1px solid var(--color-border)",
        position: "relative",
      }}
    >
      {/* 左：标题段 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span
          className="mono"
          style={{
            fontSize: 12, color: "var(--color-fg-muted)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {task?.display_id ?? "—"} · {task?.file_name ?? "—"}
        </span>
        {indexLabel && (
          <span
            className="mono"
            style={{
              fontSize: 11, color: "var(--color-fg-subtle)",
              padding: "1px 6px",
              background: "var(--color-bg-sunken)",
              border: "1px solid var(--color-border)",
              borderRadius: 3,
              flexShrink: 0,
            }}
          >
            {indexLabel}
          </span>
        )}
      </div>

      {/* 中：任务导航 + 提交 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Button size="sm" onClick={onPrev}><Icon name="chevLeft" size={13} />上一</Button>
        <Button variant="primary" size="sm" onClick={onSubmit} disabled={isSubmitting}>
          <Icon name="check" size={13} />提交质检
        </Button>
        <Button size="sm" onClick={onNext}>下一<Icon name="chevRight" size={13} /></Button>

        {(onSmartNextOpen || onSmartNextUncertain) && (
          <div ref={smartRef} style={{ position: "relative" }}>
            <Button
              size="sm"
              onClick={() => setSmartOpen((v) => !v)}
              title="智能切题 (N / U)"
              style={{ padding: "0 6px" }}
            >
              <Icon name="sparkles" size={11} />
            </Button>
            {smartOpen && (
              <div
                style={{
                  position: "absolute", right: 0, top: "100%", marginTop: 4,
                  minWidth: 180, padding: 4,
                  background: "var(--color-bg-elev)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                  boxShadow: "var(--shadow-md)",
                  zIndex: 30,
                }}
              >
                {onSmartNextOpen && (
                  <button type="button" onClick={() => { setSmartOpen(false); onSmartNextOpen(); }} style={menuItemStyle}>
                    <span>下一未标注</span>
                    <span className="mono" style={kbdStyle}>N</span>
                  </button>
                )}
                {onSmartNextUncertain && (
                  <button type="button" onClick={() => { setSmartOpen(false); onSmartNextUncertain(); }} style={menuItemStyle}>
                    <span>下一最不确定</span>
                    <span className="mono" style={kbdStyle}>U</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 右：AI 主操作 + 溢出菜单 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end", position: "relative" }}>
        {showThr && confThreshold !== undefined && (
          <span
            className="mono"
            style={{
              position: "absolute", right: 50, top: -28,
              padding: "2px 8px", fontSize: 11,
              background: "var(--color-bg-elev)",
              border: "1px solid var(--color-border)",
              borderRadius: 3, color: "var(--color-fg-muted)",
              boxShadow: "var(--shadow-sm)",
              pointerEvents: "none",
            }}
          >
            阈值 {(confThreshold * 100).toFixed(0)}%
          </span>
        )}
        <Button variant="ai" size="sm" onClick={onRunAi} disabled={aiRunning}>
          <Icon name="sparkles" size={13} />{aiRunning ? "AI 推理中..." : "AI 一键预标"}
        </Button>

        <div ref={overflowRef} style={{ position: "relative" }}>
          <Button
            size="sm"
            onClick={() => setOverflowOpen((v) => !v)}
            title="更多"
            style={{ padding: "0 6px" }}
          >
            <Icon name="settings" size={12} />
          </Button>
          {overflowOpen && (
            <div
              style={{
                position: "absolute", right: 0, top: "100%", marginTop: 4,
                minWidth: 200, padding: 4,
                background: "var(--color-bg-elev)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                boxShadow: "var(--shadow-md)",
                zIndex: 30,
              }}
            >
              <button
                type="button"
                onClick={() => { setOverflowOpen(false); onShowHotkeys(); }}
                style={menuItemStyle}
              >
                <span>快捷键</span>
                <span className="mono" style={kbdStyle}>?</span>
              </button>
              {overflowSlot}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  width: "100%", padding: "6px 10px", fontSize: 12,
  background: "transparent", border: "none", borderRadius: 3,
  cursor: "pointer", color: "var(--color-fg)",
};

const kbdStyle: React.CSSProperties = {
  padding: "1px 5px",
  background: "var(--color-bg-sunken)",
  border: "1px solid var(--color-border)",
  borderBottomWidth: 2,
  borderRadius: 3,
  fontSize: 10.5,
  color: "var(--color-fg-muted)",
};

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { TaskResponse } from "@/types";
import type { Tool } from "../state/useWorkbenchState";

interface TopbarProps {
  task: TaskResponse | undefined;
  tool: Tool;
  scale: number;
  aiRunning: boolean;
  isSubmitting: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 当前置信度阈值（0~1）；变化时短暂浮出反馈，给 [ ] 盲调用。 */
  confThreshold?: number;
  onSetTool: (t: Tool) => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onShowHotkeys: () => void;
  onRunAi: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: () => void;
  /** 智能切题：N = 下一未标注；U = 下一不确定（按 prediction 平均 conf 升序）。 */
  onSmartNextOpen?: () => void;
  onSmartNextUncertain?: () => void;
}

export function Topbar({
  task, tool, scale, aiRunning, isSubmitting, canUndo, canRedo, confThreshold,
  onSetTool, onZoomOut, onZoomIn, onFit, onUndo, onRedo, onShowHotkeys,
  onRunAi, onPrev, onNext, onSubmit, onSmartNextOpen, onSmartNextUncertain,
}: TopbarProps) {
  const divider = <div style={{ width: 1, height: 20, background: "var(--color-border)", margin: "0 4px" }} />;

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

  // 智能切题菜单开关
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

  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", rowGap: 6,
        padding: "8px 14px",
        background: "var(--color-bg-elev)", borderBottom: "1px solid var(--color-border)",
      }}
    >
      {/* 视图 + 绘制 + 历史 */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", rowGap: 4 }}>
        <Button variant={tool === "hand" ? "primary" : "ghost"} size="sm" onClick={() => onSetTool("hand")} title="平移 (V)">
          <Icon name="move" size={13} />
        </Button>
        <Button variant={tool === "box" ? "primary" : "ghost"} size="sm" onClick={() => onSetTool("box")} title="画框 (B)">
          <Icon name="rect" size={13} />矩形框
        </Button>
        {divider}
        <Button variant="ghost" size="sm" onClick={onUndo} disabled={!canUndo} title="撤销 (Ctrl+Z)">
          <Icon name="chevLeft" size={13} />撤销
        </Button>
        <Button variant="ghost" size="sm" onClick={onRedo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)">
          重做<Icon name="chevRight" size={13} />
        </Button>
        {divider}
        <Button variant="ghost" size="sm" onClick={onZoomOut} title="缩小">
          <Icon name="zoomOut" size={13} />
        </Button>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--color-fg-muted)", minWidth: 42, textAlign: "center" }}>
          {Math.round(scale * 100)}%
        </span>
        <Button variant="ghost" size="sm" onClick={onZoomIn} title="放大">
          <Icon name="zoomIn" size={13} />
        </Button>
        <Button variant="ghost" size="sm" onClick={onFit} style={{ fontSize: 11 }} title="适应视口（双击空白）">适应</Button>
        <Button variant="ghost" size="sm" onClick={onShowHotkeys} title="快捷键 (?)" style={{ fontSize: 11 }}>?</Button>
      </div>
      <span className="mono" style={{ fontSize: 12, color: "var(--color-fg-muted)", flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {task?.display_id} · {task?.file_name}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", position: "relative" }}>
        {showThr && confThreshold !== undefined && (
          <span
            style={{
              position: "absolute", right: 0, top: -28,
              padding: "2px 8px", fontSize: 11,
              background: "var(--color-bg-elev)",
              border: "1px solid var(--color-border)",
              borderRadius: 3, color: "var(--color-fg-muted)",
              boxShadow: "var(--shadow-sm)",
              pointerEvents: "none",
            }}
            className="mono"
          >
            阈值 {(confThreshold * 100).toFixed(0)}%
          </span>
        )}
        <Button variant="ai" size="sm" onClick={onRunAi} disabled={aiRunning}>
          <Icon name="sparkles" size={13} />{aiRunning ? "AI 推理中..." : "AI 一键预标"}
        </Button>
        {divider}
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
                  <button
                    type="button"
                    onClick={() => { setSmartOpen(false); onSmartNextOpen(); }}
                    style={smartItemStyle}
                  >
                    <span>下一未标注</span>
                    <span className="mono" style={kbdStyle}>N</span>
                  </button>
                )}
                {onSmartNextUncertain && (
                  <button
                    type="button"
                    onClick={() => { setSmartOpen(false); onSmartNextUncertain(); }}
                    style={smartItemStyle}
                  >
                    <span>下一最不确定</span>
                    <span className="mono" style={kbdStyle}>U</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const smartItemStyle: React.CSSProperties = {
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

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
}

export function Topbar({
  task, tool, scale, aiRunning, isSubmitting, canUndo, canRedo,
  onSetTool, onZoomOut, onZoomIn, onFit, onUndo, onRedo, onShowHotkeys,
  onRunAi, onPrev, onNext, onSubmit,
}: TopbarProps) {
  const divider = <div style={{ width: 1, height: 20, background: "var(--color-border)", margin: "0 4px" }} />;
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
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Button variant="ai" size="sm" onClick={onRunAi} disabled={aiRunning}>
          <Icon name="sparkles" size={13} />{aiRunning ? "AI 推理中..." : "AI 一键预标"}
        </Button>
        {divider}
        <Button size="sm" onClick={onPrev}><Icon name="chevLeft" size={13} />上一</Button>
        <Button variant="primary" size="sm" onClick={onSubmit} disabled={isSubmitting}>
          <Icon name="check" size={13} />提交质检
        </Button>
        <Button size="sm" onClick={onNext}>下一<Icon name="chevRight" size={13} /></Button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { DropdownMenu, type DropdownItem } from "@/components/ui/DropdownMenu";
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
  /** v0.6.5 状态机：审核中可撤回 / 已通过可重开。 */
  canWithdraw?: boolean;
  canReopen?: boolean;
  isWithdrawing?: boolean;
  isReopening?: boolean;
  onWithdraw?: () => void;
  onReopen?: () => void;
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
  canWithdraw = false, canReopen = false, isWithdrawing = false, isReopening = false,
  onWithdraw, onReopen,
}: TopbarProps) {
  const status = task?.status;
  const isReview = status === "review";
  const isCompleted = status === "completed";
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

  const indexLabel = taskTotal > 0 && taskIdx >= 0 ? `${taskIdx + 1} / ${taskTotal}` : "";

  const smartItems: DropdownItem[] = [];
  if (onSmartNextOpen) smartItems.push({ id: "next-open", label: "下一未标注", kbd: "N", onSelect: onSmartNextOpen });
  if (onSmartNextUncertain) smartItems.push({ id: "next-uncertain", label: "下一最不确定", kbd: "U", onSelect: onSmartNextUncertain });

  const overflowItems: DropdownItem[] = [
    { id: "hotkeys", label: "快捷键", kbd: "?", onSelect: onShowHotkeys },
  ];

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

      {/* 中：任务导航 + 状态相关主操作 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Button size="sm" onClick={onPrev}><Icon name="chevLeft" size={13} />上一</Button>
        {isReview ? (
          <Button
            variant="primary"
            size="sm"
            onClick={onWithdraw}
            disabled={!canWithdraw || isWithdrawing || !onWithdraw}
            title={canWithdraw ? "撤回提交，回到编辑态" : "审核员已介入，无法撤回"}
          >
            <Icon name="chevLeft" size={13} />撤回提交
          </Button>
        ) : isCompleted ? (
          <Button
            variant="primary"
            size="sm"
            onClick={onReopen}
            disabled={!canReopen || isReopening || !onReopen}
            title="重开任务，回到编辑态"
          >
            <Icon name="edit" size={13} />继续编辑
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={onSubmit} disabled={isSubmitting}>
            <Icon name="check" size={13} />提交质检
          </Button>
        )}
        <Button size="sm" onClick={onNext}>下一<Icon name="chevRight" size={13} /></Button>

        {smartItems.length > 0 && (
          <DropdownMenu
            items={smartItems}
            trigger={({ toggle, ref, open }) => (
              <Button
                ref={ref}
                size="sm"
                onClick={toggle}
                title="智能切题 (N / U)"
                style={{ padding: "0 6px", background: open ? "var(--color-bg-sunken)" : undefined }}
              >
                <Icon name="sparkles" size={11} />
              </Button>
            )}
          />
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

        <DropdownMenu
          minWidth={200}
          items={overflowItems}
          footer={overflowSlot ? <div style={{ padding: "4px 0 0" }}>{overflowSlot}</div> : null}
          trigger={({ toggle, ref, open }) => (
            <Button
              ref={ref}
              size="sm"
              onClick={toggle}
              title="更多"
              style={{ padding: "0 6px", background: open ? "var(--color-bg-sunken)" : undefined }}
            >
              <Icon name="settings" size={12} />
            </Button>
          )}
        />
      </div>
    </div>
  );
}


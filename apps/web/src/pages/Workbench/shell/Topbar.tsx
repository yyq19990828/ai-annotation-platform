import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { DropdownMenu, type DropdownItem } from "@/components/ui/DropdownMenu";
import { AssigneeAvatarStack } from "@/components/ui/AssigneeAvatarStack";
import { SkipTaskModal, type SkipReason } from "./SkipTaskModal";
import { BatchStatusBadge } from "@/components/badges/BatchStatusBadge";
import type { TaskResponse } from "@/types";

interface TopbarProps {
  task: TaskResponse | undefined;
  taskIdx: number;
  taskTotal: number;
  aiRunning: boolean;
  /** v0.9.6 · 当前任务所属批次状态;pre_annotated 时显示「AI 预标已就绪」紫徽章. */
  batchStatus?: string;
  isSubmitting: boolean;
  /** 当前置信度阈值（0~1）；变化时短暂浮出反馈，给 [ ] 盲调用。 */
  confThreshold?: number;
  onShowHotkeys: () => void;
  onRunAi: () => void;
  aiDisabled?: boolean;
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
  // v0.8.7 F7 · 任务跳过；缺省时不渲染按钮
  isSkipping?: boolean;
  onSkip?: (reason: SkipReason, note?: string) => void;
  /** M2 · review 模式专属操作 */
  mode?: "annotate" | "review";
  onApprove?: () => void;
  onReject?: () => void;
  isApproving?: boolean;
  isRejecting?: boolean;
  /** M2 · review 模式下 Topbar 左侧附加插槽（ReviewerMiniPanel chip） */
  reviewInfoSlot?: React.ReactNode;
}

/**
 * Topbar 三段（v0.5.3）：
 * - 左：标题 / 索引（task.display_id · file_name · n / total）
 * - 中：上一题 / 提交 / 下一题 / ⌄ 智能切题
 * - 右：阈值反馈浮 + AI + ⋯ 溢出菜单（? 帮助 + 主题 + ...）
 *
 * 工具切换 → ToolDock（左侧垂直）；撤销/重做/缩放/适应 → FloatingDock（画布右下）。
 */
export function Topbar({
  task, taskIdx, taskTotal, aiRunning, batchStatus, isSubmitting, confThreshold,
  onShowHotkeys, onRunAi, aiDisabled = false, onPrev, onNext, onSubmit, onSmartNextOpen, onSmartNextUncertain,
  overflowSlot,
  canWithdraw = false, canReopen = false, isWithdrawing = false, isReopening = false,
  onWithdraw, onReopen,
  isSkipping = false, onSkip,
  mode = "annotate", onApprove, onReject, isApproving = false, isRejecting = false,
  reviewInfoSlot,
}: TopbarProps) {
  // v0.8.7 F7 · 跳过任务 modal 状态
  const [skipOpen, setSkipOpen] = useState(false);
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
        padding: "10px 16px",
        background: "var(--color-bg-elev)", borderBottom: "1px solid var(--color-border)",
        position: "relative",
      }}
    >
      {/* 左：标题段 — display_id 主、文件名次、索引徽章右贴 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span
          className="mono"
          style={{
            fontSize: 13, fontWeight: 600, color: "var(--color-fg)",
            flexShrink: 0,
          }}
        >
          {task?.display_id ?? "—"}
        </span>
        <span
          style={{
            fontSize: 12.5, color: "var(--color-fg-muted)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            minWidth: 0,
          }}
          title={task?.file_name ?? undefined}
        >
          {task?.file_name ?? "—"}
        </span>
        {indexLabel && (
          <span
            className="mono"
            style={{
              fontSize: 11, fontWeight: 500, color: "var(--color-fg-muted)",
              padding: "2px 8px",
              background: "var(--color-bg-sunken)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-pill)",
              flexShrink: 0,
              letterSpacing: 0.2,
            }}
          >
            {indexLabel}
          </span>
        )}
        {/* v0.9.6 · 仅 pre_annotated 时显示徽章, 标注员一眼知道「先看 AI 候选」 */}
        {batchStatus === "pre_annotated" && (
          <BatchStatusBadge status="pre_annotated" />
        )}
        {/* v0.7.2 · 责任人胶囊：标注员 / 审核员（list_tasks/get_task 已 populate） */}
        {(task?.assignee || task?.reviewer) && (
          <span style={{ width: 1, height: 16, background: "var(--color-border)", flexShrink: 0 }} />
        )}
        {task?.assignee && (
          <AssigneeAvatarStack users={[task.assignee]} label="标注" max={1} />
        )}
        {task?.reviewer && (
          <AssigneeAvatarStack users={[task.reviewer]} label="审核" max={1} />
        )}
      </div>

      {/* 中：任务导航 + 状态相关主操作 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Button size="sm" onClick={onPrev}><Icon name="chevLeft" size={13} />上一</Button>
        {mode === "review" ? (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={onApprove}
              disabled={isApproving || !onApprove}
              data-testid="review-approve"
              title="通过 (A)"
            >
              <Icon name="check" size={13} />通过
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={onReject}
              disabled={isRejecting || !onReject}
              data-testid="review-reject"
              title="退回 (R)"
            >
              <Icon name="x" size={12} />退回
            </Button>
          </>
        ) : isReview ? (
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
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={onSubmit}
              disabled={isSubmitting}
              data-testid="workbench-submit"
            >
              <Icon name="check" size={13} />提交质检
            </Button>
            {onSkip && (
              <Button
                size="sm"
                onClick={() => setSkipOpen(true)}
                disabled={isSkipping || isSubmitting}
                title="图像损坏 / 无目标 / 不清晰时跳过本题"
                data-testid="workbench-skip"
              >
                <Icon name="x" size={12} />跳过
              </Button>
            )}
          </>
        )}
        <Button size="sm" onClick={onNext}>下一<Icon name="chevRight" size={13} /></Button>

        {smartItems.length > 0 && (
          <DropdownMenu
            items={smartItems}
            trigger={({ toggle, ref, open }) => (
              <Button
                ref={ref}
                variant="ghost"
                size="sm"
                onClick={toggle}
                title="智能切题 (N / U)"
                style={{
                  padding: "4px 6px", marginLeft: 2,
                  background: open ? "var(--color-bg-hover)" : undefined,
                  color: "var(--color-fg-muted)",
                }}
              >
                <Icon name="wandSparkles" size={13} />
              </Button>
            )}
          />
        )}
      </div>

      {/* 右：AI 主操作（annotate）或 ReviewerMini chip（review）+ 溢出菜单 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", position: "relative" }}>
        {reviewInfoSlot}
        {showThr && confThreshold !== undefined && (
          <span
            className="mono"
            style={{
              position: "absolute", right: 0, top: "calc(100% + 6px)",
              padding: "4px 10px", fontSize: 11.5, fontWeight: 500,
              background: "var(--color-ai-soft)",
              border: "1px solid color-mix(in oklab, var(--color-ai) 35%, transparent)",
              borderRadius: "var(--radius-pill)",
              color: "var(--color-ai)",
              boxShadow: "var(--shadow-md)",
              pointerEvents: "none",
              zIndex: 20,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-ai)" }} />
            阈值 {(confThreshold * 100).toFixed(0)}%
          </span>
        )}
        {mode === "annotate" && (
          <Button
            variant="ai"
            size="sm"
            onClick={onRunAi}
            disabled={aiDisabled}
            title={aiDisabled ? "视频任务暂不支持 AI" : "打开 AI 面板"}
          >
            {aiRunning
              ? <Icon name="loader2" size={13} className="spin" />
              : <Icon name="wandSparkles" size={13} />}
            AI
          </Button>
        )}

        <DropdownMenu
          minWidth={200}
          items={overflowItems}
          footer={overflowSlot ? <div style={{ padding: "4px 0 0" }}>{overflowSlot}</div> : null}
          trigger={({ toggle, ref, open }) => (
            <Button
              ref={ref}
              variant="ghost"
              size="sm"
              onClick={toggle}
              title="更多"
              style={{
                padding: "4px 6px",
                background: open ? "var(--color-bg-hover)" : undefined,
                color: "var(--color-fg-muted)",
              }}
            >
              <Icon name="settings" size={14} />
            </Button>
          )}
        />
      </div>
      {onSkip && (
        <SkipTaskModal
          open={skipOpen}
          isSubmitting={isSkipping}
          onClose={() => setSkipOpen(false)}
          onConfirm={(reason, note) => {
            setSkipOpen(false);
            onSkip(reason, note);
          }}
        />
      )}
    </div>
  );
}

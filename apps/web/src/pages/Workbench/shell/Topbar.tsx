import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { DropdownMenu, type DropdownItem } from "@/components/ui/DropdownMenu";
import { AssigneeAvatarStack } from "@/components/ui/AssigneeAvatarStack";
import { SkipTaskModal, type SkipReason } from "./SkipTaskModal";
import { BatchStatusBadge } from "@/components/badges/BatchStatusBadge";
import { useTheme } from "@/hooks/useTheme";
import type { TaskResponse } from "@/types";
import type { VideoSegment } from "@/api/videoTracker";

interface TopbarProps {
  /** 项目名 + 展示 ID（如 P-0001）；显示在左侧 task id 前作为项目上下文。 */
  projectName: string;
  projectDisplayId: string;
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
  onBack?: () => void;
  leftSidebarOpen?: boolean;
  rightSidebarOpen?: boolean;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  onRunAi: () => void;
  aiOpen?: boolean;
  aiDisabled?: boolean;
  /** 视频任务的画布级 AI 追踪入口；与 AI 单题面板互斥。 */
  onToggleTracker?: () => void;
  trackerOpen?: boolean;
  trackerRunning?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: () => void;
  onSmartNextOpen?: () => void;
  onSmartNextUncertain?: () => void;
  /** v0.15.3 · 齿轮图标直接打开设置抽屉;缺省不渲染该项。 */
  onOpenWorkbenchSettings?: () => void;
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
  videoSegments?: VideoSegment[];
  activeVideoSegmentId?: string | null;
  onSelectVideoSegment?: (segmentId: string | null) => void;
  submitLabel?: string;
}

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

/**
 * Topbar 三段（v0.5.3）：
 * - 左：标题 / 索引（task.display_id · file_name · n / total）
 * - 中：上一题 / 提交 / 下一题 / ⌄ 智能切题
 * - 右：阈值反馈浮 + AI + 主题 + ⋯ 溢出菜单（? 帮助 + 设置）
 *
 * 工具切换 → ToolDock（左侧垂直）；撤销/重做/缩放/适应 → FloatingDock（画布右下）。
 */
export function Topbar({
  projectName,
  projectDisplayId,
  task,
  taskIdx,
  taskTotal,
  aiRunning,
  batchStatus,
  isSubmitting,
  confThreshold,
  onShowHotkeys,
  onBack,
  leftSidebarOpen,
  rightSidebarOpen,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  onRunAi,
  aiOpen = false,
  aiDisabled = false,
  onToggleTracker,
  trackerOpen = false,
  trackerRunning = false,
  onPrev,
  onNext,
  onSubmit,
  onSmartNextOpen,
  onSmartNextUncertain,
  onOpenWorkbenchSettings,
  canWithdraw = false,
  canReopen = false,
  isWithdrawing = false,
  isReopening = false,
  onWithdraw,
  onReopen,
  isSkipping = false,
  onSkip,
  mode = "annotate",
  onApprove,
  onReject,
  isApproving = false,
  isRejecting = false,
  reviewInfoSlot,
  videoSegments,
  activeVideoSegmentId,
  onSelectVideoSegment,
  submitLabel = "提交质检",
}: TopbarProps) {
  const { resolved, setTheme } = useTheme();
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
    if (lastThrRef.current === undefined) {
      lastThrRef.current = confThreshold;
      return;
    }
    if (Math.abs(confThreshold - lastThrRef.current) < 1e-6) return;
    lastThrRef.current = confThreshold;
    setShowThr(true);
    const t = setTimeout(() => setShowThr(false), 1500);
    return () => clearTimeout(t);
  }, [confThreshold]);

  const indexLabel = taskTotal > 0 && taskIdx >= 0 ? `${taskIdx + 1} / ${taskTotal}` : "";

  const smartItems: DropdownItem[] = [];
  if (onSmartNextOpen)
    smartItems.push({ id: "next-open", label: "下一未标注", kbd: "N", onSelect: onSmartNextOpen });
  if (onSmartNextUncertain)
    smartItems.push({
      id: "next-uncertain",
      label: "下一最不确定",
      kbd: "U",
      onSelect: onSmartNextUncertain,
    });

  const nextTheme = resolved === "dark" ? "light" : "dark";
  const themeIcon: IconName = nextTheme === "dark" ? "moon" : "sun";
  const themeActionLabel = nextTheme === "dark" ? "切到夜间" : "切到日间";
  const themeTitle = `当前${resolved === "dark" ? "夜间" : "日间"}，${themeActionLabel}`;

  return (
    <div className="relative grid grid-cols-[1fr_auto_1fr] gap-3 items-center px-4 py-2.5 bg-card border-b border-border">
      {/* 左：标题段 — display_id 主、文件名次、索引徽章右贴 */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex shrink-0 items-center gap-0.5">
          {onBack && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="px-2 py-1 text-muted-foreground"
            >
              <Icon name="chevLeft" size={13} />
              返回
            </Button>
          )}
          {onToggleLeftSidebar && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleLeftSidebar}
              title={leftSidebarOpen ? "收起任务列表" : "展开任务列表"}
              className={cn(
                "justify-center w-7 h-7 p-0 border-transparent rounded-[var(--radius-sm)] bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                leftSidebarOpen && "text-foreground bg-transparent shadow-none",
              )}
            >
              <Icon name="panelLeft" size={14} />
            </Button>
          )}
        </div>
        <span className="shrink-0 w-px h-[18px] bg-border" />
        <span
          className="flex-auto min-w-0 overflow-hidden text-sm font-semibold text-foreground truncate"
          title={projectName}
        >
          {projectName}
        </span>
      </div>

      {/* 中：任务标识 + 任务导航 + 状态相关主操作（整体居中） */}
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="mono shrink-0 text-xs text-muted-foreground">{projectDisplayId}</span>
          <span className="shrink-0 w-px h-4 bg-border" />
          <span className="mono shrink-0 text-sm font-semibold text-foreground">
            {task?.display_id ?? "—"}
          </span>
          <span
            className="min-w-0 max-w-[220px] overflow-hidden text-sm text-muted-foreground truncate"
            title={task?.file_name ?? undefined}
          >
            {task?.file_name ?? "—"}
          </span>
          {indexLabel && (
            <span className="mono shrink-0 px-2 py-0.5 text-xs font-medium text-muted-foreground tracking-[0.2px] bg-muted border border-border rounded-full">
              {indexLabel}
            </span>
          )}
          {/* v0.9.6 · 仅 pre_annotated 时显示徽章, 标注员一眼知道「先看 AI 候选」 */}
          {batchStatus === "pre_annotated" && <BatchStatusBadge status="pre_annotated" />}
          {/* v0.7.2 · 责任人胶囊：标注员 / 审核员（list_tasks/get_task 已 populate） */}
          {(task?.assignee || task?.reviewer) && <span className="shrink-0 w-px h-4 bg-border" />}
          {task?.assignee && <AssigneeAvatarStack users={[task.assignee]} label="标注" max={1} />}
          {task?.reviewer && <AssigneeAvatarStack users={[task.reviewer]} label="审核" max={1} />}
          {videoSegments && onSelectVideoSegment && (
            <select
              aria-label="当前视频分段"
              value={activeVideoSegmentId ?? ""}
              onChange={(event) => onSelectVideoSegment(event.target.value || null)}
              className="h-7 min-w-32 rounded border border-border bg-card px-2 text-xs text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">选择分段</option>
              {videoSegments.map((segment) => (
                <option
                  key={segment.id}
                  value={segment.id}
                  disabled={segment.status === "completed"}
                >
                  S{segment.segment_index + 1} · {segment.start_frame}-{segment.end_frame} ·{" "}
                  {segment.status}
                  {segment.assignee_id ? ` · ${segment.assignee_id.slice(0, 8)}` : " · 未分配"}
                </option>
              ))}
            </select>
          )}
        </div>
        <span className="shrink-0 w-px h-4 bg-border" />
        <Button size="sm" onClick={onPrev}>
          <Icon name="chevLeft" size={13} />
          上一
        </Button>
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
              <Icon name="check" size={13} />
              通过
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={onReject}
              disabled={isRejecting || !onReject}
              data-testid="review-reject"
              title="退回 (R)"
            >
              <Icon name="x" size={12} />
              退回
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
            <Icon name="chevLeft" size={13} />
            撤回提交
          </Button>
        ) : isCompleted ? (
          <Button
            variant="primary"
            size="sm"
            onClick={onReopen}
            disabled={!canReopen || isReopening || !onReopen}
            title="重开任务，回到编辑态"
          >
            <Icon name="edit" size={13} />
            继续编辑
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
              <Icon name="check" size={13} />
              {submitLabel}
            </Button>
            {onSkip && (
              <Button
                size="sm"
                onClick={() => setSkipOpen(true)}
                disabled={isSkipping || isSubmitting}
                title="图像损坏 / 无目标 / 不清晰时跳过本题"
                data-testid="workbench-skip"
              >
                <Icon name="x" size={12} />
                跳过
              </Button>
            )}
          </>
        )}
        <Button size="sm" onClick={onNext}>
          下一
          <Icon name="chevRight" size={13} />
        </Button>

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
                className={cn("px-1 py-1 text-muted-foreground ml-0.5", open && "bg-muted")}
              >
                <Icon name="wandSparkles" size={13} />
              </Button>
            )}
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onShowHotkeys}
          title="快捷键 (?)"
          className="mono px-1 py-1 text-muted-foreground"
        >
          ?
        </Button>
      </div>

      {/* 右：AI 主操作（annotate）或 ReviewerMini chip（review）+ 溢出菜单 */}
      <div className="relative flex items-center justify-end gap-1.5">
        {reviewInfoSlot}
        {showThr && confThreshold !== undefined && (
          <span className="mono absolute top-[calc(100%+6px)] right-0 z-local-overlay inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-status-info pointer-events-none bg-status-info-soft border border-violet-500/30 rounded-full shadow-md">
            <span className="w-1.5 h-1.5 bg-violet-600 dark:bg-violet-400 rounded-full" />
            阈值 {(confThreshold * 100).toFixed(0)}%
          </span>
        )}
        {mode === "annotate" && (
          <>
            {onToggleTracker && (
              <Button
                variant="ai"
                size="sm"
                onClick={onToggleTracker}
                aria-label="发现新目标"
                aria-pressed={trackerOpen}
                title={
                  trackerOpen ? "关闭画布级多目标追踪" : "发现或播种多个新目标，不延展当前选中轨迹"
                }
                className="h-7 px-3"
                data-testid="workbench-ai-tracker"
              >
                {trackerRunning ? (
                  <Icon
                    name="loader2"
                    size={13}
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <Icon name="bot" size={13} />
                )}
                发现目标
              </Button>
            )}
            <Button
              variant="ai"
              size="sm"
              onClick={onRunAi}
              aria-label="AI 单题"
              aria-pressed={aiOpen}
              disabled={aiDisabled}
              title={
                aiDisabled
                  ? "视频任务暂不支持 AI"
                  : aiOpen
                    ? "关闭 AI 单题面板"
                    : "打开 AI 单题面板"
              }
              className="h-7 px-3"
              data-testid="workbench-ai-single"
            >
              {aiRunning ? (
                <Icon
                  name="loader2"
                  size={13}
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Icon name="wandSparkles" size={13} />
              )}
              AI
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTheme(nextTheme)}
          title={themeTitle}
          aria-label={themeTitle}
          className="justify-center w-7 h-7 p-0 text-muted-foreground bg-transparent border-transparent rounded-[var(--radius-sm)] shadow-none hover:text-foreground hover:bg-muted"
        >
          <Icon name={themeIcon} size={14} />
        </Button>

        {onOpenWorkbenchSettings && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenWorkbenchSettings}
            title="工作台设置"
            aria-label="工作台设置"
            className="justify-center w-7 h-7 p-0 text-muted-foreground bg-transparent border-transparent rounded-[var(--radius-sm)] shadow-none hover:text-foreground hover:bg-muted"
          >
            <Icon name="settings" size={14} />
          </Button>
        )}
        {onToggleRightSidebar && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleRightSidebar}
            title={rightSidebarOpen ? "收起标注详情" : "展开标注详情"}
            className={cn(
              "justify-center w-7 h-7 p-0 border-transparent rounded-[var(--radius-sm)] bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
              rightSidebarOpen && "text-foreground bg-transparent shadow-none",
            )}
          >
            <Icon name="panelRight" size={14} />
          </Button>
        )}
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

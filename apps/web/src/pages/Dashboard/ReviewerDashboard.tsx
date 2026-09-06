import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { SectionDivider } from "@/components/ui/SectionDivider";
import { AssigneeAvatarStack } from "@/components/ui/AssigneeAvatarStack";
import { useLocation, useNavigate } from "react-router-dom";
import { useToastStore } from "@/components/ui/Toast";
import { useReviewerStats, useMyRecentReviews } from "@/hooks/useDashboard";
import { useApproveTask, useRejectTask } from "@/hooks/useTasks";
import { useQueryClient } from "@tanstack/react-query";
import type { ReviewTaskItem, RecentReviewItem } from "@/api/dashboard";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";
import { RejectReasonModal } from "@/pages/Review/RejectReasonModal";
import { PageContainer } from "@/components/layout/PageContainer";

const CARD_TITLE = "m-0 text-sm font-semibold";
const CARD_HEADER_PLAIN = "border-b border-border px-4 py-3.5";
const TITLE_BADGE = "ml-2 [&_span]:text-xs";
const ROW_META = "mt-0.5 text-xs text-muted-foreground";
const ROW_TITLE_LINE = "flex items-center gap-2";
const TASK_ID = "text-xs font-semibold text-brand";
const FILE_NAME = "text-sm";
const ROW_DATE = "text-xs text-muted-foreground max-md:hidden";

export function ReviewerDashboard() {
  const { data: stats, isLoading } = useReviewerStats();
  const { data: recentReviews = [] } = useMyRecentReviews(20);
  const navigate = useNavigate();
  const location = useLocation();
  const pushToast = useToastStore((s) => s.push);
  const qc = useQueryClient();
  const approveMut = useApproveTask();
  const rejectMut = useRejectTask();
  const [rejectingTaskId, setRejectingTaskId] = useState<string | null>(null);

  const handleApprove = (taskId: string) => {
    approveMut.mutate(taskId, {
      onSuccess: () => {
        pushToast({ msg: "任务已通过审核", kind: "success" });
        qc.invalidateQueries({ queryKey: ["dashboard", "reviewer"] });
      },
    });
  };

  const handleReject = (taskId: string) => setRejectingTaskId(taskId);

  const handleRejectConfirm = (payload: {
    reason_type: "missing" | "extra" | "wrong_label" | "wrong_geometry";
    reason?: string;
  }) => {
    if (!rejectingTaskId) return;
    rejectMut.mutate(
      { taskId: rejectingTaskId, ...payload },
      {
        onSuccess: () => {
          pushToast({ msg: "任务已退回标注员", kind: "success" });
          qc.invalidateQueries({ queryKey: ["dashboard", "reviewer"] });
        },
      },
    );
    setRejectingTaskId(null);
  };

  if (isLoading || !stats) {
    return <div className="px-7 py-15 text-center text-muted-foreground">加载中...</div>;
  }

  return (
    <PageContainer>
      <div className="mb-5 flex items-end justify-between max-md:flex-col max-md:items-start max-md:gap-2.5">
        <div>
          <h1 className="mb-1 text-xl font-semibold">质检工作台</h1>
          <p className="m-0 text-sm text-muted-foreground">审核标注质量，确保数据准确性</p>
        </div>
        <Button variant="primary" onClick={() => navigate("/review")}>
          <Icon name="check" size={13} />
          进入审核页面
        </Button>
      </div>

      {/* 产能 */}
      <SectionDivider label="产能" hint="待审 / 今日 / 单题耗时" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        <StatCard icon="flag" label="待审队列" value={stats.pending_review_count} />
        <StatCard
          icon="check"
          label="今日已审"
          value={stats.today_reviewed}
          trend={stats.weekly_compare_pct ?? undefined}
          sparkValues={stats.daily_review_counts}
        />
        <StatCard
          icon="clock"
          label="平均审核耗时"
          value={
            stats.median_review_duration_ms == null
              ? "—"
              : stats.median_review_duration_ms < 60000
                ? `${(stats.median_review_duration_ms / 1000).toFixed(1)}s`
                : `${Math.round(stats.median_review_duration_ms / 60000)}m`
          }
          hint="中位"
        />
        <StatCard icon="layers" label="累计审核" value={stats.total_reviewed} />
      </div>

      {/* 质量 */}
      <SectionDivider label="质量" hint="通过率 / 二次返修率" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <StatCard icon="activity" label="24h 通过率" value={`${stats.approval_rate_24h}%`} />
        <StatCard icon="activity" label="历史通过率" value={`${stats.approval_rate}%`} />
        <StatCard
          icon="rotate-ccw"
          label="二次返修率"
          value={
            stats.reopen_after_approve_rate == null ? "—" : `${stats.reopen_after_approve_rate}%`
          }
          hint="approve 后被 reopen"
        />
      </div>

      <div className="h-4" />

      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-3.5 max-md:flex-col max-md:items-start max-md:gap-2.5">
          <h3 className={CARD_TITLE}>
            待审核任务
            {stats.pending_tasks.length > 0 && (
              <span className={TITLE_BADGE}>
                <Badge variant="warning">{stats.pending_tasks.length}</Badge>
              </span>
            )}
          </h3>
        </div>

        {stats.pending_tasks.length === 0 ? (
          <div className="px-4 py-12 text-center text-muted-foreground">
            <Icon name="check" size={36} className="mb-2.5 opacity-25" />
            <div className="mb-1 text-sm">暂无待审核任务</div>
            <div className="text-xs">所有标注任务已审核完毕</div>
          </div>
        ) : (
          <div>
            {stats.pending_tasks.map((task) => (
              <ReviewTaskRow
                key={task.task_id}
                task={task}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>
        )}
      </Card>

      {(stats.reviewing_batches?.length ?? 0) > 0 && (
        <div className="mt-4">
          <Card>
            <div className={CARD_HEADER_PLAIN}>
              <h3 className={CARD_TITLE}>
                审核中批次
                <span className={TITLE_BADGE}>
                  <Badge variant="warning">{stats.reviewing_batches!.length}</Badge>
                </span>
              </h3>
            </div>
            <div className="py-2">
              {stats.reviewing_batches!.map((b) => {
                const remaining = Math.max(0, b.total_tasks - b.completed_tasks - b.review_tasks);
                const reviewPct = b.total_tasks
                  ? Math.round((b.completed_tasks / b.total_tasks) * 100)
                  : 0;
                return (
                  <button
                    key={b.batch_id}
                    type="button"
                    onClick={() => navigate(`/review?project=${b.project_id}&batch=${b.batch_id}`)}
                    className="flex w-full cursor-pointer appearance-none items-center justify-between gap-3 border-0 border-t border-border bg-transparent px-4 py-2.5 text-left [font:inherit] text-inherit"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{b.batch_name}</div>
                      <div className={ROW_META}>
                        <span className="mono">{b.batch_display_id}</span>
                        <span> · {b.project_name}</span>
                        <span> · 共 {b.total_tasks} 任务</span>
                        {b.review_tasks > 0 && <span> · {b.review_tasks} 待审</span>}
                        {remaining > 0 && <span> · {remaining} 未交</span>}
                      </div>
                      {b.annotator && (
                        <div className="mt-1.5">
                          <AssigneeAvatarStack users={[b.annotator]} label="标注员" max={1} />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-[0_0_auto] items-center gap-2">
                      <span className="mono text-xs text-muted-foreground">{reviewPct}%</span>
                      <Icon name="chevron-right" size={14} />
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      <div className="mt-4">
        <Card>
          <div className={CARD_HEADER_PLAIN}>
            <h3 className={CARD_TITLE}>
              我的最近审核记录
              {recentReviews.length > 0 && (
                <span className={TITLE_BADGE}>
                  <Badge variant="outline">{recentReviews.length}</Badge>
                </span>
              )}
            </h3>
          </div>
          {recentReviews.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无审核记录</div>
          ) : (
            <div>
              {recentReviews.map((r) => (
                <RecentReviewRow
                  key={r.task_id}
                  item={r}
                  onClick={() =>
                    navigate(
                      buildWorkbenchUrl(r.project_id, {
                        taskId: r.task_id,
                        returnTo: currentWorkbenchReturnTo(location),
                      }),
                    )
                  }
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      <RejectReasonModal
        open={rejectingTaskId !== null}
        count={1}
        onClose={() => setRejectingTaskId(null)}
        onConfirm={handleRejectConfirm}
      />
    </PageContainer>
  );
}

function RecentReviewRow({ item, onClick }: { item: RecentReviewItem; onClick: () => void }) {
  const reviewedAt = item.reviewed_at ? new Date(item.reviewed_at).toLocaleString("zh-CN") : "—";
  // 与工作台任务队列 (TaskQueuePanel) 标签一致；并补 rejected 分支，避免 fallback 漏出原始英文 status
  const statusBadge =
    item.status === "completed" ? (
      <Badge variant="success" dot>
        已完成
      </Badge>
    ) : item.status === "review" ? (
      <Badge variant="warning" dot>
        待审核
      </Badge>
    ) : item.status === "rejected" ? (
      <Badge variant="danger" dot>
        待重做
      </Badge>
    ) : (
      <Badge variant="outline">{item.status}</Badge>
    );
  return (
    <div
      onClick={onClick}
      className="grid cursor-pointer grid-cols-[minmax(0,1fr)_200px_100px_160px] items-center gap-3 border-b border-border px-4 py-2.5 max-md:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div>
        <div className={ROW_TITLE_LINE}>
          <span className={`mono ${TASK_ID}`}>{item.task_display_id}</span>
          <span className={FILE_NAME}>{item.file_name}</span>
        </div>
        <div className={ROW_META}>
          <span className="[&_span]:px-1.5 [&_span]:text-2xs">
            <Badge variant="outline">{item.project_name}</Badge>
          </span>
        </div>
      </div>
      <div className={ROW_DATE}>审于 {reviewedAt}</div>
      <div>{statusBadge}</div>
      <div className="text-right max-md:hidden">
        <Icon name="chevRight" size={12} />
      </div>
    </div>
  );
}

function ReviewTaskRow({
  task,
  onApprove,
  onReject,
}: {
  task: ReviewTaskItem;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const updated = task.updated_at ? new Date(task.updated_at).toLocaleDateString("zh-CN") : "—";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_140px_100px_160px] items-center gap-3 border-b border-border px-4 py-2.5 max-md:grid-cols-[minmax(0,1fr)_auto]">
      <div>
        <div className={ROW_TITLE_LINE}>
          <span className={`mono ${TASK_ID}`}>{task.task_display_id}</span>
          <span className={FILE_NAME}>{task.file_name}</span>
        </div>
        <div className={ROW_META}>
          <span className="mr-1.5 [&_span]:px-1.5 [&_span]:text-2xs">
            <Badge variant="outline">{task.project_name}</Badge>
          </span>
          {task.total_annotations} 个标注 · {task.total_predictions} 个预测
        </div>
      </div>
      <div className={ROW_DATE}>更新 {updated}</div>
      <div>
        <Badge variant="warning" dot>
          待审核
        </Badge>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button variant="primary" size="sm" onClick={() => onApprove(task.task_id)}>
          <Icon name="check" size={11} />
          通过
        </Button>
        <Button variant="danger" size="sm" onClick={() => onReject(task.task_id)}>
          <Icon name="x" size={11} />
          退回
        </Button>
      </div>
    </div>
  );
}

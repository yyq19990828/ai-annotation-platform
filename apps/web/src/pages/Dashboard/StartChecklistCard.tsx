import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import type { ProjectResponse } from "@/api/projects";
import type { MyBatchItem } from "@/api/dashboard";
import { useOnboardingProjectState } from "@/hooks/useOnboardingProjectState";
import { annotationGuideVersion, isGuideSeen } from "@/utils/annotationGuide";
import {
  buildWorkbenchUrl,
  currentWorkbenchReturnTo,
  getRememberedWorkbenchTask,
} from "@/utils/workbenchNavigation";
import { useAuthStore } from "@/stores/authStore";

type Step = {
  id: "guide" | "task" | "annotation" | "result";
  label: string;
  detail: string;
  done: boolean;
  actionLabel: string;
  onAction: () => void;
};

function projectBatches(projectId: string, batches: MyBatchItem[]) {
  return batches
    .filter((batch) => batch.project_id === projectId)
    .sort((a, b) => {
      const priority = (status: string) =>
        status === "rejected" ? 0 : status === "annotating" ? 1 : status === "active" ? 2 : 3;
      return priority(a.status) - priority(b.status);
    });
}

export function StartChecklistCard({
  project,
  batches,
}: {
  project: ProjectResponse;
  batches: MyBatchItem[];
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const userId = useAuthStore((state) => state.user?.id);
  const guideVersion = annotationGuideVersion(project.annotation_guide);
  const { dismissed, guideRead, isSaving, dismiss, reopen } = useOnboardingProjectState(
    project.id,
    guideVersion,
  );
  const batchesForProject = useMemo(
    () => projectBatches(project.id, batches),
    [batches, project.id],
  );
  const activeBatch = batchesForProject[0] ?? null;
  const rememberedTaskId = activeBatch
    ? getRememberedWorkbenchTask(
        activeBatch.batch_id,
        undefined,
        userId ? `${userId}:annotate` : "annotate",
      )
    : null;
  const guideExists = Boolean(project.annotation_guide?.trim());
  const hasAssignedTask = batchesForProject.some((batch) => batch.total_tasks > 0);
  const hasAnnotation = batchesForProject.some(
    (batch) =>
      (batch.in_progress_tasks ?? 0) > 0 ||
      batch.review_tasks > 0 ||
      batch.completed_tasks > 0 ||
      batch.approved_tasks > 0 ||
      batch.rejected_tasks > 0,
  );
  const hasSubmissionResult = batchesForProject.some(
    (batch) =>
      batch.review_tasks > 0 ||
      batch.completed_tasks > 0 ||
      batch.rejected_tasks > 0 ||
      ["reviewing", "rejected"].includes(batch.status),
  );

  const openProjectWork = (taskId?: string | null) => {
    if (!activeBatch) {
      navigate(`/annotate?returnTo=${encodeURIComponent(currentWorkbenchReturnTo(location))}`);
      return;
    }
    navigate(
      buildWorkbenchUrl(project.id, {
        batchId: activeBatch.batch_id,
        taskId: taskId ?? undefined,
        returnTo: currentWorkbenchReturnTo(location),
      }),
    );
  };

  const steps: Step[] = [
    {
      id: "guide",
      label: "阅读项目指引",
      detail: guideExists ? "先了解类别定义、边界和常见反例" : "项目管理员尚未发布标注指引",
      done: guideExists && guideRead,
      actionLabel: guideExists ? "打开工作台阅读" : "查看项目设置",
      onAction: () =>
        guideExists
          ? openProjectWork(rememberedTaskId)
          : navigate(`/projects/${project.id}/settings?section=annotation-guide`),
    },
    {
      id: "task",
      label: "打开分派任务",
      detail: hasAssignedTask ? "已有分派批次，可以从上次位置继续" : "等待项目管理员创建并分派任务",
      done: hasAssignedTask,
      actionLabel: "打开任务",
      onAction: () => openProjectWork(rememberedTaskId),
    },
    {
      id: "annotation",
      label: "完成首条标注",
      detail: hasAnnotation ? "已检测到你的标注进度" : "在工作台保存一条有效标注",
      done: hasAnnotation,
      actionLabel: "继续标注",
      onAction: () => openProjectWork(rememberedTaskId),
    },
    {
      id: "result",
      label: "查看送审结果",
      detail: hasSubmissionResult ? "已有送审、通过或退回结果" : "送审后可在这里看到审核结果",
      done: hasSubmissionResult,
      actionLabel: "查看结果",
      onAction: () => openProjectWork(rememberedTaskId),
    },
  ];

  const readFromStorage = isGuideSeen(userId, project.id, guideVersion);
  const visibleGuideRead = guideRead || readFromStorage;
  if (dismissed) {
    return (
      <Card data-testid="start-checklist-collapsed">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-sm font-semibold">开工清单已跳过</div>
            <div className="mt-1 text-xs text-muted-foreground">项目状态仍会继续更新。</div>
          </div>
          <Button size="sm" onClick={() => void reopen()} disabled={isSaving}>
            重新打开清单
          </Button>
        </div>
      </Card>
    );
  }

  const doneCount = steps.filter((step) =>
    step.id === "guide" ? visibleGuideRead : step.done,
  ).length;

  return (
    <Card data-testid="start-checklist-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="m-0 text-sm font-semibold">开工清单</h2>
            <Badge variant={doneCount === steps.length ? "success" : "accent"}>
              {doneCount} / {steps.length}
            </Badge>
          </div>
          <p className="m-0 mt-1 text-xs text-muted-foreground">
            {project.name} · 按真实任务状态更新
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void dismiss()} disabled={isSaving}>
          跳过
        </Button>
      </div>
      <div className="grid gap-2 p-3">
        {steps.map((step) => {
          const done = step.id === "guide" ? visibleGuideRead : step.done;
          return (
            <div
              key={step.id}
              className={`flex items-center gap-3 rounded-md border px-3 py-2.5 ${done ? "border-status-positive/30 bg-status-positive-soft/40" : "border-border bg-card"}`}
              data-testid={`start-checklist-step-${step.id}`}
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full ${done ? "bg-status-positive-soft text-status-positive" : "bg-muted text-muted-foreground"}`}
              >
                <Icon name={done ? "check" : "circleDot"} size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{step.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{step.detail}</div>
              </div>
              {!done && (
                <Button size="sm" variant="ghost" onClick={step.onAction}>
                  {step.actionLabel}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import type { MyBatchItem } from "@/api/dashboard";
import type { ProjectResponse } from "@/api/projects";
import { useAuthStore } from "@/stores/authStore";
import {
  buildWorkbenchUrl,
  currentWorkbenchReturnTo,
  getRememberedWorkbenchTask,
  getRememberedWorkbenchTaskRecord,
} from "@/utils/workbenchNavigation";

function dueSoon(value: string | null | undefined): boolean {
  if (!value) return false;
  const due = new Date(`${value}T23:59:59`);
  if (Number.isNaN(due.getTime())) return false;
  const now = new Date();
  const end = new Date(now);
  end.setDate(now.getDate() + 7);
  return due >= now && due <= end;
}

export function WorkPriorityCard({
  projects,
  batches,
}: {
  projects: ProjectResponse[];
  batches: MyBatchItem[];
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const userId = useAuthStore((state) => state.user?.id);
  const activeBatches = batches.filter((batch) =>
    ["active", "annotating", "rejected", "reviewing"].includes(batch.status),
  );
  const rememberedBatches = activeBatches
    .map((batch) => ({
      batch,
      memory: getRememberedWorkbenchTaskRecord(
        batch.batch_id,
        undefined,
        userId ? `${userId}:annotate` : "annotate",
      ),
    }))
    .filter((entry) => entry.memory !== null)
    .sort((a, b) => (b.memory?.lastOpenedAt ?? 0) - (a.memory?.lastOpenedAt ?? 0));
  const continuation = rememberedBatches[0]?.batch;
  const rejected = activeBatches.find((batch) => batch.rejected_tasks > 0);
  const dueProject = [...projects]
    .filter(
      (project) =>
        dueSoon(project.due_date) && (project.total_tasks ?? 0) > (project.completed_tasks ?? 0),
    )
    .sort((a, b) => {
      const aDue = a.due_date ? new Date(`${a.due_date}T00:00:00`).getTime() : Infinity;
      const bDue = b.due_date ? new Date(`${b.due_date}T00:00:00`).getTime() : Infinity;
      return aDue - bDue;
    })[0];

  const openBatch = (batch: MyBatchItem, status?: string) => {
    const scope = userId ? `${userId}:annotate` : "annotate";
    const rememberedTaskId = getRememberedWorkbenchTask(batch.batch_id, undefined, scope);
    if (status) {
      navigate(`/annotate?batch=${encodeURIComponent(batch.batch_id)}&status=${status}`);
      return;
    }
    navigate(
      buildWorkbenchUrl(batch.project_id, {
        batchId: batch.batch_id,
        taskId: rememberedTaskId,
        returnTo: currentWorkbenchReturnTo(location),
      }),
    );
  };

  const openDueProject = () => {
    if (!dueProject) return;
    navigate(
      `/projects/${dueProject.id}/annotate?returnTo=${encodeURIComponent(currentWorkbenchReturnTo(location))}`,
    );
  };

  if (!continuation && !rejected && !dueProject) return null;

  return (
    <Card data-testid="work-priority-card">
      <div className="border-b border-border px-4 py-3.5">
        <h2 className="m-0 text-sm font-semibold">优先处理</h2>
        <p className="m-0 mt-1 text-xs text-muted-foreground">根据你的任务状态和项目截止日期排序</p>
      </div>
      <div className="grid gap-2 p-3 md:grid-cols-3">
        {continuation && (
          <div className="rounded-md border border-brand/30 bg-brand/10 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-brand">
              <Icon name="play" size={13} /> 继续上次工作
            </div>
            <div className="mt-1.5 truncate text-sm font-medium">{continuation.batch_name}</div>
            <div className="mt-1 text-xs text-muted-foreground">从上次打开的任务继续</div>
            <Button
              size="sm"
              variant="primary"
              className="mt-3"
              onClick={() => openBatch(continuation)}
            >
              继续标注
            </Button>
          </div>
        )}
        {rejected && (
          <div className="rounded-md border border-status-danger/30 bg-status-danger-soft p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-status-danger">
              <Icon name="warning" size={13} /> 退回待处理
            </div>
            <div className="mt-1.5 truncate text-sm font-medium">{rejected.batch_name}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {rejected.rejected_tasks} 个任务需要重做
            </div>
            <Button
              size="sm"
              variant="danger"
              className="mt-3"
              onClick={() => openBatch(rejected, "rejected")}
            >
              查看退回任务
            </Button>
          </div>
        )}
        {dueProject && (
          <div className="rounded-md border border-status-caution/30 bg-status-caution-soft p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-status-caution">
              <Icon name="clock" size={13} /> 即将到期
            </div>
            <div className="mt-1.5 truncate text-sm font-medium">{dueProject.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              截止 {dueProject.due_date} · 还剩{" "}
              {Math.max(0, (dueProject.total_tasks ?? 0) - (dueProject.completed_tasks ?? 0))}{" "}
              个任务
            </div>
            <Button size="sm" className="mt-3" onClick={openDueProject}>
              打开项目
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

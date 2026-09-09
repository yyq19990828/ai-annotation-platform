import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { useBatches } from "@/hooks/useBatches";
import { useProjectMembers } from "@/hooks/useProjects";
import { useProjectDatasets } from "@/hooks/useDatasets";
import type { ProjectResponse } from "@/api/projects";

type ReadinessItem = {
  id: string;
  label: string;
  detail: string;
  ready: boolean;
  href: string;
};

function StateBadge({ ready }: { ready: boolean }) {
  return ready ? (
    <Badge variant="success" dot>
      已就绪
    </Badge>
  ) : (
    <Badge variant="warning" dot>
      待处理
    </Badge>
  );
}

export function ProjectReadinessSection({ project }: { project: ProjectResponse }) {
  const navigate = useNavigate();
  const datasetsQuery = useProjectDatasets(project.id);
  const membersQuery = useProjectMembers(project.id);
  const batchesQuery = useBatches(project.id);

  const linkedDatasets = useMemo(() => datasetsQuery.data ?? [], [datasetsQuery.data]);
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const batches = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data]);
  const datasetsUnavailable = datasetsQuery.data === undefined;
  const membersUnavailable = membersQuery.data === undefined;
  const batchesUnavailable = batchesQuery.data === undefined;

  const readiness = useMemo<ReadinessItem[]>(() => {
    const guideReady = Boolean(project.annotation_guide?.trim());
    const datasetItems = linkedDatasets.reduce(
      (sum, dataset) => sum + (dataset.items_count || 0),
      0,
    );
    const linkedTasks = linkedDatasets.reduce(
      (sum, dataset) => sum + (dataset.tasks_in_project || 0),
      0,
    );
    const totalTasks = project.total_tasks ?? 0;
    const taskProgress = datasetItems > 0 ? Math.min(100, (linkedTasks / datasetItems) * 100) : 0;
    const hasValidData = !datasetsUnavailable && datasetItems > 0 && totalTasks > 0;
    const taskCreationReady = !datasetsUnavailable && hasValidData && taskProgress >= 100;
    const batchReady =
      !batchesUnavailable &&
      batches.some((batch) => batch.status !== "draft" && batch.status !== "archived");
    const hasAnnotator =
      !membersUnavailable && members.some((member) => member.role === "annotator");
    const hasReviewer = !membersUnavailable && members.some((member) => member.role === "reviewer");
    const activated =
      !batchesUnavailable &&
      batches.some((batch) =>
        ["active", "pre_annotated", "annotating", "reviewing", "approved", "rejected"].includes(
          batch.status,
        ),
      );

    return [
      {
        id: "guide",
        label: "类别规范与标注指引",
        detail: guideReady ? "项目指南已发布，成员可在工作台阅读" : "还没有发布项目标注指引",
        ready: guideReady,
        href: "annotation-guide",
      },
      {
        id: "data",
        label: "有效数据",
        detail: datasetsUnavailable
          ? "正在读取关联数据集"
          : datasetItems > 0
            ? `${linkedDatasets.length} 个数据集 · ${datasetItems.toLocaleString()} 条数据`
            : "尚未关联含有效条目的数据集",
        ready: hasValidData,
        href: "datasets",
      },
      {
        id: "tasks",
        label: "任务创建进度",
        detail: datasetsUnavailable
          ? "正在读取任务创建进度"
          : datasetItems > 0
            ? `${linkedTasks.toLocaleString()} / ${datasetItems.toLocaleString()} 条任务 · ${Math.round(taskProgress)}%`
            : "关联数据集后开始创建任务",
        ready: taskCreationReady,
        href: "batches",
      },
      {
        id: "batches",
        label: "批次已建立",
        detail: batchesUnavailable
          ? "正在读取批次状态"
          : batchReady
            ? `${batches.length} 个批次可继续配置`
            : "还没有可执行的批次",
        ready: batchReady,
        href: "batches",
      },
      {
        id: "roles",
        label: "标注员与审核员",
        detail: membersUnavailable
          ? "正在读取项目成员"
          : `${hasAnnotator ? "已配置标注员" : "缺少标注员"} · ${hasReviewer ? "已配置审核员" : "缺少审核员"}`,
        ready: hasAnnotator && hasReviewer,
        href: "members",
      },
      {
        id: "activation",
        label: "项目已激活",
        detail: batchesUnavailable
          ? "正在读取批次激活状态"
          : activated
            ? "已有批次进入可执行状态"
            : "把批次激活并完成成员配置后开始工作",
        ready: activated,
        href: "batches",
      },
    ];
  }, [
    batches,
    batchesUnavailable,
    datasetsUnavailable,
    linkedDatasets,
    members,
    membersUnavailable,
    project.annotation_guide,
    project.total_tasks,
  ]);

  const readyCount = readiness.filter((item) => item.ready).length;

  return (
    <Card>
      <div className="border-b border-border px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="m-0 text-sm font-semibold">开工准备</h3>
            <p className="m-0 mt-1 text-xs text-muted-foreground">
              {readyCount} / {readiness.length} 项已就绪，状态来自当前项目数据
            </p>
          </div>
          <Badge variant={readyCount === readiness.length ? "success" : "warning"}>
            {readyCount === readiness.length ? "可以开工" : "继续配置"}
          </Badge>
        </div>
      </div>
      <div className="divide-y divide-border">
        {readiness.map((item) => (
          <button
            key={item.id}
            type="button"
            className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 py-3 text-left text-inherit hover:bg-muted/50"
            onClick={() => navigate(`/projects/${project.id}/settings?section=${item.href}`)}
            data-testid={`readiness-item-${item.id}`}
          >
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full ${item.ready ? "bg-status-positive-soft text-status-positive" : "bg-status-caution-soft text-status-caution"}`}
            >
              <Icon name={item.ready ? "check" : "clock"} size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                {item.label}
                <StateBadge ready={item.ready} />
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span>
            </span>
            <Icon name="chevRight" size={13} className="shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </Card>
  );
}

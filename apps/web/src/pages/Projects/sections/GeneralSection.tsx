import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import type { ProjectResponse } from "@/api/projects";

const STATUS_OPTIONS = [
  { value: "in_progress", label: "进行中" },
  { value: "pending_review", label: "待审核" },
  { value: "completed", label: "已完成" },
  { value: "archived", label: "已归档" },
];

const LABEL_CLASS = "mb-1.5 block text-xs font-medium text-muted-foreground";
const READONLY_VALUE_CLASS =
  "rounded-md border border-border bg-muted px-[11px] py-2 text-[13px] text-muted-foreground";
const CONTROL_CLASS =
  "w-full appearance-none rounded-md border border-border bg-muted px-[11px] py-2 text-[13.5px] text-foreground outline-none";
const PROGRESS_CHIP_CLASS =
  "rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground";

/** 项目进度概览（只读）。计数口径与 Dashboard 项目行一致，复用同一 ProgressBar。 */
function ProgressOverview({ project }: { project: ProjectResponse }) {
  const totalTasks = project.total_tasks ?? 0;
  const denom = totalTasks || 1;
  const inProgress = project.in_progress_tasks ?? 0;
  const review = project.review_tasks ?? 0;
  const aiCompleted = project.ai_completed_tasks ?? 0;

  const pct = Math.round((project.completed_tasks / denom) * 100);
  const aiPct = project.ai_enabled ? Math.round((aiCompleted / denom) * 100) : 0;
  // 「已动工」副条 = (in_progress + review + completed) / total，与 Dashboard 口径一致
  const startedPct = Math.round(((inProgress + review + project.completed_tasks) / denom) * 100);

  const batch = project.batch_summary;

  return (
    <div>
      <label className={LABEL_CLASS}>进度概览</label>
      {totalTasks === 0 ? (
        <div className={READONLY_VALUE_CLASS}>暂无任务</div>
      ) : (
        <div className="flex flex-col gap-2">
          <ProgressBar value={pct} aiValue={aiPct} inProgressValue={startedPct} />
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span className="mono">
              {project.completed_tasks.toLocaleString()} / {totalTasks.toLocaleString()} 已完成
            </span>
            <span className="font-semibold text-foreground">{pct}%</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className={PROGRESS_CHIP_CLASS}>{inProgress} 进行中</span>
            <span className={PROGRESS_CHIP_CLASS}>{review} 待审</span>
            {project.ai_enabled && (
              <span className="rounded-full border border-violet-500 bg-muted px-2 py-0.5 text-[11px] text-violet-600 dark:text-violet-400">
                {aiCompleted} AI 完成
              </span>
            )}
            <span className={PROGRESS_CHIP_CLASS}>{batch?.total ?? 0} 个批次</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function GeneralSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const update = useUpdateProject(project.id);

  const [name, setName] = useState(project.name);
  const [status, setStatus] = useState(project.status);
  const [dueDate, setDueDate] = useState(project.due_date ?? "");

  // 项目名称只在 onBlur 落库，补浏览器离开提示，避免未失焦直接关 tab / 刷新丢改名。
  useUnsavedWarning(name.trim() !== "" && name.trim() !== project.name);

  useEffect(() => {
    setName(project.name);
    setStatus(project.status);
    setDueDate(project.due_date ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // 自动保存：状态 / 截止日期等离散控件即时存；项目名称走文本框失焦保存。
  // 失败弹 toast，成功静默（避免每次改动都打扰）。
  const savePatch = (patch: {
    name?: string;
    status?: string;
    due_date?: string | null;
  }) => {
    update.mutate(patch, {
      onError: (err) =>
        pushToast({ msg: "保存失败", sub: (err as Error).message }),
    });
  };

  const onStatusChange = (next: string) => {
    setStatus(next);
    savePatch({ status: next });
  };

  const onDueDateChange = (next: string) => {
    setDueDate(next);
    savePatch({ due_date: next || null });
  };

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      pushToast({ msg: "项目名称不能为空" });
      setName(project.name);
      return;
    }
    if (trimmed === project.name) return;
    setName(trimmed);
    savePatch({ name: trimmed });
  };

  return (
    <Card>
      <div className="border-b border-border px-4 py-3.5">
        <h3 className="text-sm font-semibold">基本信息</h3>
      </div>
      <div className="flex flex-col gap-4 p-4">
        <div>
          <label className={LABEL_CLASS}>项目名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            maxLength={60}
            className={CONTROL_CLASS}
          />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          <div>
            <label className={LABEL_CLASS}>状态</label>
            <select value={status} onChange={(e) => onStatusChange(e.target.value)} className={`${CONTROL_CLASS} cursor-pointer`}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>截止日期</label>
            <input type="date" value={dueDate} onChange={(e) => onDueDateChange(e.target.value)} className={CONTROL_CLASS} />
          </div>
        </div>
        <div>
          <label className={LABEL_CLASS}>类型</label>
          <div className={READONLY_VALUE_CLASS}>
            {project.type_label} <span className="mono ml-2 text-[11px] text-muted-foreground">{project.type_key}</span>
          </div>
        </div>
        <div>
          <label className={LABEL_CLASS}>Scene 模式</label>
          <div className={READONLY_VALUE_CLASS}>
            {project.scene_mode ? "已开启" : "未开启"}
            {project.scene_mode && (
              <span className="ml-2 text-muted-foreground">
                按 scene 保持连续帧任务与批次边界
              </span>
            )}
          </div>
        </div>
        <ProgressOverview project={project} />
        {update.isPending && <div className="text-xs text-muted-foreground" data-testid="saving-hint">保存中…</div>}
      </div>
    </Card>
  );
}

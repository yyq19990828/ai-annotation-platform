import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import type { ProjectResponse } from "@/api/projects";
import styles from "./GeneralSection.module.css";

const STATUS_OPTIONS = [
  { value: "in_progress", label: "进行中" },
  { value: "pending_review", label: "待审核" },
  { value: "completed", label: "已完成" },
  { value: "archived", label: "已归档" },
];

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

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
      <label className={styles.label}>进度概览</label>
      {totalTasks === 0 ? (
        <div className={styles.readonlyValue}>暂无任务</div>
      ) : (
        <div className={styles.progressBox}>
          <ProgressBar value={pct} aiValue={aiPct} inProgressValue={startedPct} />
          <div className={styles.progressMeta}>
            <span className="mono">
              {project.completed_tasks.toLocaleString()} / {totalTasks.toLocaleString()} 已完成
            </span>
            <span className={styles.progressPct}>{pct}%</span>
          </div>
          <div className={styles.progressChips}>
            <span className={styles.progressChip}>{inProgress} 进行中</span>
            <span className={styles.progressChip}>{review} 待审</span>
            {project.ai_enabled && (
              <span className={cn(styles.progressChip, styles.progressChipAi)}>{aiCompleted} AI 完成</span>
            )}
            <span className={styles.progressChip}>{batch?.total ?? 0} 个批次</span>
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
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>基本信息</h3>
      </div>
      <div className={styles.body}>
        <div>
          <label className={styles.label}>项目名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            maxLength={60}
            className={styles.control}
          />
        </div>
        <div className={styles.gridTwo}>
          <div>
            <label className={styles.label}>状态</label>
            <select value={status} onChange={(e) => onStatusChange(e.target.value)} className={cn(styles.control, styles.selectControl)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={styles.label}>截止日期</label>
            <input type="date" value={dueDate} onChange={(e) => onDueDateChange(e.target.value)} className={styles.control} />
          </div>
        </div>
        <div>
          <label className={styles.label}>类型</label>
          <div className={styles.readonlyValue}>
            {project.type_label} <span className={cn("mono", styles.typeKey)}>{project.type_key}</span>
          </div>
        </div>
        <ProgressOverview project={project} />
        {update.isPending && <div className={styles.savingHint} data-testid="saving-hint">保存中…</div>}
      </div>
    </Card>
  );
}

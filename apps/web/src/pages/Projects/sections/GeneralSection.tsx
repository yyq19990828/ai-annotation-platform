import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
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
            {inProgress > 0 && <span className={styles.progressChip}>{inProgress} 进行中</span>}
            {review > 0 && <span className={styles.progressChip}>{review} 待审</span>}
            {project.ai_enabled && aiCompleted > 0 && (
              <span className={cn(styles.progressChip, styles.progressChipAi)}>{aiCompleted} AI 完成</span>
            )}
            {(batch?.total ?? 0) > 0 && (
              <span className={styles.progressChip}>{batch?.total} 个批次</span>
            )}
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

  useEffect(() => {
    setName(project.name);
    setStatus(project.status);
    setDueDate(project.due_date ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const dirty =
    name.trim() !== project.name ||
    status !== project.status ||
    (dueDate || null) !== (project.due_date ?? null);

  useUnsavedWarning(dirty);

  const onSave = () => {
    if (!name.trim()) {
      pushToast({ msg: "项目名称不能为空" });
      return;
    }
    update.mutate(
      {
        name: name.trim(),
        status,
        due_date: dueDate || null,
      },
      {
        onSuccess: () => pushToast({ msg: "项目已更新", kind: "success" }),
        onError: (err) =>
          pushToast({ msg: "保存失败", sub: (err as Error).message }),
      },
    );
  };

  return (
    <Card>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>基本信息</h3>
      </div>
      <div className={styles.body}>
        <div>
          <label className={styles.label}>项目名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={styles.control} />
        </div>
        <div className={styles.gridTwo}>
          <div>
            <label className={styles.label}>状态</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={cn(styles.control, styles.selectControl)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={styles.label}>截止日期</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={styles.control} />
          </div>
        </div>
        <div>
          <label className={styles.label}>类型</label>
          <div className={styles.readonlyValue}>
            {project.type_label} <span className={cn("mono", styles.typeKey)}>{project.type_key}</span>
          </div>
        </div>
        <ProgressOverview project={project} />
        <div className={styles.footer}>
          {dirty && (
            <span
              className={styles.unsavedIndicator}
              data-testid="unsaved-indicator"
            >
              <span className={styles.unsavedDot} />
              有未保存的修改
            </span>
          )}
          <Button variant="primary" disabled={!dirty || update.isPending} onClick={onSave}>
            {update.isPending ? "保存中..." : "保存修改"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

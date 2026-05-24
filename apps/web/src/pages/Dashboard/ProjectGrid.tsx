import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { type ProjectResponse } from "@/api/projects";
import { ExportSection } from "./ExportSection";
import { ProjectActionsMenu } from "./ProjectActionsMenu";

import styles from "./ProjectGrid.module.css";

// v0.10.28 · 卡片图标改读媒体维度 data_type (image / video / lidar).
const DATA_TYPE_ICONS: Record<string, IconName> = {
  image: "image",
  video: "video",
  lidar: "cube",
};

interface Props {
  projects: ProjectResponse[];
  onOpen: (p: ProjectResponse) => void;
  canManage: (p: ProjectResponse) => boolean;
  onSettings: (p: ProjectResponse, section?: string) => void;
}

/** v0.7.2 · 项目网格视图 — DashboardPage 用作 list 视图的可切换姿态。
 *  v0.7.6 · 卡片右下角次级动作（导出 / 设置）收编到 ⋮ DropdownMenu，主操作"打开"独立。
 */
export function ProjectGrid({ projects, onOpen, canManage, onSettings }: Props) {
  if (projects.length === 0) {
    return (
      <div className={styles.empty}>
        没有匹配的项目
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {projects.map((p) => {
        const total = p.total_tasks || 1;
        const pct = Math.round((p.completed_tasks / total) * 100);
        const aiPct = p.ai_enabled
          ? Math.round(((p.ai_completed_tasks ?? 0) / total) * 100)
          : 0;
        const startedPct = Math.round(
          ((p.in_progress_tasks ?? 0) + p.review_tasks + p.completed_tasks) / total * 100,
        );
        const ownerInitial = p.owner_name?.slice(0, 1) ?? "?";
        const due = p.due_date ?? "—";

        return (
          <Card
            key={p.id}
            onClick={() => onOpen(p)}
          >
            <div className={styles.projectCard}>
              <div className={styles.projectHeader}>
                <div className={styles.typeIcon}>
                  <Icon name={DATA_TYPE_ICONS[p.data_type ?? "image"] || "image"} size={15} />
                </div>
                <div className={styles.projectInfo}>
                  <div className={styles.projectName}>
                    {p.name}
                  </div>
                  <div className={styles.projectMeta}>
                    <span className={`mono ${styles.projectId}`}>
                      {p.display_id}
                    </span>
                    <span className={styles.projectType}>{p.type_label}</span>
                  </div>
                </div>
                {p.status === "in_progress" && <Badge variant="accent" dot>进行中</Badge>}
                {p.status === "completed" && <Badge variant="success" dot>已完成</Badge>}
                {p.status === "pending_review" && <Badge variant="warning" dot>待审核</Badge>}
              </div>

              <div>
                <ProgressBar value={pct} aiValue={aiPct} inProgressValue={startedPct} />
                <div className={styles.progressMeta}>
                  <span className="mono">
                    {p.completed_tasks.toLocaleString()} / {p.total_tasks.toLocaleString()}
                  </span>
                  <span className={styles.progressPct}>{pct}%</span>
                </div>
              </div>

              <div className={styles.cardFooterMeta}>
                <div className={styles.ownerMeta}>
                  <Avatar size="sm" initial={ownerInitial} />
                  <span className={styles.ownerName}>
                    {p.owner_name ?? "—"}
                  </span>
                  <span className={styles.memberCount}>
                    · {p.member_count ?? 0} 成员
                  </span>
                </div>
                <span className={styles.dueDate}>截止 {due}</span>
              </div>

              <div className={styles.cardActions} onClick={(e) => e.stopPropagation()}>
                <ExportSection projectId={p.id} projectTypeKey={p.type_key} />
                <ProjectActionsMenu
                  project={p}
                  canManage={canManage(p)}
                  onSettings={onSettings}
                />
                <Button
                  size="sm"
                  variant="primary"
                  onClick={(e) => { e.stopPropagation(); onOpen(p); }}
                >
                  打开<Icon name="chevRight" size={11} />
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

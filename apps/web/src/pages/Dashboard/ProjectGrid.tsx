import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useNavigate } from "react-router-dom";
import { DropdownMenu, type DropdownItem } from "@/components/ui/DropdownMenu";
import { useToastStore } from "@/components/ui/Toast";
import { projectsApi, type ProjectResponse, type ExportTarget } from "@/api/projects";

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
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();

  // v0.10.11 · 跳 Dashboard 并打开 Wizard 复制流; super_admin 看 AdminDashboard /
  // project_admin 看 DashboardPage, 二者都挂在 /dashboard 下由 DashboardRouter 分派.
  // (App.tsx 把 "/" index 设成 Navigate to="/dashboard" replace, 它不保留 query
  // string, 所以这里直接拼 /dashboard.)
  const onDuplicate = (p: ProjectResponse) => {
    navigate(`/dashboard?new=1&from=${p.id}`);
  };

  const exportProject = async (p: ProjectResponse, target: ExportTarget) => {
    try {
      await projectsApi.exportProject(p.id, [target], p.type_key === "video-track" ? { videoFrameMode: "keyframes" } : undefined);
    } catch (e) {
      pushToast({ msg: "导出失败", sub: (e as Error).message, kind: "error" });
    }
  };

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
                <ProjectMoreMenu
                  project={p}
                  canManage={canManage(p)}
                  onSettings={onSettings}
                  onExport={exportProject}
                  onDuplicate={onDuplicate}
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

function ProjectMoreMenu({
  project,
  canManage,
  onSettings,
  onExport,
  onDuplicate,
}: {
  project: ProjectResponse;
  canManage: boolean;
  onSettings: (p: ProjectResponse, section?: string) => void;
  onExport: (p: ProjectResponse, target: ExportTarget) => void;
  onDuplicate: (p: ProjectResponse) => void;
}) {
  const items: DropdownItem[] = [];
  if (canManage) {
    items.push({
      id: "settings",
      label: "项目设置",
      icon: "settings",
      onSelect: () => onSettings(project),
    });
    // v0.10.11 · "复制项目" — 跳 Wizard 复制流, 仅 canManage 用户可见
    items.push({
      id: "duplicate",
      label: "复制项目配置",
      icon: "copy",
      onSelect: () => onDuplicate(project),
    });
    items.push({ id: "div-1", divider: true, label: "" });
  }
  if (project.type_key === "video-track") {
    items.push({ id: "exp-video", label: "导出 Video JSON", icon: "download", onSelect: () => onExport(project, "video_json") });
  } else {
    items.push(
      { id: "exp-coco", label: "导出 COCO JSON", icon: "download", onSelect: () => onExport(project, "coco") },
      { id: "exp-voc", label: "导出 Pascal VOC", icon: "download", onSelect: () => onExport(project, "voc") },
      { id: "exp-yolo", label: "导出 YOLO 检测", icon: "download", onSelect: () => onExport(project, "yolo-det") },
    );
  }
  return (
    <DropdownMenu
      minWidth={180}
      items={items}
      trigger={({ open, toggle, ref }) => (
        <Button
          ref={ref as React.Ref<HTMLButtonElement>}
          size="sm"
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          aria-haspopup="menu"
          aria-expanded={open}
          title="更多操作"
        >
          <Icon name="more" size={11} />
        </Button>
      )}
    />
  );
}

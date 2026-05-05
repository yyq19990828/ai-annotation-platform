import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { DropdownMenu, type DropdownItem } from "@/components/ui/DropdownMenu";
import { useToastStore } from "@/components/ui/Toast";
import { projectsApi, type ProjectResponse, type ExportFormat } from "@/api/projects";

const TYPE_ICONS: Record<string, string> = {
  "image-det": "rect",
  "image-seg": "polygon",
  "image-kp": "point",
  lidar: "cube",
  "video-mm": "video",
  "video-track": "video",
  mm: "mm",
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

  const exportProject = async (p: ProjectResponse, format: ExportFormat) => {
    try {
      await projectsApi.exportProject(p.id, format);
    } catch (e) {
      pushToast({ msg: "导出失败", sub: (e as Error).message, kind: "error" });
    }
  };

  if (projects.length === 0) {
    return (
      <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--color-fg-subtle)" }}>
        没有匹配的项目
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 12,
        padding: 16,
      }}
    >
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
            style={{
              padding: 14,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div
                style={{
                  width: 32, height: 32, borderRadius: 6,
                  background: "var(--color-bg-sunken)",
                  border: "1px solid var(--color-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--color-fg-muted)",
                  flex: "0 0 32px",
                }}
              >
                <Icon name={(TYPE_ICONS[p.type_key] || "image") as any} size={15} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--color-fg-subtle)" }}>
                    {p.display_id}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>{p.type_label}</span>
                </div>
              </div>
              {p.status === "in_progress" && <Badge variant="accent" dot>进行中</Badge>}
              {p.status === "completed" && <Badge variant="success" dot>已完成</Badge>}
              {p.status === "pending_review" && <Badge variant="warning" dot>待审核</Badge>}
            </div>

            <div>
              <ProgressBar value={pct} aiValue={aiPct} inProgressValue={startedPct} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: "var(--color-fg-muted)" }}>
                <span className="mono">
                  {p.completed_tasks.toLocaleString()} / {p.total_tasks.toLocaleString()}
                </span>
                <span style={{ fontWeight: 500, color: "var(--color-fg)" }}>{pct}%</span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <Avatar size="sm" initial={ownerInitial} />
                <span style={{ fontSize: 11.5, color: "var(--color-fg-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.owner_name ?? "—"}
                </span>
                <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
                  · {p.member_count ?? 0} 成员
                </span>
              </div>
              <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>截止 {due}</span>
            </div>

            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: "auto" }} onClick={(e) => e.stopPropagation()}>
              <ProjectMoreMenu
                project={p}
                canManage={canManage(p)}
                onSettings={onSettings}
                onExport={exportProject}
              />
              <Button
                size="sm"
                variant="primary"
                onClick={(e) => { e.stopPropagation(); onOpen(p); }}
              >
                打开<Icon name="chevRight" size={11} />
              </Button>
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
}: {
  project: ProjectResponse;
  canManage: boolean;
  onSettings: (p: ProjectResponse, section?: string) => void;
  onExport: (p: ProjectResponse, format: ExportFormat) => void;
}) {
  const items: DropdownItem[] = [];
  if (canManage) {
    items.push({
      id: "settings",
      label: "项目设置",
      icon: "settings",
      onSelect: () => onSettings(project),
    });
    items.push({ id: "div-1", divider: true, label: "" });
  }
  items.push(
    { id: "exp-coco", label: "导出 COCO JSON", icon: "download", onSelect: () => onExport(project, "coco") },
    { id: "exp-voc", label: "导出 Pascal VOC", icon: "download", onSelect: () => onExport(project, "voc") },
    { id: "exp-yolo", label: "导出 YOLO", icon: "download", onSelect: () => onExport(project, "yolo") },
  );
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

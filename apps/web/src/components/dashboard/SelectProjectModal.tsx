import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import type { ProjectResponse } from "@/api/projects";
import styles from "./SelectProjectModal.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  projects: ProjectResponse[];
  onPick: (id: string) => void;
}

export function SelectProjectModal({ open, onClose, projects, onPick }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="选择项目开始标注" width={560}>
      {projects.length === 0 ? (
        <div className={styles.empty}>暂无分配项目</div>
      ) : (
        <ul className={styles.list}>
          {projects.map((p) => {
            const remaining = Math.max(0, (p.total_tasks ?? 0) - (p.completed_tasks ?? 0));
            return (
              <li key={p.id}>
                <button
                  onClick={() => {
                    onPick(p.id);
                    onClose();
                  }}
                  className={styles.projectButton}
                >
                  <Icon name="folder" size={16} className={styles.folderIcon} />
                  <div className={styles.projectInfo}>
                    <div className={styles.projectName}>{p.name}</div>
                    <div className={styles.projectMeta}>
                      <span className="mono">{p.display_id}</span> · {p.type_label}
                    </div>
                  </div>
                  <Badge
                    variant={remaining > 0 ? "accent" : "outline"}
                    className={styles.remainingBadge}
                  >
                    待标 {remaining}
                  </Badge>
                  <Icon name="chevRight" size={13} className={styles.chevronIcon} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

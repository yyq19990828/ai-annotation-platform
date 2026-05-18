import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/components/ui/Toast";
import { useTransferProject } from "@/hooks/useProjects";
import { usersApi } from "@/api/users";
import type { ProjectResponse } from "@/api/projects";
import styles from "./OwnerSection.module.css";

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

export function OwnerSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const transfer = useTransferProject(project.id);

  const { data: candidates = [] } = useQuery({
    queryKey: ["users", "project_admin"],
    queryFn: () => usersApi.list({ role: "project_admin" }),
    enabled: modalOpen,
  });

  const onConfirm = () => {
    if (!selected) return;
    transfer.mutate(selected, {
      onSuccess: () => {
        pushToast({ msg: "负责人已转移", kind: "success" });
        setModalOpen(false);
        setSelected(null);
      },
      onError: (err) => pushToast({ msg: "转移失败", sub: (err as Error).message }),
    });
  };

  return (
    <>
      <Card>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>项目负责人</h3>
        </div>
        <div className={styles.body}>
          <div className={styles.ownerRow}>
            <Avatar initial={project.owner_name?.slice(0, 1) ?? "?"} size="md" />
            <div>
              <div className={styles.ownerName}>{project.owner_name ?? "—"}</div>
              <div className={styles.ownerHint}>
                当前负责人 · 拥有此项目的全部管理权
              </div>
            </div>
          </div>
          <div className={styles.ruleBox}>
            <strong className={styles.ruleTitle}>转移规则：</strong> 负责人转移操作仅由超级管理员执行。新负责人必须是项目管理员（project_admin）角色。转移后原负责人将失去对此项目的可见性，除非被指派为成员。
          </div>
          <div>
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              转移负责人
            </Button>
          </div>
        </div>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="转移项目负责人" width={520}>
        <div className={styles.modalStack}>
          <div className={styles.modalHint}>选择新的项目负责人（仅 project_admin 可作为目标）</div>
          <div className={styles.candidateList}>
            {candidates.length === 0 && (
              <div className={styles.emptyCandidate}>
                暂无可选 project_admin
              </div>
            )}
            {candidates.map((u) => {
              const active = selected === u.id;
              const isCurrent = u.id === project.owner_id;
              return (
                <button
                  key={u.id}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => setSelected(u.id)}
                  className={cn(styles.candidateItem, active && styles.candidateItemActive)}
                >
                  <Avatar initial={u.name.slice(0, 1)} size="sm" />
                  <div className={styles.candidateMain}>
                    <div className={styles.candidateName}>{u.name}</div>
                    <div className={styles.candidateEmail}>
                      {u.email}
                      {isCurrent ? " · 当前负责人" : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className={styles.modalActions}>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>取消</Button>
            <Button variant="primary" disabled={!selected || transfer.isPending} onClick={onConfirm}>
              {transfer.isPending ? "转移中..." : "确认转移"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

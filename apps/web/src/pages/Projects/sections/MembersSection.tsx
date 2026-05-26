import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/components/ui/Toast";
import { useProjectMembers, useRemoveProjectMember } from "@/hooks/useProjects";
import { AssignMemberModal } from "@/components/projects/AssignMemberModal";
import type { ProjectResponse, ProjectMemberResponse } from "@/api/projects";
import styles from "./MembersSection.module.css";

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

export function MembersSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const { data: members = [], isLoading } = useProjectMembers(project.id);
  const remove = useRemoveProjectMember(project.id);
  const [assignOpen, setAssignOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ProjectMemberResponse | null>(null);

  const onRemove = (m: ProjectMemberResponse) => {
    remove.mutate(m.id, {
      onSuccess: () => {
        pushToast({ msg: "已移除成员", kind: "success" });
        setConfirmRemove(null);
      },
      onError: (err) => pushToast({ msg: "移除失败", sub: (err as Error).message }),
    });
  };

  return (
    <>
      <Card>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>项目成员</h3>
          <div className={styles.headerActions}>
            <Button onClick={() => setAssignOpen(true)}>
              <Icon name="plus" size={12} />添加成员
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className={styles.placeholder}>
            加载中...
          </div>
        )}
        {!isLoading && members.length === 0 && (
          <div className={styles.placeholder}>
            暂无成员，点击右上角按钮添加标注员或审核员
          </div>
        )}
        {!isLoading && members.length > 0 && (
          <div className={styles.tableScroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {["成员", "角色", "加入时间", ""].map((h, i) => (
                    <th
                      key={i}
                      className={cn(
                        styles.tableHeadCell,
                        i === 0 && styles.tableHeadCellFirst,
                        i === 3 && styles.tableHeadCellLast,
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className={styles.memberCell}>
                      <div className={styles.memberIdentity}>
                        <Avatar initial={m.user_name.slice(0, 1)} size="sm" />
                        <div className={styles.memberText}>
                          <div className={styles.memberName} title={m.user_name}>{m.user_name}</div>
                          <div className={styles.memberEmail} title={m.user_email}>{m.user_email}</div>
                        </div>
                      </div>
                    </td>
                    <td className={styles.tableCell}>
                      {m.role === "annotator" ? (
                        <Badge variant="accent">标注员</Badge>
                      ) : (
                        <Badge variant="warning">审核员</Badge>
                      )}
                    </td>
                    <td className={cn(styles.tableCell, styles.dateCell)}>
                      {new Date(m.assigned_at).toLocaleDateString("zh-CN")}
                    </td>
                    <td className={styles.actionCell}>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(m)}>
                        <Icon name="x" size={11} />移除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {assignOpen && (
        <AssignMemberModal
          open
          projectId={project.id}
          existing={members}
          onClose={() => setAssignOpen(false)}
        />
      )}

      <Modal open={!!confirmRemove} onClose={() => setConfirmRemove(null)} title="移除成员" width={420}>
        <div className={styles.removeBody}>
          确认将 <strong className={styles.removeName}>{confirmRemove?.user_name}</strong> 从本项目移除？该用户将不再看到此项目，已完成的标注/审核记录保留。
        </div>
        <div className={styles.modalActions}>
          <Button variant="ghost" onClick={() => setConfirmRemove(null)}>取消</Button>
          <Button variant="danger" disabled={remove.isPending} onClick={() => confirmRemove && onRemove(confirmRemove)}>
            {remove.isPending ? "处理中..." : "确认移除"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

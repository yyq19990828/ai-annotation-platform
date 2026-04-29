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

export function MembersSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const { data: members = [], isLoading } = useProjectMembers(project.id);
  const remove = useRemoveProjectMember(project.id);
  const [assignRole, setAssignRole] = useState<"annotator" | "reviewer" | null>(null);
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
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>项目成员</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={() => setAssignRole("annotator")}>
              <Icon name="plus" size={12} />指派标注员
            </Button>
            <Button onClick={() => setAssignRole("reviewer")}>
              <Icon name="plus" size={12} />指派审核员
            </Button>
          </div>
        </div>

        {isLoading && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
            加载中...
          </div>
        )}
        {!isLoading && members.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
            暂无成员，点击右上角按钮指派标注员或审核员
          </div>
        )}
        {!isLoading && members.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
            <thead>
              <tr>
                {["成员", "角色", "加入时间", ""].map((h, i) => (
                  <th
                    key={i}
                    style={{
                      textAlign: "left",
                      fontWeight: 500,
                      fontSize: 12,
                      color: "var(--color-fg-muted)",
                      padding: "10px 12px",
                      borderBottom: "1px solid var(--color-border)",
                      background: "var(--color-bg-sunken)",
                      ...(i === 0 ? { paddingLeft: 16 } : {}),
                      ...(i === 3 ? { paddingRight: 16 } : {}),
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td style={{ padding: "10px 12px 10px 16px", borderBottom: "1px solid var(--color-border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar initial={m.user_name.slice(0, 1)} size="sm" />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{m.user_name}</div>
                        <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{m.user_email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)" }}>
                    {m.role === "annotator" ? (
                      <Badge variant="accent">标注员</Badge>
                    ) : (
                      <Badge variant="warning">审核员</Badge>
                    )}
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}>
                    {new Date(m.assigned_at).toLocaleDateString("zh-CN")}
                  </td>
                  <td style={{ padding: "10px 16px 10px 12px", borderBottom: "1px solid var(--color-border)", textAlign: "right" }}>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(m)}>
                      <Icon name="x" size={11} />移除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {assignRole && (
        <AssignMemberModal
          open
          projectId={project.id}
          role={assignRole}
          existing={members}
          onClose={() => setAssignRole(null)}
        />
      )}

      <Modal open={!!confirmRemove} onClose={() => setConfirmRemove(null)} title="移除成员" width={420}>
        <div style={{ fontSize: 13, color: "var(--color-fg-muted)", marginBottom: 18 }}>
          确认将 <strong style={{ color: "var(--color-fg)" }}>{confirmRemove?.user_name}</strong> 从本项目移除？该用户将不再看到此项目，已完成的标注/审核记录保留。
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={() => setConfirmRemove(null)}>取消</Button>
          <Button variant="danger" disabled={remove.isPending} onClick={() => confirmRemove && onRemove(confirmRemove)}>
            {remove.isPending ? "处理中..." : "确认移除"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

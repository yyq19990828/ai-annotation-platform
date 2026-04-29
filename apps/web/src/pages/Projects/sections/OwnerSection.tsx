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
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>项目负责人</h3>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar initial={project.owner_name?.slice(0, 1) ?? "?"} size="md" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{project.owner_name ?? "—"}</div>
              <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 2 }}>
                当前负责人 · 拥有此项目的全部管理权
              </div>
            </div>
          </div>
          <div
            style={{
              padding: "10px 12px",
              fontSize: 12,
              color: "var(--color-fg-muted)",
              background: "var(--color-bg-sunken)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "var(--color-fg)" }}>转移规则：</strong> 负责人转移操作仅由超级管理员执行。新负责人必须是项目管理员（project_admin）角色。转移后原负责人将失去对此项目的可见性，除非被指派为成员。
          </div>
          <div>
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              转移负责人
            </Button>
          </div>
        </div>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="转移项目负责人" width={520}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>选择新的项目负责人（仅 project_admin 可作为目标）</div>
          <div
            style={{
              maxHeight: 320,
              overflowY: "auto",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
            }}
          >
            {candidates.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
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
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    background: active ? "var(--color-accent-soft)" : "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--color-border)",
                    cursor: isCurrent ? "not-allowed" : "pointer",
                    opacity: isCurrent ? 0.5 : 1,
                    textAlign: "left",
                    color: "var(--color-fg)",
                    fontFamily: "inherit",
                  }}
                >
                  <Avatar initial={u.name.slice(0, 1)} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
                      {u.email}
                      {isCurrent ? " · 当前负责人" : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
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

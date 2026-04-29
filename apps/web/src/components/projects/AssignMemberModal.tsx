import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useAddProjectMember } from "@/hooks/useProjects";
import { usersApi } from "@/api/users";
import type { ProjectMemberResponse } from "@/api/projects";

interface Props {
  open: boolean;
  projectId: string;
  role: "annotator" | "reviewer";
  existing: ProjectMemberResponse[];
  onClose: () => void;
}

const ROLE_LABEL: Record<"annotator" | "reviewer", string> = {
  annotator: "标注员",
  reviewer: "审核员",
};

export function AssignMemberModal({ open, projectId, role, existing, onClose }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const add = useAddProjectMember(projectId);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users", role],
    queryFn: () => usersApi.list({ role }),
    enabled: open,
  });

  const existingIds = useMemo(() => new Set(existing.map((m) => m.user_id)), [existing]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (existingIds.has(u.id)) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.group_name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [users, query, existingIds]);

  const onConfirm = () => {
    if (!selected) return;
    add.mutate(
      { user_id: selected, role },
      {
        onSuccess: () => {
          pushToast({ msg: `已指派 ${ROLE_LABEL[role]}`, kind: "success" });
          setSelected(null);
          setQuery("");
          onClose();
        },
        onError: (err) => pushToast({ msg: "指派失败", sub: (err as Error).message }),
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={`指派${ROLE_LABEL[role]}`} width={520}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按姓名、邮箱、分组搜索"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 11px",
            fontSize: 13.5,
            background: "var(--color-bg-sunken)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        <div
          style={{
            maxHeight: 320,
            overflowY: "auto",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          {isLoading && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
              加载中...
            </div>
          )}
          {!isLoading && candidates.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
              没有可用的{ROLE_LABEL[role]}
            </div>
          )}
          {candidates.map((u) => {
            const active = selected === u.id;
            return (
              <button
                key={u.id}
                type="button"
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
                  cursor: "pointer",
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
                    {u.group_name ? ` · ${u.group_name}` : ""}
                  </div>
                </div>
                {active && <Icon name="check" size={14} style={{ color: "var(--color-accent)" }} />}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!selected || add.isPending} onClick={onConfirm}>
            {add.isPending ? "指派中..." : "确认指派"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

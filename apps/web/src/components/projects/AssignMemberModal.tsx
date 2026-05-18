import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useAddProjectMember } from "@/hooks/useProjects";
import { usersApi } from "@/api/users";
import type { ProjectMemberResponse } from "@/api/projects";
import styles from "./AssignMemberModal.module.css";

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
      <div className={styles.stack}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按姓名、邮箱、分组搜索"
          className={styles.searchInput}
        />
        <div className={styles.list}>
          {isLoading && (
            <div className={styles.emptyState}>
              加载中...
            </div>
          )}
          {!isLoading && candidates.length === 0 && (
            <div className={styles.emptyState}>
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
                className={clsx(styles.userButton, active && styles.userButtonActive)}
              >
                <Avatar initial={u.name.slice(0, 1)} size="sm" />
                <div className={styles.userBody}>
                  <div className={styles.userName}>{u.name}</div>
                  <div className={styles.userMeta}>
                    {u.email}
                    {u.group_name ? ` · ${u.group_name}` : ""}
                  </div>
                </div>
                {active && <Icon name="check" size={14} className={styles.checkIcon} />}
              </button>
            );
          })}
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!selected || add.isPending} onClick={onConfirm}>
            {add.isPending ? "指派中..." : "确认指派"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

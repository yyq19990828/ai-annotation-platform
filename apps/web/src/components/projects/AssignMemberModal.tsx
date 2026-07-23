import { useEffect, useMemo, useState } from "react";
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
  existing: ProjectMemberResponse[];
  onClose: () => void;
}

type MemberRole = "annotator" | "reviewer";

const ROLE_LABEL: Record<MemberRole, string> = {
  annotator: "标注员",
  reviewer: "审核员",
};

export function AssignMemberModal({ open, projectId, existing, onClose }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const [role, setRole] = useState<MemberRole>("annotator");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const add = useAddProjectMember(projectId);

  useEffect(() => {
    setSelectedIds([]);
  }, [role]);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users", "assign-member", role],
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

  const toggleSelected = (userId: string) => {
    setSelectedIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const onConfirm = async () => {
    if (selectedIds.length === 0 || add.isPending) return;
    const results = await Promise.allSettled(
      selectedIds.map((userId) => add.mutateAsync({ user_id: userId, role })),
    );
    const successCount = results.filter((r) => r.status === "fulfilled").length;
    const failCount = results.length - successCount;
    if (successCount > 0) {
      pushToast({ msg: `已指派 ${successCount} 名${ROLE_LABEL[role]}`, kind: "success" });
    }
    if (failCount > 0) {
      const firstError = results.find((r) => r.status === "rejected");
      pushToast({
        msg: "部分成员指派失败",
        sub: firstError && firstError.status === "rejected" ? String(firstError.reason) : undefined,
        kind: "error",
      });
      return;
    }
    setSelectedIds([]);
    setQuery("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="添加项目成员" width={560}>
      <div className={styles.stack}>
        <div className={styles.roleTabs} aria-label="成员角色">
          {(["annotator", "reviewer"] as MemberRole[]).map((nextRole) => (
            <button
              key={nextRole}
              type="button"
              onClick={() => setRole(nextRole)}
              className={clsx(styles.roleButton, role === nextRole && styles.roleButtonActive)}
            >
              {ROLE_LABEL[nextRole]}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按姓名、邮箱、分组搜索"
          className={styles.searchInput}
        />
        <div className={styles.list}>
          {isLoading && <div className={styles.emptyState}>加载中...</div>}
          {!isLoading && candidates.length === 0 && (
            <div className={styles.emptyState}>没有可添加的{ROLE_LABEL[role]}</div>
          )}
          {candidates.map((u) => {
            const active = selectedIds.includes(u.id);
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => toggleSelected(u.id)}
                className={clsx(styles.userButton, active && styles.userButtonActive)}
              >
                <span
                  aria-hidden
                  className={clsx(styles.checkbox, active && styles.checkboxActive)}
                >
                  {active && <Icon name="check" size={12} />}
                </span>
                <Avatar initial={u.name.slice(0, 1)} size="sm" />
                <div className={styles.userBody}>
                  <div className={styles.userName}>{u.name}</div>
                  <div className={styles.userMeta}>
                    {u.email}
                    {u.group_name ? ` · ${u.group_name}` : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className={styles.selectionSummary}>
          已选择 {selectedIds.length} 名{ROLE_LABEL[role]}
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={selectedIds.length === 0 || add.isPending}
            onClick={onConfirm}
          >
            {add.isPending ? "指派中..." : `确认指派 ${selectedIds.length} 人`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

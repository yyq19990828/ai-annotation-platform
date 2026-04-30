import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import {
  useAssignUserGroup,
  useChangeUserRole,
  useDeleteUser,
} from "@/hooks/useUsers";
import { useGroups } from "@/hooks/useGroups";
import { usePermissions } from "@/hooks/usePermissions";
import { ROLE_LABELS } from "@/constants/roles";
import type { UserResponse } from "@/api/users";
import type { UserRole } from "@/types";

interface Props {
  open: boolean;
  user: UserResponse | null;
  onClose: () => void;
}

// 矩阵：actor.role × target.role → 允许 actor 把 target 改成的角色集
// project_admin 仅可在 annotator ↔ reviewer 之间切换；super_admin 可任意改（除自己）
const ASSIGNABLE_ROLES_BY_ACTOR: Record<UserRole, UserRole[]> = {
  super_admin: ["super_admin", "project_admin", "reviewer", "annotator", "viewer"],
  project_admin: ["reviewer", "annotator"],
  reviewer: [],
  annotator: [],
  viewer: [],
};

// 哪些 target.role 允许 actor 删除（不含 actor 自己 / 最后一名 super_admin）
const DELETABLE_TARGET_ROLES_BY_ACTOR: Record<UserRole, UserRole[]> = {
  super_admin: ["super_admin", "project_admin", "reviewer", "annotator", "viewer"],
  project_admin: ["reviewer", "annotator"],
  reviewer: [],
  annotator: [],
  viewer: [],
};

export function EditUserModal({ open, user, onClose }: Props) {
  const { role: actorRole } = usePermissions();
  const allowedRoles = ASSIGNABLE_ROLES_BY_ACTOR[actorRole] ?? [];
  const deletableRoles = DELETABLE_TARGET_ROLES_BY_ACTOR[actorRole] ?? [];

  const { data: groups = [] } = useGroups(open);
  const changeRole = useChangeUserRole();
  const assignGroup = useAssignUserGroup();
  const deleteUser = useDeleteUser();
  const pushToast = useToastStore((s) => s.push);

  const [roleVal, setRoleVal] = useState<UserRole>("annotator");
  const [groupId, setGroupId] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open && user) {
      setRoleVal(user.role as UserRole);
      setGroupId(user.group_id ?? "");
      setConfirmDelete(false);
      changeRole.reset();
      assignGroup.reset();
      deleteUser.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  if (!user) return null;

  // 不能改/删自己
  const isSelf = false; // EditUserModal 入口已经隐藏自己；保留位以避免 UI 错配
  const targetRole = user.role as UserRole;

  const canEditRole =
    !isSelf && allowedRoles.includes(targetRole); // 当前角色必须在 actor 可改的集合内才能允许改
  const canDelete = !isSelf && deletableRoles.includes(targetRole);

  const dirtyRole = canEditRole && roleVal !== user.role;
  const dirtyGroup = (groupId || null) !== (user.group_id ?? null);
  const dirty = dirtyRole || dirtyGroup;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty) {
      onClose();
      return;
    }
    try {
      if (dirtyRole) {
        await changeRole.mutateAsync({ userId: user.id, role: roleVal });
      }
      if (dirtyGroup) {
        await assignGroup.mutateAsync({ userId: user.id, groupId: groupId || null });
      }
      pushToast({ msg: "已保存", kind: "success" });
      onClose();
    } catch (err) {
      pushToast({
        msg: "保存失败",
        sub: err instanceof Error ? err.message : String(err),
        kind: "error",
      });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteUser.mutateAsync(user.id);
      pushToast({ msg: `已删除账号 ${user.name}`, kind: "success" });
      onClose();
    } catch (err) {
      pushToast({
        msg: "删除失败",
        sub: err instanceof Error ? err.message : String(err),
        kind: "error",
      });
    }
  };

  const error = changeRole.error || assignGroup.error || deleteUser.error;

  // 角色下拉里允许出现的选项 = 当前角色 + actor 可指派集合（去重）
  const roleOptions: UserRole[] = Array.from(
    new Set<UserRole>([targetRole, ...allowedRoles]),
  );

  const editRoleHint =
    actorRole === "project_admin"
      ? "项目管理员仅能在审核员 / 标注员 之间切换"
      : !canEditRole
      ? "你无权修改该用户的角色"
      : "";

  return (
    <Modal open={open} onClose={onClose} title={`编辑成员 · ${user.name}`} width={520}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="邮箱">
          <input value={user.email} readOnly style={{ ...inputStyle, color: "var(--color-fg-muted)" }} />
        </Field>

        <Field label={`角色${editRoleHint ? `（${editRoleHint}）` : ""}`}>
          <select
            value={roleVal}
            onChange={(e) => setRoleVal(e.target.value as UserRole)}
            disabled={!canEditRole}
            style={{ ...inputStyle, opacity: canEditRole ? 1 : 0.7 }}
          >
            {roleOptions.map((r) => (
              <option key={r} value={r} disabled={!canEditRole && r !== targetRole}>
                {ROLE_LABELS[r] ?? r}
              </option>
            ))}
          </select>
        </Field>

        <Field label="数据组">
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            style={inputStyle}
          >
            <option value="">— 未分配 —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>

        {error && (
          <div style={errorBoxStyle}>
            <Icon name="warning" size={13} /> {(error as Error)?.message ?? "操作失败"}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
          <div>
            {canDelete && user.is_active && !confirmDelete && (
              <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" size={12} /> 删除账号
              </Button>
            )}
            {canDelete && confirmDelete && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                <span style={{ color: "var(--color-danger)" }}>确认删除？该用户将无法登录</span>
                <Button type="button" variant="danger" onClick={handleDelete} disabled={deleteUser.isPending}>
                  {deleteUser.isPending ? "删除中…" : "确认删除"}
                </Button>
                <Button type="button" onClick={() => setConfirmDelete(false)}>
                  取消
                </Button>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button type="button" onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!dirty || changeRole.isPending || assignGroup.isPending}
            >
              {changeRole.isPending || assignGroup.isPending ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 5, color: "var(--color-fg-muted)" }}>{label}</div>
      {children}
    </label>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  fontSize: 13,
  background: "var(--color-bg-sunken)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-fg)",
  outline: "none",
};

const errorBoxStyle: CSSProperties = {
  padding: "8px 12px",
  background: "rgba(239,68,68,0.08)",
  border: "1px solid #ef4444",
  borderRadius: "var(--radius-md)",
  color: "#ef4444",
  fontSize: 12.5,
  display: "flex",
  gap: 8,
  alignItems: "center",
};

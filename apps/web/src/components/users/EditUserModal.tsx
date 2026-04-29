import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import {
  useAssignUserGroup,
  useChangeUserRole,
  useDeactivateUser,
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

const ASSIGNABLE_ROLES_BY_ACTOR: Record<UserRole, UserRole[]> = {
  super_admin: ["super_admin", "project_admin", "reviewer", "annotator", "viewer"],
  project_admin: ["reviewer", "annotator", "viewer"],
  reviewer: [],
  annotator: [],
  viewer: [],
};

export function EditUserModal({ open, user, onClose }: Props) {
  const { role: actorRole } = usePermissions();
  const allowedRoles = ASSIGNABLE_ROLES_BY_ACTOR[actorRole] ?? [];
  const canEditRole = actorRole === "super_admin";
  const canDeactivate = actorRole === "super_admin";

  const { data: groups = [] } = useGroups(open);
  const changeRole = useChangeUserRole();
  const assignGroup = useAssignUserGroup();
  const deactivate = useDeactivateUser();
  const pushToast = useToastStore((s) => s.push);

  const [roleVal, setRoleVal] = useState<UserRole>("annotator");
  const [groupId, setGroupId] = useState<string>("");
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  useEffect(() => {
    if (open && user) {
      setRoleVal(user.role as UserRole);
      setGroupId(user.group_id ?? "");
      setConfirmDeactivate(false);
      changeRole.reset();
      assignGroup.reset();
      deactivate.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  if (!user) return null;

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

  const handleDeactivate = async () => {
    try {
      await deactivate.mutateAsync(user.id);
      pushToast({ msg: `已停用 ${user.name}`, kind: "success" });
      onClose();
    } catch (err) {
      pushToast({
        msg: "停用失败",
        sub: err instanceof Error ? err.message : String(err),
        kind: "error",
      });
    }
  };

  const error = changeRole.error || assignGroup.error || deactivate.error;

  return (
    <Modal open={open} onClose={onClose} title={`编辑成员 · ${user.name}`} width={520}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="邮箱">
          <input value={user.email} readOnly style={{ ...inputStyle, color: "var(--color-fg-muted)" }} />
        </Field>

        <Field label={canEditRole ? "角色" : "角色（仅超级管理员可改）"}>
          <select
            value={roleVal}
            onChange={(e) => setRoleVal(e.target.value as UserRole)}
            disabled={!canEditRole}
            style={{ ...inputStyle, opacity: canEditRole ? 1 : 0.7 }}
          >
            {allowedRoles.length === 0 || !allowedRoles.includes(roleVal) ? (
              <option value={roleVal}>{ROLE_LABELS[roleVal] ?? roleVal}</option>
            ) : null}
            {allowedRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
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
            {canDeactivate && user.is_active && !confirmDeactivate && (
              <Button type="button" variant="danger" onClick={() => setConfirmDeactivate(true)}>
                <Icon name="logout" size={12} /> 停用账号
              </Button>
            )}
            {canDeactivate && confirmDeactivate && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                <span style={{ color: "var(--color-danger)" }}>确认停用？</span>
                <Button type="button" variant="danger" onClick={handleDeactivate} disabled={deactivate.isPending}>
                  {deactivate.isPending ? "停用中…" : "确认停用"}
                </Button>
                <Button type="button" onClick={() => setConfirmDeactivate(false)}>
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

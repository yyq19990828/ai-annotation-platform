import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/components/ui/Toast";
import { useInviteUser } from "@/hooks/useInvitation";
import { ROLE_LABELS } from "@/constants/roles";
import { usePermissions } from "@/hooks/usePermissions";
import type { InvitationCreated } from "@/api/users";
import type { UserRole } from "@/types";
import styles from "./InviteUserModal.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

const INVITABLE_ROLES_BY_ACTOR: Record<UserRole, UserRole[]> = {
  super_admin: ["super_admin", "project_admin", "reviewer", "annotator", "viewer"],
  project_admin: ["reviewer", "annotator", "viewer"],
  reviewer: [],
  annotator: [],
  viewer: [],
};

export function InviteUserModal({ open, onClose }: Props) {
  const { role } = usePermissions();
  const allowedRoles = INVITABLE_ROLES_BY_ACTOR[role] ?? [];
  const [email, setEmail] = useState("");
  const [roleVal, setRoleVal] = useState<UserRole>(allowedRoles[0] ?? "annotator");
  const [groupName, setGroupName] = useState("");
  const [result, setResult] = useState<InvitationCreated | null>(null);
  const invite = useInviteUser();
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setGroupName("");
      setRoleVal(allowedRoles[0] ?? "annotator");
      setResult(null);
      invite.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !roleVal) return;
    invite.mutate(
      {
        email: email.trim().toLowerCase(),
        role: roleVal,
        group_name: groupName.trim() || undefined,
      },
      {
        onSuccess: (data) => setResult(data),
      },
    );
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.invite_url);
      pushToast({ msg: "邀请链接已复制", kind: "success" });
    } catch {
      pushToast({ msg: "复制失败，请手动选择" });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={result ? "邀请已生成" : "邀请新成员"} width={520}>
      {!result ? (
        <form onSubmit={submit} className={styles.form}>
          <Field label="邮箱">
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="newuser@your-org.com"
              className={styles.input}
            />
          </Field>

          <Field label="角色">
            <select
              required
              value={roleVal}
              onChange={(e) => setRoleVal(e.target.value as UserRole)}
              className={styles.input}
            >
              {allowedRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="数据组（可选）">
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="例如：标注组A"
              className={styles.input}
            />
          </Field>

          {invite.isError && (
            <div className={styles.errorBox}>
              <Icon name="warning" size={13} />
              {(invite.error as Error)?.message ?? "邀请失败"}
            </div>
          )}

          <div className={styles.actions}>
            <Button type="button" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={invite.isPending}>
              {invite.isPending ? "生成中..." : "生成邀请链接"}
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.result}>
          <div className={styles.successBox}>
            <Icon name="check" size={14} className={styles.successIcon} />
            <div>
              <div className={styles.successTitle}>
                邀请已写入审计日志，链接 {formatExpiry(result.expires_at)} 内有效
              </div>
              <div className={styles.successText}>
                请妥善转发链接给被邀请人。链接仅显示一次，本平台不会代为发送邮件。
              </div>
            </div>
          </div>

          <Field label="一次性注册链接">
            <div className={styles.linkRow}>
              <input
                readOnly
                value={result.invite_url}
                onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
                className={`${styles.input} ${styles.monoInput}`}
              />
              <Button type="button" onClick={copy}>
                <Icon name="link" size={12} />
                复制
              </Button>
            </div>
          </Field>

          <div className={styles.metaRow}>
            <Badge variant="outline">{ROLE_LABELS[roleVal]}</Badge>
            {groupName && <Badge variant="outline">{groupName}</Badge>}
            <span className={`mono ${styles.expiresAt}`}>
              过期：{new Date(result.expires_at).toLocaleString("zh-CN")}
            </span>
          </div>

          <div className={styles.actions}>
            <Button type="button" onClick={() => setResult(null)}>
              继续邀请
            </Button>
            <Button type="button" variant="primary" onClick={onClose}>
              完成
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <div className={styles.fieldLabel}>{label}</div>
      {children}
    </label>
  );
}

function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.max(0, Math.round(ms / 86400000));
  return `${days} 天`;
}

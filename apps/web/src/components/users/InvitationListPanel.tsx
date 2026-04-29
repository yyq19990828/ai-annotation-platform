import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useInvitations, useResendInvitation, useRevokeInvitation } from "@/hooks/useInvitations";
import { ROLE_LABELS } from "@/constants/roles";
import { usePermissions } from "@/hooks/usePermissions";
import type { InvitationResponse, InvitationStatus } from "@/api/invitations";
import type { UserRole } from "@/types";

const STATUS_FILTERS: Array<{ key: InvitationStatus | "all"; label: string }> = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待接受" },
  { key: "accepted", label: "已接受" },
  { key: "expired", label: "已过期" },
  { key: "revoked", label: "已撤销" },
];

const STATUS_COLORS: Record<InvitationStatus, "success" | "warning" | "outline" | "danger"> = {
  pending: "warning",
  accepted: "success",
  expired: "outline",
  revoked: "danger",
};

const STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: "待接受",
  accepted: "已接受",
  expired: "已过期",
  revoked: "已撤销",
};

export function InvitationListPanel() {
  const { role } = usePermissions();
  const canViewAll = role === "super_admin";
  const [filter, setFilter] = useState<InvitationStatus | "all">("all");
  const [scope, setScope] = useState<"me" | "all">("me");
  const { data: invites = [], isLoading } = useInvitations({ status: filter, scope });
  const revokeMut = useRevokeInvitation();
  const resendMut = useResendInvitation();
  const pushToast = useToastStore((s) => s.push);

  const handleRevoke = async (inv: InvitationResponse) => {
    try {
      await revokeMut.mutateAsync(inv.id);
      pushToast({ msg: `已撤销邀请：${inv.email}`, kind: "success" });
    } catch (err) {
      pushToast({
        msg: "撤销失败",
        sub: err instanceof Error ? err.message : String(err),
        kind: "error",
      });
    }
  };

  const handleResend = async (inv: InvitationResponse) => {
    try {
      const res = await resendMut.mutateAsync(inv.id);
      try {
        await navigator.clipboard.writeText(res.invite_url);
        pushToast({
          msg: `已重发邀请：${inv.email}`,
          sub: "新链接已复制到剪贴板",
          kind: "success",
        });
      } catch {
        pushToast({ msg: `已重发邀请：${inv.email}`, kind: "success" });
      }
    } catch (err) {
      pushToast({
        msg: "重发失败",
        sub: err instanceof Error ? err.message : String(err),
        kind: "error",
      });
    }
  };

  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                borderRadius: "var(--radius-md)",
                border: `1px solid ${filter === f.key ? "var(--color-accent)" : "var(--color-border)"}`,
                background: filter === f.key ? "var(--color-accent-soft)" : "var(--color-bg-elev)",
                color: filter === f.key ? "var(--color-accent)" : "var(--color-fg)",
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        {canViewAll && (
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "me" | "all")}
            style={{
              padding: "5px 8px",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              fontSize: 12.5,
              background: "var(--color-bg-elev)",
            }}
          >
            <option value="me">我邀请的</option>
            <option value="all">全部邀请</option>
          </select>
        )}
      </div>

      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
        <thead>
          <tr>
            {["邮箱", "角色", "数据组", "状态", "邀请人", "过期时间", ""].map((h, i) => (
              <th
                key={i}
                style={{
                  textAlign: "left",
                  fontWeight: 500,
                  fontSize: 11.5,
                  color: "var(--color-fg-muted)",
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--color-border)",
                  background: "var(--color-bg-sunken)",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--color-fg-subtle)" }}>
                加载中…
              </td>
            </tr>
          )}
          {!isLoading && invites.length === 0 && (
            <tr>
              <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--color-fg-subtle)" }}>
                暂无邀请记录
              </td>
            </tr>
          )}
          {invites.map((inv) => {
            const expired = inv.status === "expired";
            const accepted = inv.status === "accepted";
            const revoked = inv.status === "revoked";
            return (
              <tr key={inv.id}>
                <td style={cellStyle}>
                  <span className="mono" style={{ fontSize: 12.5 }}>{inv.email}</span>
                </td>
                <td style={cellStyle}>{ROLE_LABELS[inv.role as UserRole] ?? inv.role}</td>
                <td style={cellStyle}>{inv.group_name ?? "—"}</td>
                <td style={cellStyle}>
                  <Badge variant={STATUS_COLORS[inv.status]}>{STATUS_LABEL[inv.status]}</Badge>
                </td>
                <td style={{ ...cellStyle, color: "var(--color-fg-muted)" }}>{inv.invited_by_name ?? "—"}</td>
                <td style={{ ...cellStyle, fontSize: 12, color: "var(--color-fg-muted)" }}>
                  {new Date(inv.expires_at).toLocaleString("zh-CN")}
                </td>
                <td style={{ ...cellStyle, textAlign: "right" }}>
                  {!accepted && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleResend(inv)}
                        disabled={resendMut.isPending}
                        title="重发邀请（生成新链接并复制）"
                      >
                        <Icon name="refresh" size={11} />
                        {revoked || expired ? "重发" : "重发"}
                      </Button>
                      {!revoked && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRevoke(inv)}
                          disabled={revokeMut.isPending}
                          title="撤销邀请"
                        >
                          <Icon name="x" size={11} />
                        </Button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  padding: "10px 10px",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "middle",
};

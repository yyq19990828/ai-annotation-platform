import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { StatCard } from "@/components/ui/StatCard";
import { SearchInput } from "@/components/ui/SearchInput";
import { TabRow } from "@/components/ui/TabRow";
import { useToastStore } from "@/components/ui/Toast";
import { useUsers } from "@/hooks/useUsers";
import { useGroups } from "@/hooks/useGroups";
import { ROLE_LABELS, ROLE_DESC } from "@/constants/roles";
import { ROLE_PERMISSIONS, PERMISSION_LABELS, PERMISSION_GROUPS, type Permission } from "@/constants/permissions";
import { Can } from "@/components/guards/Can";
import { InviteUserModal } from "@/components/users/InviteUserModal";
import { EditUserModal } from "@/components/users/EditUserModal";
import { GroupManageModal } from "@/components/users/GroupManageModal";
import { InvitationListPanel } from "@/components/users/InvitationListPanel";
import { usersApi, type UserResponse } from "@/api/users";
import type { UserRole } from "@/types";

const ROLE_COLORS: Record<string, "accent" | "ai" | "warning" | "success" | "outline" | "danger"> = {
  super_admin: "danger",
  project_admin: "accent",
  reviewer: "ai",
  annotator: "outline",
  viewer: "success",
};

const STATUS_LABEL: Record<string, string> = {
  online: "在线",
  offline: "离线",
  busy: "忙碌",
};

const STATUS_COLORS: Record<string, "success" | "warning" | "outline"> = {
  "在线": "success",
  "忙碌": "warning",
  "离线": "outline",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("zh-CN");
}

export function UsersPage() {
  const [tab, setTab] = useState<"members" | "roles" | "groups" | "invitations">("members");
  const [selectedRole, setSelectedRole] = useState("全部");
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<UserResponse | null>(null);
  const [manageGroupsOpen, setManageGroupsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const { data: allUsers = [], isLoading } = useUsers();
  const { data: groupsData = [] } = useGroups();

  const filtered = allUsers.filter((u: UserResponse) => {
    if (selectedRole !== "全部" && u.role !== selectedRole) return false;
    if (query && !u.name.includes(query) && !u.email.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await usersApi.exportUsers("csv");
      pushToast({ msg: "已导出名单 CSV", kind: "success" });
    } catch (err) {
      pushToast({
        msg: "导出失败",
        sub: err instanceof Error ? err.message : String(err),
        kind: "error",
      });
    } finally {
      setExporting(false);
    }
  };

  const roleKeys = Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>;

  const tabLabels: Array<["members" | "roles" | "groups" | "invitations", string]> = [
    ["members", `成员 (${allUsers.length})`],
    ["roles", `角色 (${roleKeys.length})`],
    ["groups", `数据组 (${groupsData.length})`],
    ["invitations", "邀请记录"],
  ];
  const activeLabel = tabLabels.find(([k]) => k === tab)?.[1] ?? tabLabels[0][1];

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>用户与权限</h1>
          <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>管理团队成员、角色权限与数据组分配</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button disabled title="规划中：API 密钥模型尚未建表"><Icon name="key" size={13} />API 密钥</Button>
          <Can permission="user.export">
            <Button onClick={handleExport} disabled={exporting}>
              <Icon name="download" size={13} />{exporting ? "导出中…" : "导出名单"}
            </Button>
          </Can>
          <Can permission="user.invite">
            <Button variant="primary" onClick={() => setInviteOpen(true)}>
              <Icon name="plus" size={13} />邀请成员
            </Button>
          </Can>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard icon="users" label="团队成员" value={allUsers.length} hint="活跃" sparkValues={[8, 9, 9, 10, 10, 11, 11, 11, 12, 12, 12, 12]} sparkColor="var(--color-accent)" />
        <StatCard icon="shield" label="角色组" value={roleKeys.length} hint="自定义" />
        <StatCard icon="folder" label="数据组" value={groupsData.length} hint="可分配" />
        <StatCard icon="activity" label="本周活跃" value={allUsers.filter((u: UserResponse) => u.status === "online").length} hint="在线" sparkValues={[6, 7, 8, 7, 9, 10, 11, 9]} sparkColor="var(--color-ai)" />
      </div>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <TabRow
            tabs={tabLabels.map(([, l]) => l)}
            active={activeLabel}
            onChange={(t) => {
              const found = tabLabels.find(([, l]) => l === t);
              if (found) setTab(found[0]);
            }}
          />
          {tab === "members" && (
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                style={{ padding: "5px 8px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", fontSize: 12.5, background: "var(--color-bg-elev)" }}
              >
                <option>全部</option>
                {roleKeys.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
              </select>
              <SearchInput placeholder="搜索姓名或邮箱..." value={query} onChange={setQuery} width={240} />
            </div>
          )}
          {tab === "groups" && (
            <Can permission="group.manage">
              <Button onClick={() => setManageGroupsOpen(true)}>
                <Icon name="settings" size={12} /> 管理数据组
              </Button>
            </Can>
          )}
        </div>

        {tab === "members" && (
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
            <thead>
              <tr>
                {["成员", "角色", "数据组", "状态", "近期标注量", "准确率", "加入时间", ""].map((h, i) => (
                  <th key={i} style={{
                    textAlign: "left", fontWeight: 500, fontSize: 12,
                    color: "var(--color-fg-muted)", padding: "10px 12px",
                    borderBottom: "1px solid var(--color-border)",
                    background: "var(--color-bg-sunken)",
                    ...(i === 0 ? { paddingLeft: 16 } : {}),
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 40, color: "var(--color-fg-subtle)" }}>加载中...</td>
                </tr>
              )}
              {filtered.map((u: UserResponse) => {
                const statusLabel = STATUS_LABEL[u.status] ?? u.status;
                return (
                  <tr key={u.id}>
                    <td style={{ padding: "12px 12px 12px 16px", borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Avatar initial={u.name[0]} size="md" />
                        <div>
                          <div style={{ fontWeight: 500, fontSize: 13.5 }}>{u.name}</div>
                          <div className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
                      <Badge variant={ROLE_COLORS[u.role] || "outline"}>{ROLE_LABELS[u.role as UserRole] ?? u.role}</Badge>
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle", fontSize: 12.5 }}>
                      {u.group_name ?? "—"}
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
                      <Badge variant={STATUS_COLORS[statusLabel] || "outline"} dot>{statusLabel}</Badge>
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
                      <span style={{ color: "var(--color-fg-subtle)", fontSize: 12 }}>—</span>
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
                      <span style={{ color: "var(--color-fg-subtle)", fontSize: 12 }}>—</span>
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle", fontSize: 12, color: "var(--color-fg-muted)" }}>
                      {formatDate(u.created_at)}
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", textAlign: "right", verticalAlign: "middle" }}>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(u)} title="编辑成员">
                        <Icon name="edit" size={11} />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {tab === "roles" && (
          <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {roleKeys.map((rk) => {
              const perms = ROLE_PERMISSIONS[rk];
              const permsSet = new Set<Permission>(perms);
              const memberCount = allUsers.filter((u: UserResponse) => u.role === rk).length;
              return (
                <div key={rk} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", padding: 14, background: "var(--color-bg-elev)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Badge variant={ROLE_COLORS[rk] || "outline"} style={{ fontSize: 12, padding: "3px 10px" }}>
                      {ROLE_LABELS[rk] ?? rk}
                    </Badge>
                    <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{memberCount} 人</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--color-fg-muted)", marginBottom: 10 }}>{ROLE_DESC[rk]}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {PERMISSION_GROUPS.map((group) => {
                      const granted = group.perms.filter((p) => permsSet.has(p));
                      const denied = group.perms.filter((p) => !permsSet.has(p));
                      if (granted.length === 0 && denied.length === 0) return null;
                      return (
                        <div key={group.key}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-fg-subtle)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
                            {group.title}
                          </div>
                          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                            {granted.map((p) => (
                              <Badge key={p} variant="success" style={{ fontSize: 10 }}>
                                <Icon name="check" size={9} />{PERMISSION_LABELS[p]}
                              </Badge>
                            ))}
                            {denied.map((p) => (
                              <Badge key={p} variant="outline" style={{ fontSize: 10, opacity: 0.4 }}>
                                {PERMISSION_LABELS[p]}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "groups" && (
          <div style={{ padding: 16 }}>
            {groupsData.length === 0 && (
              <div style={{ padding: 30, textAlign: "center", color: "var(--color-fg-muted)", fontSize: 13 }}>
                暂无数据组。<Can permission="group.manage"><a onClick={() => setManageGroupsOpen(true)} style={{ cursor: "pointer", color: "var(--color-accent)" }}>新建一个</a></Can>
              </div>
            )}
            {groupsData.map((g) => {
              const members = allUsers.filter((u: UserResponse) => u.group_id === g.id);
              return (
                <div key={g.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "12px 14px", border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)", marginBottom: 8, background: "var(--color-bg-elev)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Icon name="folder" size={18} style={{ color: "var(--color-fg-muted)" }} />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13.5 }}>{g.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)" }}>{members.length} 名成员{g.description ? ` · ${g.description}` : ""}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex" }}>
                    {members.slice(0, 5).map((m, i) => (
                      <Avatar key={m.id} initial={m.name[0]} size="sm" style={{ marginLeft: i ? -6 : 0, border: "2px solid var(--color-bg-elev)" }} />
                    ))}
                    {members.length > 5 && (
                      <Avatar initial={`+${members.length - 5}`} size="sm" style={{ marginLeft: -6, border: "2px solid var(--color-bg-elev)", background: "var(--color-bg-sunken)", color: "var(--color-fg-muted)" }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "invitations" && <InvitationListPanel />}
      </Card>

      <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <EditUserModal open={!!editing} user={editing} onClose={() => setEditing(null)} />
      <GroupManageModal open={manageGroupsOpen} onClose={() => setManageGroupsOpen(false)} />
    </div>
  );
}

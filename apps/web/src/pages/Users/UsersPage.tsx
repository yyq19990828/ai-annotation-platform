import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { StatCard } from "@/components/ui/StatCard";
import { SearchInput } from "@/components/ui/SearchInput";
import { TabRow } from "@/components/ui/TabRow";
import { useToastStore } from "@/components/ui/Toast";
import { useUsers, useDeleteUser } from "@/hooks/useUsers";
import { useGroups } from "@/hooks/useGroups";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuthStore } from "@/stores/authStore";
import { ROLE_LABELS, ROLE_DESC } from "@/constants/roles";
import { ROLE_PERMISSIONS, PERMISSION_LABELS, PERMISSION_GROUPS, type Permission } from "@/constants/permissions";
import { Can } from "@/components/guards/Can";
import { InviteUserModal } from "@/components/users/InviteUserModal";
import { EditUserModal } from "@/components/users/EditUserModal";
import { GroupManageModal } from "@/components/users/GroupManageModal";
import { InvitationListPanel } from "@/components/users/InvitationListPanel";
import { usersApi, type UserResponse } from "@/api/users";
import { ApiError } from "@/api/client";
import type { UserRole } from "@/types";

// actor.role × target.role → 可点"编辑"（即可改角色或可删）
const EDITABLE_TARGET_ROLES_BY_ACTOR: Record<UserRole, UserRole[]> = {
  super_admin: ["super_admin", "project_admin", "reviewer", "annotator", "viewer"],
  project_admin: ["reviewer", "annotator"],
  reviewer: [],
  annotator: [],
  viewer: [],
};

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
  const [deleting, setDeleting] = useState<UserResponse | null>(null);
  const [resettingPwd, setResettingPwd] = useState<UserResponse | null>(null);
  const [tempPwdResult, setTempPwdResult] = useState<{ user: UserResponse; password: string } | null>(null);
  const [pwdResetSubmitting, setPwdResetSubmitting] = useState(false);
  /** 后端 409 返回的待转交任务详情（pending_task_count / locked_task_count / sample_task_ids）。 */
  const [transferStage, setTransferStage] = useState<{
    pending: number;
    locked: number;
    sample: string[];
  } | null>(null);
  const [transferToId, setTransferToId] = useState<string>("");
  const [manageGroupsOpen, setManageGroupsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pushToast = useToastStore((s) => s.push);
  const deleteUser = useDeleteUser();
  const navigate = useNavigate();
  const { role: actorRole, hasPermission } = usePermissions();
  const me = useAuthStore((s) => s.user);
  const editableTargets = EDITABLE_TARGET_ROLES_BY_ACTOR[actorRole] ?? [];
  const canViewAudit = hasPermission("audit.view");

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
                      <div style={{ display: "inline-flex", gap: 2 }}>
                        {canViewAudit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/audit?actor_id=${u.id}`)}
                            title={`查看 ${u.name} 的审计追溯`}
                          >
                            <Icon name="activity" size={11} />
                          </Button>
                        )}
                        {me?.id !== u.id && editableTargets.includes(u.role as UserRole) ? (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => setEditing(u)} title="编辑成员">
                              <Icon name="edit" size={11} />
                            </Button>
                            {u.is_active && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setResettingPwd(u)}
                                title="重置密码"
                              >
                                <Icon name="key" size={11} />
                              </Button>
                            )}
                            {u.is_active && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleting(u)}
                                title="删除账号"
                              >
                                <Icon name="trash" size={11} style={{ color: "var(--color-danger)" }} />
                              </Button>
                            )}
                          </>
                        ) : (
                          <Button variant="ghost" size="sm" disabled title={me?.id === u.id ? "不能修改自己" : "无权修改该用户"}>
                            <Icon name="edit" size={11} style={{ opacity: 0.4 }} />
                          </Button>
                        )}
                      </div>
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

      <Modal
        open={!!resettingPwd}
        onClose={() => {
          if (pwdResetSubmitting) return;
          setResettingPwd(null);
        }}
        title="重置用户密码"
        width={460}
      >
        {resettingPwd && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
            <div style={{ color: "var(--color-fg-muted)" }}>
              将为以下用户生成一次性临时密码。请通过安全渠道（IM / 当面）告知用户，
              并提醒首次登录后立即修改密码。
            </div>
            <div style={{
              padding: "10px 12px",
              background: "var(--color-bg-sunken)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <Avatar initial={resettingPwd.name[0]} size="md" />
              <div>
                <div style={{ fontWeight: 500 }}>{resettingPwd.name}</div>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--color-fg-subtle)" }}>{resettingPwd.email}</div>
              </div>
              <Badge variant={ROLE_COLORS[resettingPwd.role] || "outline"} style={{ marginLeft: "auto" }}>
                {ROLE_LABELS[resettingPwd.role as UserRole] ?? resettingPwd.role}
              </Badge>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button onClick={() => setResettingPwd(null)} disabled={pwdResetSubmitting}>取消</Button>
              <Button
                variant="primary"
                disabled={pwdResetSubmitting}
                onClick={async () => {
                  if (!resettingPwd) return;
                  setPwdResetSubmitting(true);
                  try {
                    const r = await usersApi.adminResetPassword(resettingPwd.id);
                    setTempPwdResult({ user: resettingPwd, password: r.temp_password });
                    setResettingPwd(null);
                  } catch (e) {
                    pushToast({ msg: "重置失败", sub: (e as Error).message, kind: "warning" });
                  } finally {
                    setPwdResetSubmitting(false);
                  }
                }}
              >
                {pwdResetSubmitting ? "生成中..." : "生成临时密码"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!tempPwdResult}
        onClose={() => setTempPwdResult(null)}
        title="临时密码已生成"
        width={460}
      >
        {tempPwdResult && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
            <div style={{ color: "var(--color-fg-muted)" }}>
              请立即复制并通过安全渠道告知 <b>{tempPwdResult.user.email}</b>。
              关闭此窗口后无法再次查看；用户首次登录后系统会强制要求修改密码。
            </div>
            <div style={{
              padding: 12,
              background: "var(--color-bg-sunken)",
              border: "1px dashed var(--color-warning)",
              borderRadius: "var(--radius-md)",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 14,
              fontWeight: 500,
              userSelect: "all",
              wordBreak: "break-all",
            }}>
              {tempPwdResult.password}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(tempPwdResult.password);
                    pushToast({ msg: "已复制到剪贴板", kind: "success" });
                  } catch {
                    pushToast({ msg: "复制失败，请手动选择文本", kind: "warning" });
                  }
                }}
              >
                复制
              </Button>
              <Button variant="primary" onClick={() => setTempPwdResult(null)}>
                我已记下，关闭
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => {
          if (deleteUser.isPending) return;
          setDeleting(null);
          setTransferStage(null);
          setTransferToId("");
          deleteUser.reset();
        }}
        title={transferStage ? "先转交未完成任务" : "删除账号确认"}
        width={520}
      >
        {deleting && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
            <div style={{ color: "var(--color-fg-muted)" }}>
              {transferStage
                ? "该用户当前持有未完成任务或锁定任务；删除前请选择一名接收者，所有任务将被转交。"
                : "确认删除以下账号？该用户将无法登录，但历史标注与审计记录仍会保留。"}
            </div>
            <div style={{
              padding: "10px 12px",
              background: "var(--color-bg-sunken)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <Avatar initial={deleting.name[0]} size="md" />
              <div>
                <div style={{ fontWeight: 500 }}>{deleting.name}</div>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--color-fg-subtle)" }}>{deleting.email}</div>
              </div>
              <Badge variant={ROLE_COLORS[deleting.role] || "outline"} style={{ marginLeft: "auto" }}>
                {ROLE_LABELS[deleting.role as UserRole] ?? deleting.role}
              </Badge>
            </div>

            {transferStage && (
              <>
                <div style={{
                  padding: "10px 12px",
                  background: "rgba(245,158,11,0.08)",
                  border: "1px solid var(--color-warning)",
                  borderRadius: "var(--radius-md)",
                  fontSize: 12.5,
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <div>
                    <Icon name="warning" size={12} /> 未完成任务 <strong>{transferStage.pending}</strong> 个
                    {transferStage.locked > 0 && <> · 锁定任务 <strong>{transferStage.locked}</strong> 个</>}
                  </div>
                  {transferStage.sample.length > 0 && (
                    <div className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
                      示例：{transferStage.sample.slice(0, 3).join(", ")}
                      {transferStage.sample.length > 3 && " ..."}
                    </div>
                  )}
                </div>
                <div>
                  <label style={{
                    display: "block", fontSize: 12, fontWeight: 500,
                    color: "var(--color-fg-muted)", marginBottom: 6,
                  }}>
                    转交给（同项目活跃用户）
                  </label>
                  <select
                    value={transferToId}
                    onChange={(e) => setTransferToId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 11px",
                      fontSize: 13,
                      background: "var(--color-bg-elev)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                      color: "var(--color-fg)",
                      outline: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <option value="">— 选择接收用户 —</option>
                    {allUsers
                      .filter((u: UserResponse) =>
                        u.id !== deleting.id &&
                        u.is_active &&
                        (u.role === "annotator" || u.role === "reviewer" || u.role === "project_admin"))
                      .map((u: UserResponse) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({ROLE_LABELS[u.role as UserRole] ?? u.role}) · {u.email}
                        </option>
                      ))}
                  </select>
                </div>
              </>
            )}

            {deleteUser.error && (
              <div style={{
                padding: "8px 12px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid #ef4444",
                borderRadius: "var(--radius-md)",
                color: "#ef4444",
                fontSize: 12.5,
              }}>
                <Icon name="warning" size={12} /> {(deleteUser.error as Error)?.message ?? "删除失败"}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button
                onClick={() => {
                  setDeleting(null);
                  setTransferStage(null);
                  setTransferToId("");
                  deleteUser.reset();
                }}
                disabled={deleteUser.isPending}
              >
                取消
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  try {
                    await deleteUser.mutateAsync({
                      userId: deleting.id,
                      transferToUserId: transferStage ? transferToId || undefined : undefined,
                    });
                    pushToast({
                      msg: transferStage
                        ? `已删除 ${deleting.name}，任务已转交`
                        : `已删除账号 ${deleting.name}`,
                      kind: "success",
                    });
                    setDeleting(null);
                    setTransferStage(null);
                    setTransferToId("");
                  } catch (err) {
                    // 检测 409 + has_pending_tasks → 切到二阶段
                    if (err instanceof ApiError && err.status === 409) {
                      const raw = err.detailRaw as
                        | { reason?: string; pending_task_count?: number; locked_task_count?: number; sample_task_ids?: string[] }
                        | undefined;
                      if (raw?.reason === "has_pending_tasks") {
                        setTransferStage({
                          pending: raw.pending_task_count ?? 0,
                          locked: raw.locked_task_count ?? 0,
                          sample: raw.sample_task_ids ?? [],
                        });
                        deleteUser.reset();
                        return;
                      }
                    }
                    void err;
                  }
                }}
                disabled={deleteUser.isPending || (transferStage !== null && !transferToId)}
              >
                <Icon name="trash" size={12} />
                {deleteUser.isPending
                  ? (transferStage ? "转交并删除中…" : "删除中…")
                  : transferStage
                  ? "转交并删除"
                  : "确认删除"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

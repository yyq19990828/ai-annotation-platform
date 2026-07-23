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
import { useUsers, useDeleteUser, useUsersStats } from "@/hooks/useUsers";
import { useGroups } from "@/hooks/useGroups";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuthStore } from "@/stores/authStore";
import { ROLE_LABELS, ROLE_DESC } from "@/constants/roles";
import {
  ROLE_PERMISSIONS,
  PERMISSION_LABELS,
  PERMISSION_GROUPS,
  type Permission,
} from "@/constants/permissions";
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

const ROLE_COLORS: Record<string, "accent" | "ai" | "warning" | "success" | "outline" | "danger"> =
  {
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
  在线: "success",
  忙碌: "warning",
  离线: "outline",
};

// 表头单元 / 主表数据单元
const TH_CLASS =
  "border-b border-border bg-muted px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap";
const TD_CLASS = "border-b border-border p-3 align-middle";
// 弹窗内成员摘要卡 / 选择框基线
const SELECT_BASE =
  "appearance-none rounded-md border border-border bg-card text-foreground [font:inherit] outline-none";
const SUMMARY_CARD_CLASS =
  "flex items-center gap-2.5 rounded-md border border-border bg-muted px-3 py-2.5";

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
  const [tempPwdResult, setTempPwdResult] = useState<{
    user: UserResponse;
    password: string;
  } | null>(null);
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
  const { data: usersStats } = useUsersStats();

  const filtered = allUsers.filter((u: UserResponse) => {
    if (selectedRole !== "全部" && u.role !== selectedRole) return false;
    if (query && !u.name.includes(query) && !u.email.toLowerCase().includes(query.toLowerCase()))
      return false;
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
    <div className="mx-auto max-w-[1480px] px-7 pb-10 pt-5 text-foreground">
      <div className="mb-5 flex items-end justify-between gap-6">
        <div>
          <h1 className="mb-1 text-xl font-semibold">用户与权限</h1>
          <p className="text-sm text-muted-foreground">管理团队成员、角色权限与数据组分配</p>
        </div>
        <div className="flex gap-2">
          <Can permission="user.export">
            <Button onClick={handleExport} disabled={exporting}>
              <Icon name="download" size={13} />
              {exporting ? "导出中…" : "导出名单"}
            </Button>
          </Can>
          <Can permission="user.invite">
            <Button variant="primary" onClick={() => setInviteOpen(true)}>
              <Icon name="plus" size={13} />
              邀请成员
            </Button>
          </Can>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <StatCard
          icon="users"
          label="团队成员"
          value={allUsers.length}
          hint="活跃"
          sparkValues={[8, 9, 9, 10, 10, 11, 11, 11, 12, 12, 12, 12]}
          sparkColor="var(--sc-brand)"
        />
        <StatCard icon="shield" label="角色组" value={roleKeys.length} hint="自定义" />
        <StatCard icon="folder" label="数据组" value={groupsData.length} hint="可分配" />
        <StatCard
          icon="activity"
          label="本周活跃"
          value={usersStats?.weekly_active ?? "—"}
          hint={usersStats ? `在线 ${usersStats.online}` : "近 7 日"}
          sparkValues={[6, 7, 8, 7, 9, 10, 11, 9]}
          sparkColor="var(--sc-chart-4)"
        />
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <TabRow
            tabs={tabLabels.map(([, l]) => l)}
            active={activeLabel}
            onChange={(t) => {
              const found = tabLabels.find(([, l]) => l === t);
              if (found) setTab(found[0]);
            }}
          />
          {tab === "members" && (
            <div className="flex gap-2">
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className={`${SELECT_BASE} px-2 py-1.5 text-sm`}
              >
                <option>全部</option>
                {roleKeys.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r] ?? r}
                  </option>
                ))}
              </select>
              <SearchInput
                placeholder="搜索姓名或邮箱..."
                value={query}
                onChange={setQuery}
                width={240}
              />
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {["成员", "角色", "数据组", "状态", "近期标注量", "准确率", "加入时间", ""].map(
                    (h, i) => (
                      <th key={i} className={`${TH_CLASS} ${i === 0 ? "pl-4" : ""}`}>
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-muted-foreground">
                      加载中...
                    </td>
                  </tr>
                )}
                {filtered.map((u: UserResponse) => {
                  const statusLabel = STATUS_LABEL[u.status] ?? u.status;
                  return (
                    <tr key={u.id}>
                      <td className={`${TD_CLASS} pl-4`}>
                        <div className="flex items-center gap-2.5">
                          <Avatar initial={u.name[0]} size="md" />
                          <div className="min-w-0">
                            <div className="max-w-[240px] truncate text-sm font-medium">
                              {u.name}
                            </div>
                            <div className="mono max-w-[240px] truncate text-xs text-muted-foreground">
                              {u.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={TD_CLASS}>
                        <Badge variant={ROLE_COLORS[u.role] || "outline"}>
                          {ROLE_LABELS[u.role as UserRole] ?? u.role}
                        </Badge>
                      </td>
                      <td className={`${TD_CLASS} max-w-[160px] truncate`}>
                        {u.group_name ?? "—"}
                      </td>
                      <td className={TD_CLASS}>
                        <Badge variant={STATUS_COLORS[statusLabel] || "outline"} dot>
                          {statusLabel}
                        </Badge>
                      </td>
                      <td className={TD_CLASS}>
                        <span className="text-xs text-muted-foreground">—</span>
                      </td>
                      <td className={TD_CLASS}>
                        <span className="text-xs text-muted-foreground">—</span>
                      </td>
                      <td className={`${TD_CLASS} text-xs text-muted-foreground`}>
                        {formatDate(u.created_at)}
                      </td>
                      <td className={`${TD_CLASS} whitespace-nowrap text-right`}>
                        <div className="inline-flex gap-0.5 whitespace-nowrap">
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
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditing(u)}
                                title="编辑成员"
                              >
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
                                  <Icon name="trash" size={11} className="text-status-danger" />
                                </Button>
                              )}
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled
                              title={me?.id === u.id ? "不能修改自己" : "无权修改该用户"}
                            >
                              <Icon name="edit" size={11} className="opacity-40" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === "roles" && (
          <div className="grid grid-cols-2 gap-3 p-4">
            {roleKeys.map((rk) => {
              const perms = ROLE_PERMISSIONS[rk];
              const permsSet = new Set<Permission>(perms);
              const memberCount = allUsers.filter((u: UserResponse) => u.role === rk).length;
              return (
                <div key={rk} className="rounded-lg border border-border bg-card p-3.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Badge variant={ROLE_COLORS[rk] || "outline"}>{ROLE_LABELS[rk] ?? rk}</Badge>
                    <span className="mono text-xs text-muted-foreground">{memberCount} 人</span>
                  </div>
                  <div className="mb-2.5 text-sm text-muted-foreground">{ROLE_DESC[rk]}</div>
                  <div className="flex flex-col gap-2">
                    {PERMISSION_GROUPS.map((group) => {
                      const granted = group.perms.filter((p) => permsSet.has(p));
                      const denied = group.perms.filter((p) => !permsSet.has(p));
                      if (granted.length === 0 && denied.length === 0) return null;
                      return (
                        <div key={group.key}>
                          <div className="mb-1 text-2xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">
                            {group.title}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {granted.map((p) => (
                              <Badge key={p} variant="success">
                                <Icon name="check" size={9} />
                                {PERMISSION_LABELS[p]}
                              </Badge>
                            ))}
                            {denied.map((p) => (
                              <Badge key={p} variant="outline">
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
          <div className="p-4">
            {groupsData.length === 0 && (
              <div className="p-7.5 text-center text-sm text-muted-foreground">
                暂无数据组。
                <Can permission="group.manage">
                  <a
                    onClick={() => setManageGroupsOpen(true)}
                    className="cursor-pointer text-brand"
                  >
                    新建一个
                  </a>
                </Can>
              </div>
            )}
            {groupsData.map((g) => {
              const members = allUsers.filter((u: UserResponse) => u.group_id === g.id);
              return (
                <div
                  key={g.id}
                  className="mb-2 flex items-center justify-between rounded-md border border-border bg-card px-3.5 py-3"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="folder" size={18} className="text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">{g.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {members.length} 名成员{g.description ? ` · ${g.description}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex [&>div+div]:-ml-1.5 [&>div]:border-2 [&>div]:border-card">
                    {members.slice(0, 5).map((m) => (
                      <Avatar key={m.id} initial={m.name[0]} size="sm" />
                    ))}
                    {members.length > 5 && <Avatar initial={`+${members.length - 5}`} size="sm" />}
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
          <div className="flex flex-col gap-3.5 text-sm">
            <div className="text-muted-foreground">
              将为以下用户生成一次性临时密码。请通过安全渠道（IM / 当面）告知用户，
              并提醒首次登录后立即修改密码。
            </div>
            <div className={SUMMARY_CARD_CLASS}>
              <Avatar initial={resettingPwd.name[0]} size="md" />
              <div>
                <div className="text-sm font-medium">{resettingPwd.name}</div>
                <div className="mono text-xs text-muted-foreground">{resettingPwd.email}</div>
              </div>
              <span className="ml-auto">
                <Badge variant={ROLE_COLORS[resettingPwd.role] || "outline"}>
                  {ROLE_LABELS[resettingPwd.role as UserRole] ?? resettingPwd.role}
                </Badge>
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setResettingPwd(null)} disabled={pwdResetSubmitting}>
                取消
              </Button>
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
          <div className="flex flex-col gap-3.5 text-sm">
            <div className="text-muted-foreground">
              请立即复制并通过安全渠道告知 <b>{tempPwdResult.user.email}</b>。
              关闭此窗口后无法再次查看；用户首次登录后系统会强制要求修改密码。
            </div>
            <div className="break-all rounded-md border border-dashed border-amber-500 bg-muted p-3 font-mono text-sm font-medium select-all">
              {tempPwdResult.password}
            </div>
            <div className="flex justify-end gap-2">
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
          <div className="flex flex-col gap-3.5 text-sm">
            <div className="text-muted-foreground">
              {transferStage
                ? "该用户当前持有未完成任务或锁定任务；删除前请选择一名接收者，所有任务将被转交。"
                : "确认删除以下账号？该用户将无法登录，但历史标注与审计记录仍会保留。"}
            </div>
            <div className={SUMMARY_CARD_CLASS}>
              <Avatar initial={deleting.name[0]} size="md" />
              <div>
                <div className="text-sm font-medium">{deleting.name}</div>
                <div className="mono text-xs text-muted-foreground">{deleting.email}</div>
              </div>
              <span className="ml-auto">
                <Badge variant={ROLE_COLORS[deleting.role] || "outline"}>
                  {ROLE_LABELS[deleting.role as UserRole] ?? deleting.role}
                </Badge>
              </span>
            </div>

            {transferStage && (
              <>
                <div className="flex flex-col gap-1 rounded-md border border-amber-500 bg-status-caution-soft px-3 py-2.5 text-sm">
                  <div>
                    <Icon name="warning" size={12} /> 未完成任务{" "}
                    <strong>{transferStage.pending}</strong> 个
                    {transferStage.locked > 0 && (
                      <>
                        {" "}
                        · 锁定任务 <strong>{transferStage.locked}</strong> 个
                      </>
                    )}
                  </div>
                  {transferStage.sample.length > 0 && (
                    <div className="mono text-xs text-muted-foreground">
                      示例：{transferStage.sample.slice(0, 3).join(", ")}
                      {transferStage.sample.length > 3 && " ..."}
                    </div>
                  )}
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    转交给（同项目活跃用户）
                  </label>
                  <select
                    value={transferToId}
                    onChange={(e) => setTransferToId(e.target.value)}
                    className={`${SELECT_BASE} w-full cursor-pointer px-2.5 py-2 text-sm`}
                  >
                    <option value="">— 选择接收用户 —</option>
                    {allUsers
                      .filter(
                        (u: UserResponse) =>
                          u.id !== deleting.id &&
                          u.is_active &&
                          (u.role === "annotator" ||
                            u.role === "reviewer" ||
                            u.role === "project_admin"),
                      )
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
              <div className="flex items-center gap-2 rounded-md border border-rose-500 bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
                <Icon name="warning" size={12} />{" "}
                {(deleteUser.error as Error)?.message ?? "删除失败"}
              </div>
            )}
            <div className="flex justify-end gap-2">
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
                        | {
                            reason?: string;
                            pending_task_count?: number;
                            locked_task_count?: number;
                            sample_task_ids?: string[];
                          }
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
                  ? transferStage
                    ? "转交并删除中…"
                    : "删除中…"
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

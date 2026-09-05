import { useState, useEffect } from "react";
import { clsx } from "clsx";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/components/ui/Toast";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuthStore } from "@/stores/authStore";
import {
  useChangePassword,
  useUpdateProfile,
  useRequestDeactivation,
  useCancelDeactivation,
} from "@/hooks/useMe";
import { useSystemSettings, useUpdateSystemSettings, useTestSmtp } from "@/hooks/useSystemSettings";
import type { SystemSettingsPatch } from "@/api/settings";
import { ROLE_LABELS } from "@/constants/roles";
import { bugReportsApi, type BugReportResponse } from "@/api/bug-reports";
import { notificationsApi, type NotificationPreferenceItem } from "@/api/notifications";
import { useWorkbenchConfig } from "@/pages/Workbench/state/useWorkbenchConfig";
import { SettingsFieldControl } from "@/pages/Workbench/components/SettingsFieldControl";
import { ApiKeysPanel } from "@/components/users/ApiKeysPanel";
import { ConnectorAllowlistSettings } from "@/components/connections/ConnectorAllowlistSettings";
import {
  getVisibleWorkbenchSettingFields,
  groupWorkbenchSettings,
  buildFieldPatch,
  getFieldValue,
  isLocalSettingField,
  type WorkbenchSettingField,
  type WorkbenchSettingValue,
} from "@/pages/Workbench/state/workbenchSettingsFields";
import type { UserRole } from "@/types";

type SectionKey = "profile" | "workbench" | "apikeys" | "feedback" | "notifications" | "system";

// 共用类
const FORM_CLASS = "flex flex-col gap-3.5 p-4";
const LABEL_CLASS = "mb-[5px] text-xs font-medium text-muted-foreground";
const GROUP_LABEL_CLASS = "mb-2 text-xs font-medium text-muted-foreground";
const INPUT_CLASS =
  "box-border w-full appearance-none rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none";
const INPUT_BUTTON_CLASS =
  "w-auto cursor-pointer rounded-md border border-border bg-card px-3.5 py-2 text-sm text-foreground disabled:cursor-not-allowed";
const ACTIONS_END_CLASS = "flex justify-end";
const SECTION_HEADER_CLASS = "flex items-center justify-between border-b border-border px-4 py-3";

export function SettingsPage() {
  const { role } = usePermissions();
  const isAdmin = role === "super_admin";
  const [section, setSection] = useState<SectionKey>("profile");

  const sections: {
    key: SectionKey;
    label: string;
    icon: "user" | "flag" | "bell" | "settings" | "image" | "key";
  }[] = [
    { key: "profile", label: "个人资料", icon: "user" },
    { key: "workbench", label: "标注偏好", icon: "image" },
    { key: "apikeys", label: "API 密钥", icon: "key" },
    { key: "feedback", label: "我的反馈", icon: "flag" },
    { key: "notifications", label: "通知偏好", icon: "bell" },
    ...(isAdmin
      ? [{ key: "system" as SectionKey, label: "系统设置", icon: "settings" as const }]
      : []),
  ];

  return (
    <div className="mx-auto max-w-[1100px] px-7 pb-10 pt-5 text-foreground max-[760px]:p-4">
      <header className="mb-4">
        <h1 className="mb-1 text-xl font-semibold">设置</h1>
        <p className="text-sm text-muted-foreground">管理你的账号信息与平台配置</p>
      </header>

      <div className="grid grid-cols-[200px_1fr] gap-4 max-[760px]:grid-cols-1">
        <nav>
          <Card>
            <ul className="m-0 list-none p-1.5">
              {sections.map((s) => {
                const active = section === s.key;
                return (
                  <li key={s.key}>
                    <button
                      onClick={() => setSection(s.key)}
                      className={clsx(
                        "flex w-full cursor-pointer appearance-none items-center gap-2 rounded-md border-0 bg-transparent px-3 py-2.5 text-left text-sm font-medium max-[760px]:whitespace-nowrap",
                        active ? "bg-muted font-semibold text-foreground" : "text-muted-foreground",
                      )}
                    >
                      <Icon name={s.icon} size={13} />
                      {s.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </nav>

        {/* grid 1fr 列默认 min-width:auto，会被内部宽表格(API 密钥)撑超页宽；min-w-0 让超宽表格由内部 overflow-x 滚动 */}
        <div className="min-w-0">
          {section === "profile" && <ProfileSection />}
          {section === "workbench" && <WorkbenchPreferencesSection />}
          {section === "apikeys" && <ApiKeysSection />}
          {section === "feedback" && <MyFeedbackSection />}
          {section === "notifications" && <NotificationPreferencesSection />}
          {section === "system" && isAdmin && (
            <div className="flex flex-col gap-4">
              <SystemSection />
              <ConnectorAllowlistSettings />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileSection() {
  const user = useAuthStore((s) => s.user);
  const pushToast = useToastStore((s) => s.push);
  const updateProfile = useUpdateProfile();
  const changePwd = useChangePassword();

  const [name, setName] = useState(user?.name ?? "");
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [newPwd2, setNewPwd2] = useState("");

  if (!user) return null;

  const submitName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name === user.name) return;
    updateProfile.mutate(
      { name: name.trim() },
      { onSuccess: () => pushToast({ msg: "资料已更新", kind: "success" }) },
    );
  };

  const submitPwd = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd.length < 6 || newPwd !== newPwd2) return;
    changePwd.mutate(
      { old_password: oldPwd, new_password: newPwd },
      {
        onSuccess: () => {
          pushToast({ msg: "密码已修改", kind: "success" });
          setOldPwd("");
          setNewPwd("");
          setNewPwd2("");
        },
      },
    );
  };

  const passwordsMatch = !newPwd || !newPwd2 || newPwd === newPwd2;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <SectionHeader title="基本资料" />
        <form onSubmit={submitName} className={FORM_CLASS}>
          <ReadOnly label="邮箱" value={user.email} mono />
          <ReadOnly label="角色" value={ROLE_LABELS[user.role as UserRole] ?? user.role} />
          {user.group_name && <ReadOnly label="数据组" value={user.group_name} />}
          <Field label="姓名">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className={INPUT_CLASS}
            />
          </Field>
          {updateProfile.isError && <ErrorBanner msg={(updateProfile.error as Error).message} />}
          <div className={ACTIONS_END_CLASS}>
            <button
              type="submit"
              disabled={!name.trim() || name === user.name || updateProfile.isPending}
              className={primaryButtonClassName(updateProfile.isPending)}
            >
              {updateProfile.isPending ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </Card>

      <Card>
        <SectionHeader title="修改密码" />
        <form onSubmit={submitPwd} className={FORM_CLASS}>
          <Field label="原密码">
            <input
              required
              type="password"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="新密码（至少 8 位，需含大小写字母和数字）">
            <input
              required
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              minLength={6}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="再次输入新密码">
            <input
              required
              type="password"
              value={newPwd2}
              onChange={(e) => setNewPwd2(e.target.value)}
              className={clsx(INPUT_CLASS, !passwordsMatch && "border-rose-500")}
            />
            {!passwordsMatch && (
              <div className="mt-1 text-xs text-status-danger">两次密码不一致</div>
            )}
          </Field>
          {changePwd.isError && <ErrorBanner msg={(changePwd.error as Error).message} />}
          <div className={ACTIONS_END_CLASS}>
            <button
              type="submit"
              disabled={!oldPwd || newPwd.length < 6 || !passwordsMatch || changePwd.isPending}
              className={primaryButtonClassName(changePwd.isPending)}
            >
              {changePwd.isPending ? "提交中..." : "修改密码"}
            </button>
          </div>
        </form>
      </Card>

      <DangerZoneCard />
    </div>
  );
}

function DangerZoneCard() {
  const user = useAuthStore((s) => s.user);
  const pushToast = useToastStore((s) => s.push);
  const requestMut = useRequestDeactivation();
  const cancelMut = useCancelDeactivation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  if (!user) return null;
  const scheduledAt = user.deactivation_scheduled_at ?? null;
  const requestedAt = user.deactivation_requested_at ?? null;
  const isPending = !!scheduledAt;

  const submit = () => {
    requestMut.mutate(reason.trim(), {
      onSuccess: () => {
        pushToast({ msg: "注销申请已提交，7 天后自动生效", kind: "success" });
        setConfirmOpen(false);
        setReason("");
        setAcknowledged(false);
      },
      onError: (e) => pushToast({ msg: "提交失败", sub: (e as Error).message, kind: "warning" }),
    });
  };
  const cancel = () => {
    cancelMut.mutate(undefined, {
      onSuccess: () => pushToast({ msg: "已撤销注销申请", kind: "success" }),
      onError: (e) => pushToast({ msg: "撤销失败", sub: (e as Error).message, kind: "warning" }),
    });
  };

  return (
    <div className="[&>*]:border [&>*]:border-rose-500">
      <Card>
        <div className="flex items-center justify-between border-b border-rose-500 px-4 py-3">
          <h3 className="m-0 text-sm font-semibold text-status-danger">危险区</h3>
          <Icon name="warning" size={14} className="text-status-danger" />
        </div>
        <div className="flex flex-col gap-3 p-4">
          {isPending ? (
            <>
              <div className="text-sm text-foreground">
                <div className="mb-1 font-medium">注销申请已提交</div>
                <div className="text-muted-foreground">
                  提交时间：{requestedAt ? new Date(requestedAt).toLocaleString("zh-CN") : "—"}
                </div>
                <div className="text-muted-foreground">
                  生效时间：{new Date(scheduledAt!).toLocaleString("zh-CN")}（届时账号自动停用）
                </div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={cancel}
                  disabled={cancelMut.isPending}
                  className={primaryButtonClassName(cancelMut.isPending)}
                >
                  {cancelMut.isPending ? "撤销中..." : "撤销注销申请"}
                </button>
              </div>
            </>
          ) : confirmOpen ? (
            <>
              <div className="text-sm text-foreground">
                注销账号后，您将无法再登录此系统；标注历史与审计记录会保留以满足合规要求。
                <strong>提交后将进入 7 天冷静期，期间可随时撤销。</strong>
              </div>
              <Field label="注销原因（可选）">
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  placeholder="如：不再使用 / 切换账号 / 隐私顾虑..."
                  className={clsx(INPUT_CLASS, "resize-y [font:inherit]")}
                />
              </Field>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                我已知晓 7 天冷静期 + 历史数据保留
              </label>
              {requestMut.isError && <ErrorBanner msg={(requestMut.error as Error).message} />}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmOpen(false);
                    setAcknowledged(false);
                    setReason("");
                  }}
                  className="w-auto cursor-pointer rounded-md border border-border bg-card px-3.5 py-2 text-sm text-foreground"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!acknowledged || requestMut.isPending}
                  onClick={submit}
                  className={clsx(
                    "cursor-pointer rounded-md border-0 px-4 py-2 text-sm font-medium",
                    acknowledged
                      ? "bg-rose-500 text-white"
                      : "cursor-not-allowed bg-muted text-muted-foreground",
                    "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
                  )}
                >
                  {requestMut.isPending ? "提交中..." : "确认申请注销"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-muted-foreground">
                如不再需要本账号，可申请自助注销。提交后将进入 7 天冷静期，期间可撤销。
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  className="cursor-pointer rounded-md border border-rose-500 bg-transparent px-3.5 py-2 text-sm font-medium text-status-danger"
                >
                  申请注销账号
                </button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function SystemSection() {
  const { data, isLoading, error } = useSystemSettings();
  const updateMut = useUpdateSystemSettings();
  const testSmtpMut = useTestSmtp();
  const pushToast = useToastStore((s) => s.push);

  // 受控表单：仅在 data 加载后初始化一次
  const [allowOpen, setAllowOpen] = useState<boolean | null>(null);
  const [invTtl, setInvTtl] = useState<string>("");
  const [frontUrl, setFrontUrl] = useState<string>("");
  const [smtpHost, setSmtpHost] = useState<string>("");
  const [smtpPort, setSmtpPort] = useState<string>("");
  const [smtpUser, setSmtpUser] = useState<string>("");
  const [smtpPwd, setSmtpPwd] = useState<string>("");
  const [smtpFrom, setSmtpFrom] = useState<string>("");
  const [pwdEditing, setPwdEditing] = useState(false);

  useEffect(() => {
    if (!data) return;
    setAllowOpen(data.allow_open_registration);
    setInvTtl(String(data.invitation_ttl_days));
    setFrontUrl(data.frontend_base_url);
    setSmtpHost(data.smtp.host ?? "");
    setSmtpPort(data.smtp.port != null ? String(data.smtp.port) : "");
    setSmtpUser(data.smtp.user ?? "");
    setSmtpFrom(data.smtp.from_address ?? "");
    setSmtpPwd("");
    setPwdEditing(false);
  }, [data]);

  if (isLoading || !data || allowOpen === null) {
    return (
      <Card>
        <SectionHeader title="系统设置" />
        <div className="p-4 text-sm text-muted-foreground">
          {isLoading ? "加载中..." : null}
          {error && <ErrorBanner msg={(error as Error).message} />}
        </div>
      </Card>
    );
  }

  const dirty =
    allowOpen !== data.allow_open_registration ||
    invTtl !== String(data.invitation_ttl_days) ||
    frontUrl !== data.frontend_base_url ||
    smtpHost !== (data.smtp.host ?? "") ||
    smtpPort !== (data.smtp.port != null ? String(data.smtp.port) : "") ||
    smtpUser !== (data.smtp.user ?? "") ||
    smtpFrom !== (data.smtp.from_address ?? "") ||
    (pwdEditing && smtpPwd.length > 0);

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    const patch: SystemSettingsPatch = {};
    if (allowOpen !== data.allow_open_registration) patch.allow_open_registration = allowOpen;
    if (invTtl !== String(data.invitation_ttl_days)) {
      const n = parseInt(invTtl, 10);
      if (!Number.isFinite(n) || n < 1 || n > 90) {
        pushToast({ msg: "邀请有效期需在 1–90 天之间", kind: "warning" });
        return;
      }
      patch.invitation_ttl_days = n;
    }
    if (frontUrl !== data.frontend_base_url) patch.frontend_base_url = frontUrl.trim();
    if (smtpHost !== (data.smtp.host ?? "")) patch.smtp_host = smtpHost.trim();
    if (smtpPort !== (data.smtp.port != null ? String(data.smtp.port) : "")) {
      patch.smtp_port = smtpPort ? parseInt(smtpPort, 10) : null;
    }
    if (smtpUser !== (data.smtp.user ?? "")) patch.smtp_user = smtpUser.trim();
    if (smtpFrom !== (data.smtp.from_address ?? "")) patch.smtp_from = smtpFrom.trim();
    if (pwdEditing) patch.smtp_password = smtpPwd;

    updateMut.mutate(patch, {
      onSuccess: () => pushToast({ msg: "系统设置已更新", kind: "success" }),
      onError: (e) => pushToast({ msg: "保存失败", sub: (e as Error).message, kind: "warning" }),
    });
  };

  const onTestSmtp = () => {
    testSmtpMut.mutate(undefined, {
      onSuccess: (r) => pushToast({ msg: "测试邮件已发送", sub: `→ ${r.to}`, kind: "success" }),
      onError: (e) =>
        pushToast({ msg: "SMTP 测试失败", sub: (e as Error).message, kind: "warning" }),
    });
  };

  return (
    <Card>
      <SectionHeader title="系统设置" />
      <form onSubmit={onSave} className={FORM_CLASS}>
        <ReadOnly
          label="环境"
          value={data.environment}
          hint={
            <Badge
              variant={
                data.environment === "production"
                  ? "danger"
                  : data.environment === "staging"
                    ? "warning"
                    : "outline"
              }
            >
              {data.environment}
            </Badge>
          }
        />

        <Field label="开放注册（🟢 立即生效）">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowOpen}
              onChange={(e) => setAllowOpen(e.target.checked)}
            />
            <span>{allowOpen ? "已启用 — 新用户自助注册为 Viewer" : "已关闭 — 仅邀请注册"}</span>
          </label>
        </Field>

        <Field label="邀请有效期（天，🟢 仅影响新邀请）">
          <input
            type="number"
            min={1}
            max={90}
            value={invTtl}
            onChange={(e) => setInvTtl(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="前端基础地址（🟡 用于新邀请/重置链接）">
          <input
            value={frontUrl}
            onChange={(e) => setFrontUrl(e.target.value)}
            placeholder="https://your-domain.com"
            className={INPUT_CLASS}
          />
        </Field>

        <div>
          <div className={GROUP_LABEL_CLASS}>
            SMTP 邮件 ·{" "}
            <Badge variant={data.smtp.configured ? "success" : "outline"} dot>
              {data.smtp.configured ? "已配置" : "未配置"}
            </Badge>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
            <Field label="主机">
              <input
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                className={INPUT_CLASS}
                placeholder="smtp.example.com"
              />
            </Field>
            <Field label="端口">
              <input
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                className={INPUT_CLASS}
                placeholder="587 / 465"
              />
            </Field>
            <Field label="账号">
              <input
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="发件人">
              <input
                value={smtpFrom}
                onChange={(e) => setSmtpFrom(e.target.value)}
                className={INPUT_CLASS}
                placeholder="noreply@example.com"
              />
            </Field>
          </div>
          <div className="mt-2.5">
            <div className={LABEL_CLASS}>
              密码 {data.smtp.password_set && !pwdEditing ? "（已设置）" : ""}
            </div>
            {pwdEditing ? (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={smtpPwd}
                  onChange={(e) => setSmtpPwd(e.target.value)}
                  placeholder="留空保存视为清除"
                  className={clsx(INPUT_CLASS, "flex-1")}
                />
                <button
                  type="button"
                  onClick={() => {
                    setPwdEditing(false);
                    setSmtpPwd("");
                  }}
                  className={INPUT_BUTTON_CLASS}
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPwdEditing(true)}
                className={INPUT_BUTTON_CLASS}
              >
                {data.smtp.password_set ? "更换密码" : "设置密码"}
              </button>
            )}
          </div>
          <div className="mt-2.5">
            <button
              type="button"
              onClick={onTestSmtp}
              disabled={testSmtpMut.isPending || !data.smtp.configured}
              className={INPUT_BUTTON_CLASS}
            >
              {testSmtpMut.isPending ? "发送中..." : "发送测试邮件到我"}
            </button>
            <span className="ml-2.5 text-xs text-muted-foreground">收件人：当前账号邮箱</span>
          </div>
        </div>

        {updateMut.isError && <ErrorBanner msg={(updateMut.error as Error).message} />}
        <div className={ACTIONS_END_CLASS}>
          <button
            type="submit"
            disabled={!dirty || updateMut.isPending}
            className={primaryButtonClassName(updateMut.isPending)}
          >
            {updateMut.isPending ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </Card>
  );
}

function WorkbenchPreferencesSection() {
  const { config, loaded, saving, update } = useWorkbenchConfig();
  const pushToast = useToastStore((s) => s.push);

  if (!loaded) {
    return (
      <Card>
        <SectionHeader title="标注偏好" />
        <div className="p-5 text-sm text-muted-foreground">加载中…</div>
      </Card>
    );
  }

  const commit = (field: WorkbenchSettingField, value: WorkbenchSettingValue) => {
    update(buildFieldPatch(field, value)).catch(() =>
      pushToast({ msg: "保存失败", kind: "warning" }),
    );
  };

  const groups = groupWorkbenchSettings(
    getVisibleWorkbenchSettingFields().filter((field) => !isLocalSettingField(field)),
  );

  return (
    <Card>
      <SectionHeader title="标注偏好" />
      <div className={FORM_CLASS}>
        {groups.map(({ key, label, sections }) => (
          <div key={key} className="mt-2.5">
            <div className="mb-3 text-sm font-semibold">{label}</div>
            {sections.map(({ key: section, label: sectionLabel, fields }) => (
              <section key={section} aria-label={sectionLabel} className="mb-3">
                <div className={GROUP_LABEL_CLASS}>{sectionLabel}</div>
                <div className="flex flex-col gap-0.5">
                  {fields
                    .filter((field) => !field.parentKey)
                    .map((field) => {
                      const fieldValue = getFieldValue(config, field);
                      const childFields = fields.filter((child) => child.parentKey === field.key);
                      return (
                        <div key={field.key} className="flex flex-col gap-px">
                          <SettingsFieldControl
                            field={field}
                            value={fieldValue}
                            disabled={saving}
                            onCommit={(value) => commit(field, value)}
                          />
                          {childFields.map((child) => (
                            <SettingsFieldControl
                              key={child.key}
                              field={child}
                              value={getFieldValue(config, child)}
                              nested
                              disabled={saving || !fieldValue}
                              onCommit={(value) => commit(child, value)}
                            />
                          ))}
                        </div>
                      );
                    })}
                </div>
              </section>
            ))}
          </div>
        ))}
        {saving && <div className="text-xs text-muted-foreground">保存中…</div>}
      </div>
    </Card>
  );
}

function ApiKeysSection() {
  return (
    <Card>
      <SectionHeader title="API 密钥" />
      <ApiKeysPanel active />
    </Card>
  );
}

function MyFeedbackSection() {
  const [reports, setReports] = useState<BugReportResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await bugReportsApi.listMine(20);
        setReports(data.items);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const statusLabel: Record<string, string> = {
    new: "新提交",
    triaged: "已确认",
    in_progress: "处理中",
    fixed: "已修复",
    wont_fix: "不修复",
    duplicate: "重复",
  };
  if (loading) {
    return (
      <Card>
        <div className="p-5 text-sm text-muted-foreground">加载中...</div>
      </Card>
    );
  }

  if (reports.length === 0) {
    return (
      <Card>
        <div className="p-5 text-center text-sm text-muted-foreground">
          暂无反馈记录。遇到问题？点击右下角的反馈按钮提交。
        </div>
      </Card>
    );
  }

  const thClass = "px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap";

  return (
    <Card>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={thClass}>ID</th>
              <th className={thClass}>标题</th>
              <th className={thClass}>严重度</th>
              <th className={thClass}>状态</th>
              <th className={thClass}>时间</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className="border-b border-border">
                <td className="mono px-3 py-2 text-xs">{r.display_id}</td>
                <td
                  className="max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 text-foreground"
                  title={r.title}
                >
                  {r.title}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className={clsx("font-medium", severityClassName(r.severity))}>
                    {r.severity}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="rounded-[3px] bg-muted px-1.5 py-px text-xs">
                    {statusLabel[r.status] ?? r.status}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString("zh-CN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className={SECTION_HEADER_CLASS}>
      <h3 className="m-0 text-sm font-semibold">{title}</h3>
      {right}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className={LABEL_CLASS}>{label}</div>
      {children}
    </label>
  );
}

function ReadOnly({
  label,
  value,
  mono,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  hint?: React.ReactNode;
}) {
  return (
    <div>
      <div className={LABEL_CLASS}>{label}</div>
      <div className="flex items-center gap-2">
        <div
          className={clsx(
            "flex-1 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground",
            mono && "mono",
          )}
        >
          {value}
        </div>
        {hint}
      </div>
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-rose-500 bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
      <Icon name="warning" size={13} />
      {msg}
    </div>
  );
}

const primaryButtonClassName = (pending: boolean) =>
  clsx(
    "cursor-pointer rounded-md border-0 bg-brand px-4 py-2 text-sm font-medium text-white",
    "disabled:cursor-not-allowed disabled:bg-brand/60",
    pending && "cursor-not-allowed bg-brand/60",
  );

function severityClassName(severity: string) {
  switch (severity) {
    case "low":
      return "text-status-info-alt";
    case "medium":
      return "text-status-caution";
    case "high":
      return "text-orange-600 dark:text-orange-400";
    case "critical":
      return "text-status-danger";
    default:
      return "text-muted-foreground";
  }
}

const NOTIF_TYPE_LABELS: Record<string, string> = {
  "bug_report.commented": "BUG 反馈：有新评论",
  "bug_report.reopened": "BUG 反馈：被重新打开",
  "bug_report.status_changed": "BUG 反馈：状态变更",
  "batch.rejected": "批次被驳回",
  "batch.review_reopened": "批次重新进入审核",
  "batch.admin_locked": "批次被管理员锁定",
  "batch.admin_unlocked": "批次解除管理员锁定",
  "batch.unarchived": "批次取消归档",
  "task.approved": "任务审核通过",
  "task.rejected": "任务被退回",
  "task.reopened": "任务被重新打开",
  "failed_prediction.retry.started": "失败预测：开始重试",
  "failed_prediction.retry.succeeded": "失败预测：重试成功",
  "failed_prediction.retry.failed": "失败预测：重试失败",
  "export.ready": "导出完成",
  "export.failed": "导出失败",
  "job.completed": "后台任务完成",
  "job.failed": "后台任务失败",
  "job.cancelled": "后台任务取消",
  "user.deactivation_requested": "账号注销申请",
  "user.deactivation_completed": "账号注销完成",
};

function NotificationPreferencesSection() {
  const pushToast = useToastStore((s) => s.push);
  const [items, setItems] = useState<NotificationPreferenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    notificationsApi
      .getPreferences()
      .then((r) => {
        if (mounted) setItems(r.items);
      })
      .catch(() => {
        if (mounted) pushToast({ msg: "加载偏好失败", kind: "warning" });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [pushToast]);

  const toggle = async (type: string, next: boolean) => {
    setSavingType(type);
    setItems((prev) => prev.map((it) => (it.type === type ? { ...it, in_app: next } : it)));
    try {
      await notificationsApi.updatePreference(type, next);
    } catch (e) {
      // 回滚 UI
      setItems((prev) => prev.map((it) => (it.type === type ? { ...it, in_app: !next } : it)));
      pushToast({ msg: "保存失败", sub: (e as Error).message, kind: "warning" });
    } finally {
      setSavingType(null);
    }
  };

  return (
    <Card>
      <SectionHeader title="通知偏好" />
      <div className="px-4 pb-4 pt-3">
        <p className="mb-2.5 text-xs text-muted-foreground">
          关闭某类通知后，新事件不会进入站内通知中心；已存档通知不受影响。邮件 digest 暂未开启。
        </p>
        {loading && <div className="text-xs text-muted-foreground">加载中…</div>}
        {!loading &&
          items.map((it) => (
            <div
              key={it.type}
              className="flex items-center justify-between border-b border-border py-2.5 text-sm"
            >
              <div>
                <div className="font-medium">{NOTIF_TYPE_LABELS[it.type] ?? it.type}</div>
                <div className="mono text-xs text-muted-foreground">{it.type}</div>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={it.in_app}
                  disabled={savingType === it.type}
                  onChange={(e) => toggle(it.type, e.target.checked)}
                />
                <span className="text-xs text-muted-foreground">
                  站内通知 {it.in_app ? "已开启" : "已静音"}
                </span>
              </label>
            </div>
          ))}
      </div>
    </Card>
  );
}

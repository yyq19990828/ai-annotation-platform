import { useState, useEffect } from "react";
import { clsx } from "clsx";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/components/ui/Toast";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuthStore } from "@/stores/authStore";
import { useChangePassword, useUpdateProfile, useRequestDeactivation, useCancelDeactivation } from "@/hooks/useMe";
import { useSystemSettings, useUpdateSystemSettings, useTestSmtp } from "@/hooks/useSystemSettings";
import type { SystemSettingsPatch } from "@/api/settings";
import { ROLE_LABELS } from "@/constants/roles";
import { bugReportsApi, type BugReportResponse } from "@/api/bug-reports";
import { notificationsApi, type NotificationPreferenceItem } from "@/api/notifications";
import { useWorkbenchConfig } from "@/pages/Workbench/state/useWorkbenchConfig";
import { SettingsFieldControl } from "@/pages/Workbench/components/SettingsFieldControl";
import {
  WORKBENCH_SETTING_CATEGORY_LABELS,
  WORKBENCH_SETTING_FIELDS,
  buildFieldPatch,
  getFieldValue,
  isLocalSettingField,
  type WorkbenchSettingCategory,
  type WorkbenchSettingField,
  type WorkbenchSettingValue,
} from "@/pages/Workbench/state/workbenchSettingsFields";
import type { UserRole } from "@/types";
import styles from "./SettingsPage.module.css";

type SectionKey = "profile" | "workbench" | "feedback" | "notifications" | "system";

export function SettingsPage() {
  const { role } = usePermissions();
  const isAdmin = role === "super_admin";
  const [section, setSection] = useState<SectionKey>("profile");

  const sections: { key: SectionKey; label: string; icon: "user" | "flag" | "bell" | "settings" | "image" }[] = [
    { key: "profile", label: "个人资料", icon: "user" },
    { key: "workbench", label: "标注偏好", icon: "image" },
    { key: "feedback", label: "我的反馈", icon: "flag" },
    { key: "notifications", label: "通知偏好", icon: "bell" },
    ...(isAdmin ? [{ key: "system" as SectionKey, label: "系统设置", icon: "settings" as const }] : []),
  ];

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>设置</h1>
        <p className={styles.pageDescription}>管理你的账号信息与平台配置</p>
      </header>

      <div className={styles.layout}>
        <nav>
          <Card>
            <ul className={styles.navList}>
              {sections.map((s) => {
                const active = section === s.key;
                return (
                  <li key={s.key}>
                    <button
                      onClick={() => setSection(s.key)}
                      className={clsx(styles.navButton, active && styles.navButtonActive)}
                    >
                      <Icon name={s.icon} size={13} />{s.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </nav>

        <div>
          {section === "profile" && <ProfileSection />}
          {section === "workbench" && <WorkbenchPreferencesSection />}
          {section === "feedback" && <MyFeedbackSection />}
          {section === "notifications" && <NotificationPreferencesSection />}
          {section === "system" && isAdmin && <SystemSection />}
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
          setOldPwd(""); setNewPwd(""); setNewPwd2("");
        },
      },
    );
  };

  const passwordsMatch = !newPwd || !newPwd2 || newPwd === newPwd2;

  return (
    <div className={styles.sectionStack}>
      <Card>
        <SectionHeader title="基本资料" />
        <form onSubmit={submitName} className={styles.form}>
          <ReadOnly label="邮箱" value={user.email} mono />
          <ReadOnly label="角色" value={ROLE_LABELS[user.role as UserRole] ?? user.role} />
          {user.group_name && <ReadOnly label="数据组" value={user.group_name} />}
          <Field label="姓名">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className={styles.input}
            />
          </Field>
          {updateProfile.isError && (
            <ErrorBanner msg={(updateProfile.error as Error).message} />
          )}
          <div className={styles.actionsEnd}>
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
        <form onSubmit={submitPwd} className={styles.form}>
          <Field label="原密码">
            <input
              required
              type="password"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              className={styles.input}
            />
          </Field>
          <Field label="新密码（至少 8 位，需含大小写字母和数字）">
            <input
              required
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              minLength={6}
              className={styles.input}
            />
          </Field>
          <Field label="再次输入新密码">
            <input
              required
              type="password"
              value={newPwd2}
              onChange={(e) => setNewPwd2(e.target.value)}
              className={clsx(styles.input, !passwordsMatch && styles.inputError)}
            />
            {!passwordsMatch && (
              <div className={styles.fieldError}>两次密码不一致</div>
            )}
          </Field>
          {changePwd.isError && (
            <ErrorBanner msg={(changePwd.error as Error).message} />
          )}
          <div className={styles.actionsEnd}>
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
      onError: (e) =>
        pushToast({ msg: "提交失败", sub: (e as Error).message, kind: "warning" }),
    });
  };
  const cancel = () => {
    cancelMut.mutate(undefined, {
      onSuccess: () => pushToast({ msg: "已撤销注销申请", kind: "success" }),
      onError: (e) =>
        pushToast({ msg: "撤销失败", sub: (e as Error).message, kind: "warning" }),
    });
  };

  return (
    <div className={styles.dangerCard}>
      <Card>
        <div className={styles.dangerHeader}>
          <h3 className={styles.dangerTitle}>危险区</h3>
          <Icon name="warning" size={14} className={styles.dangerIcon} />
        </div>
        <div className={styles.dangerBody}>
          {isPending ? (
          <>
            <div className={styles.bodyText}>
              <div className={styles.pendingTitle}>注销申请已提交</div>
              <div className={styles.mutedText}>
                提交时间：{requestedAt ? new Date(requestedAt).toLocaleString("zh-CN") : "—"}
              </div>
              <div className={styles.mutedText}>
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
            <div className={styles.bodyText}>
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
                className={clsx(styles.input, styles.textarea)}
              />
            </Field>
            <label className={styles.checkLabelMuted}>
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              我已知晓 7 天冷静期 + 历史数据保留
            </label>
            {requestMut.isError && (
              <ErrorBanner msg={(requestMut.error as Error).message} />
            )}
            <div className={styles.actionsGapEnd}>
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); setAcknowledged(false); setReason(""); }}
                className={styles.secondaryButton}
              >
                取消
              </button>
              <button
                type="button"
                disabled={!acknowledged || requestMut.isPending}
                onClick={submit}
                className={clsx(styles.dangerButton, !acknowledged && styles.dangerButtonDisabled)}
              >
                {requestMut.isPending ? "提交中..." : "确认申请注销"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.mutedBodyText}>
              如不再需要本账号，可申请自助注销。提交后将进入 7 天冷静期，期间可撤销。
            </div>
            <div>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className={styles.dangerOutlineButton}
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
        <div className={styles.loadingBlockSubtle}>
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
      onSuccess: (r) =>
        pushToast({ msg: "测试邮件已发送", sub: `→ ${r.to}`, kind: "success" }),
      onError: (e) =>
        pushToast({ msg: "SMTP 测试失败", sub: (e as Error).message, kind: "warning" }),
    });
  };

  return (
    <Card>
      <SectionHeader title="系统设置" />
      <form onSubmit={onSave} className={styles.form}>
        <ReadOnly
          label="环境"
          value={data.environment}
          hint={
            <Badge
              variant={data.environment === "production" ? "danger" : data.environment === "staging" ? "warning" : "outline"}
            >
              {data.environment}
            </Badge>
          }
        />

        <Field label="开放注册（🟢 立即生效）">
          <label className={styles.checkLabel}>
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
            className={styles.input}
          />
        </Field>

        <Field label="前端基础地址（🟡 用于新邀请/重置链接）">
          <input
            value={frontUrl}
            onChange={(e) => setFrontUrl(e.target.value)}
            placeholder="https://your-domain.com"
            className={styles.input}
          />
        </Field>

        <div>
          <div className={styles.groupLabel}>
            SMTP 邮件 ·{" "}
            <Badge variant={data.smtp.configured ? "success" : "outline"} dot>
              {data.smtp.configured ? "已配置" : "未配置"}
            </Badge>
          </div>
          <div className={styles.twoColumnGrid}>
            <Field label="主机">
              <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} className={styles.input} placeholder="smtp.example.com" />
            </Field>
            <Field label="端口">
              <input
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                className={styles.input}
                placeholder="587 / 465"
              />
            </Field>
            <Field label="账号">
              <input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} className={styles.input} />
            </Field>
            <Field label="发件人">
              <input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} className={styles.input} placeholder="noreply@example.com" />
            </Field>
          </div>
          <div className={styles.fieldGroup}>
            <div className={styles.label}>密码 {data.smtp.password_set && !pwdEditing ? "（已设置）" : ""}</div>
            {pwdEditing ? (
              <div className={styles.inlineFields}>
                <input
                  type="password"
                  value={smtpPwd}
                  onChange={(e) => setSmtpPwd(e.target.value)}
                  placeholder="留空保存视为清除"
                  className={clsx(styles.input, styles.flexInput)}
                />
                <button
                  type="button"
                  onClick={() => { setPwdEditing(false); setSmtpPwd(""); }}
                  className={styles.inputButton}
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPwdEditing(true)}
                className={styles.inputButton}
              >
                {data.smtp.password_set ? "更换密码" : "设置密码"}
              </button>
            )}
          </div>
          <div className={styles.fieldGroup}>
            <button
              type="button"
              onClick={onTestSmtp}
              disabled={testSmtpMut.isPending || !data.smtp.configured}
              className={styles.inputButton}
            >
              {testSmtpMut.isPending ? "发送中..." : "发送测试邮件到我"}
            </button>
            <span className={styles.inlineHint}>
              收件人：当前账号邮箱
            </span>
          </div>
        </div>

        {updateMut.isError && (
          <ErrorBanner msg={(updateMut.error as Error).message} />
        )}
        <div className={styles.actionsEnd}>
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
        <div className={styles.loadingBlock}>加载中…</div>
      </Card>
    );
  }

  const commit = (field: WorkbenchSettingField, value: WorkbenchSettingValue) => {
    update(buildFieldPatch(field, value)).catch(() =>
      pushToast({ msg: "保存失败", kind: "warning" }),
    );
  };

  // v0.15.3 · 注册表驱动的四分组(通用/图片/视频/点云);空分组(本版 video/pointcloud)
  // 不渲染。与工作台设置抽屉共用 WORKBENCH_SETTING_FIELDS + SettingsFieldControl。
  const groups = (Object.keys(WORKBENCH_SETTING_CATEGORY_LABELS) as WorkbenchSettingCategory[])
    .map((category) => ({
      category,
      fields: WORKBENCH_SETTING_FIELDS.filter(
        (f) => f.category === category && !f.hidden && !isLocalSettingField(f),
      ),
    }))
    .filter((g) => g.fields.length > 0);

  return (
    <Card>
      <SectionHeader title="标注偏好" />
      <div className={styles.form}>
        {groups.map(({ category, fields }) => (
          <div key={category} className={styles.fieldGroup}>
            <div className={styles.groupLabel}>
              {WORKBENCH_SETTING_CATEGORY_LABELS[category]}
            </div>
            {fields.map((field) => (
              <SettingsFieldControl
                key={field.key}
                field={field}
                value={getFieldValue(config, field)}
                disabled={saving}
                onCommit={(value) => commit(field, value)}
              />
            ))}
          </div>
        ))}
        {saving && <div className={styles.savingText}>保存中…</div>}
      </div>
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
    new: "新提交", triaged: "已确认", in_progress: "处理中",
    fixed: "已修复", wont_fix: "不修复", duplicate: "重复",
  };
  if (loading) {
    return <Card><div className={styles.loadingBlock}>加载中...</div></Card>;
  }

  if (reports.length === 0) {
    return (
      <Card>
        <div className={styles.emptyBlock}>
          暂无反馈记录。遇到问题？点击右下角的反馈按钮提交。
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className={styles.feedbackTableShell}>
        <table className={styles.feedbackTable}>
          <thead>
            <tr className={styles.tableHeadRow}>
              <th className={styles.tableHeaderCell}>ID</th>
              <th className={styles.tableHeaderCell}>标题</th>
              <th className={styles.tableHeaderCell}>严重度</th>
              <th className={styles.tableHeaderCell}>状态</th>
              <th className={styles.tableHeaderCell}>时间</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className={styles.tableBodyRow}>
                <td className={clsx(styles.tableCell, styles.monoCell)}>{r.display_id}</td>
                <td className={clsx(styles.tableCell, styles.titleCell)} title={r.title}>{r.title}</td>
                <td className={clsx(styles.tableCell, styles.nowrapCell)}>
                  <span className={clsx(styles.severity, severityClassName(r.severity))}>{r.severity}</span>
                </td>
                <td className={clsx(styles.tableCell, styles.nowrapCell)}>
                  <span className={styles.statusPill}>
                    {statusLabel[r.status] ?? r.status}
                  </span>
                </td>
                <td className={clsx(styles.tableCell, styles.dateCell)}>
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
    <div className={styles.sectionHeader}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {right}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <div className={styles.label}>{label}</div>
      {children}
    </label>
  );
}

function ReadOnly({ label, value, mono, hint }: { label: string; value: string; mono?: boolean; hint?: React.ReactNode }) {
  return (
    <div>
      <div className={styles.label}>{label}</div>
      <div className={styles.readOnlyRow}>
        <div
          className={clsx(styles.readOnlyValue, mono && "mono")}
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
    <div className={styles.errorBanner}>
      <Icon name="warning" size={13} />{msg}
    </div>
  );
}

const primaryButtonClassName = (pending: boolean) =>
  clsx(styles.primaryButton, pending && styles.primaryButtonPending);

function severityClassName(severity: string) {
  switch (severity) {
    case "low":
      return styles.severityLow;
    case "medium":
      return styles.severityMedium;
    case "high":
      return styles.severityHigh;
    case "critical":
      return styles.severityCritical;
    default:
      return styles.severityUnknown;
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
      <div className={styles.notificationBody}>
        <p className={styles.notificationDescription}>
          关闭某类通知后，新事件不会进入站内通知中心；已存档通知不受影响。邮件 digest 暂未开启。
        </p>
        {loading && (
          <div className={styles.savingText}>加载中…</div>
        )}
        {!loading &&
          items.map((it) => (
            <div
              key={it.type}
              className={styles.notificationItem}
            >
              <div>
                <div className={styles.notificationTitle}>{NOTIF_TYPE_LABELS[it.type] ?? it.type}</div>
                <div className={clsx("mono", styles.notificationType)}>
                  {it.type}
                </div>
              </div>
              <label className={styles.notificationToggle}>
                <input
                  type="checkbox"
                  checked={it.in_app}
                  disabled={savingType === it.type}
                  onChange={(e) => toggle(it.type, e.target.checked)}
                />
                <span className={styles.toggleText}>
                  站内通知 {it.in_app ? "已开启" : "已静音"}
                </span>
              </label>
            </div>
          ))}
      </div>
    </Card>
  );
}

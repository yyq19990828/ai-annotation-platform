import { useState, useEffect } from "react";
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
import type { UserRole } from "@/types";

type SectionKey = "profile" | "feedback" | "notifications" | "system";

export function SettingsPage() {
  const { role } = usePermissions();
  const isAdmin = role === "super_admin";
  const [section, setSection] = useState<SectionKey>("profile");

  const sections: { key: SectionKey; label: string; icon: "user" | "flag" | "bell" | "settings" }[] = [
    { key: "profile", label: "个人资料", icon: "user" },
    { key: "feedback", label: "我的反馈", icon: "flag" },
    { key: "notifications", label: "通知偏好", icon: "bell" },
    ...(isAdmin ? [{ key: "system" as SectionKey, label: "系统设置", icon: "settings" as const }] : []),
  ];

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>设置</h1>
        <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>管理你的账号信息与平台配置</p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 16 }}>
        <nav>
          <Card>
            <ul style={{ listStyle: "none", margin: 0, padding: 6 }}>
              {sections.map((s) => {
                const active = section === s.key;
                return (
                  <li key={s.key}>
                    <button
                      onClick={() => setSection(s.key)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "9px 12px",
                        border: "none",
                        background: active ? "var(--color-bg-sunken)" : "transparent",
                        borderRadius: "var(--radius-md)",
                        cursor: "pointer",
                        color: active ? "var(--color-fg)" : "var(--color-fg-muted)",
                        fontWeight: active ? 600 : 500,
                        fontSize: 13,
                        textAlign: "left",
                        fontFamily: "inherit",
                      }}
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <SectionHeader title="基本资料" />
        <form onSubmit={submitName} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <ReadOnly label="邮箱" value={user.email} mono />
          <ReadOnly label="角色" value={ROLE_LABELS[user.role as UserRole] ?? user.role} />
          {user.group_name && <ReadOnly label="数据组" value={user.group_name} />}
          <Field label="姓名">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              style={inputStyle}
            />
          </Field>
          {updateProfile.isError && (
            <ErrorBanner msg={(updateProfile.error as Error).message} />
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              disabled={!name.trim() || name === user.name || updateProfile.isPending}
              style={primaryBtn(updateProfile.isPending)}
            >
              {updateProfile.isPending ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </Card>

      <Card>
        <SectionHeader title="修改密码" />
        <form onSubmit={submitPwd} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="原密码">
            <input
              required
              type="password"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="新密码（至少 8 位，需含大小写字母和数字）">
            <input
              required
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              minLength={6}
              style={inputStyle}
            />
          </Field>
          <Field label="再次输入新密码">
            <input
              required
              type="password"
              value={newPwd2}
              onChange={(e) => setNewPwd2(e.target.value)}
              style={{ ...inputStyle, borderColor: passwordsMatch ? "var(--color-border)" : "#ef4444" }}
            />
            {!passwordsMatch && (
              <div style={{ fontSize: 11.5, color: "#ef4444", marginTop: 4 }}>两次密码不一致</div>
            )}
          </Field>
          {changePwd.isError && (
            <ErrorBanner msg={(changePwd.error as Error).message} />
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              disabled={!oldPwd || newPwd.length < 6 || !passwordsMatch || changePwd.isPending}
              style={primaryBtn(changePwd.isPending)}
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
    <Card style={{ borderColor: "#ef4444", borderWidth: 1 }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #ef4444", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#ef4444" }}>危险区</h3>
        <Icon name="warning" size={14} style={{ color: "#ef4444" }} />
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {isPending ? (
          <>
            <div style={{ fontSize: 13, color: "var(--color-fg)" }}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>注销申请已提交</div>
              <div style={{ color: "var(--color-fg-muted)" }}>
                提交时间：{requestedAt ? new Date(requestedAt).toLocaleString("zh-CN") : "—"}
              </div>
              <div style={{ color: "var(--color-fg-muted)" }}>
                生效时间：{new Date(scheduledAt!).toLocaleString("zh-CN")}（届时账号自动停用）
              </div>
            </div>
            <div>
              <button
                type="button"
                onClick={cancel}
                disabled={cancelMut.isPending}
                style={primaryBtn(cancelMut.isPending)}
              >
                {cancelMut.isPending ? "撤销中..." : "撤销注销申请"}
              </button>
            </div>
          </>
        ) : confirmOpen ? (
          <>
            <div style={{ fontSize: 13, color: "var(--color-fg)" }}>
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
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
              />
            </Field>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--color-fg-muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              我已知晓 7 天冷静期 + 历史数据保留
            </label>
            {requestMut.isError && (
              <ErrorBanner msg={(requestMut.error as Error).message} />
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); setAcknowledged(false); setReason(""); }}
                style={{ ...inputStyle, width: "auto", padding: "7px 14px", cursor: "pointer" }}
              >
                取消
              </button>
              <button
                type="button"
                disabled={!acknowledged || requestMut.isPending}
                onClick={submit}
                style={{
                  padding: "7px 18px",
                  fontSize: 13,
                  fontWeight: 500,
                  background: !acknowledged ? "var(--color-bg-sunken)" : "#ef4444",
                  color: !acknowledged ? "var(--color-fg-subtle)" : "#fff",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  cursor: !acknowledged ? "not-allowed" : "pointer",
                }}
              >
                {requestMut.isPending ? "提交中..." : "确认申请注销"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "var(--color-fg-muted)" }}>
              如不再需要本账号，可申请自助注销。提交后将进入 7 天冷静期，期间可撤销。
            </div>
            <div>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                style={{
                  padding: "7px 14px",
                  fontSize: 13,
                  fontWeight: 500,
                  background: "transparent",
                  color: "#ef4444",
                  border: "1px solid #ef4444",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                }}
              >
                申请注销账号
              </button>
            </div>
          </>
        )}
      </div>
    </Card>
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
  }, [data?.allow_open_registration, data?.invitation_ttl_days, data?.frontend_base_url, data?.smtp.host, data?.smtp.port, data?.smtp.user, data?.smtp.from_address]);

  if (isLoading || !data || allowOpen === null) {
    return (
      <Card>
        <SectionHeader title="系统设置" />
        <div style={{ padding: 16, color: "var(--color-fg-subtle)" }}>
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
      <form onSubmit={onSave} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <ReadOnly
          label="环境"
          value={data.environment}
          hint={
            <Badge
              variant={data.environment === "production" ? "danger" : data.environment === "staging" ? "warning" : "outline"}
              style={{ fontSize: 10 }}
            >
              {data.environment}
            </Badge>
          }
        />

        <Field label="开放注册（🟢 立即生效）">
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer", fontSize: 13 }}>
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
            style={inputStyle}
          />
        </Field>

        <Field label="前端基础地址（🟡 用于新邀请/重置链接）">
          <input
            value={frontUrl}
            onChange={(e) => setFrontUrl(e.target.value)}
            placeholder="https://your-domain.com"
            style={inputStyle}
          />
        </Field>

        <div>
          <div style={{ ...labelStyle, marginBottom: 8 }}>
            SMTP 邮件 ·{" "}
            <Badge variant={data.smtp.configured ? "success" : "outline"} dot>
              {data.smtp.configured ? "已配置" : "未配置"}
            </Badge>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="主机">
              <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} style={inputStyle} placeholder="smtp.example.com" />
            </Field>
            <Field label="端口">
              <input
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                style={inputStyle}
                placeholder="587 / 465"
              />
            </Field>
            <Field label="账号">
              <input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="发件人">
              <input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} style={inputStyle} placeholder="noreply@example.com" />
            </Field>
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={labelStyle}>密码 {data.smtp.password_set && !pwdEditing ? "（已设置）" : ""}</div>
            {pwdEditing ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="password"
                  value={smtpPwd}
                  onChange={(e) => setSmtpPwd(e.target.value)}
                  placeholder="留空保存视为清除"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => { setPwdEditing(false); setSmtpPwd(""); }}
                  style={{ ...inputStyle, width: "auto", padding: "8px 14px", cursor: "pointer" }}
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPwdEditing(true)}
                style={{ ...inputStyle, width: "auto", padding: "8px 14px", cursor: "pointer" }}
              >
                {data.smtp.password_set ? "更换密码" : "设置密码"}
              </button>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={onTestSmtp}
              disabled={testSmtpMut.isPending || !data.smtp.configured}
              style={{ ...inputStyle, width: "auto", padding: "8px 14px", cursor: testSmtpMut.isPending ? "not-allowed" : "pointer" }}
            >
              {testSmtpMut.isPending ? "发送中..." : "发送测试邮件到我"}
            </button>
            <span style={{ marginLeft: 10, fontSize: 11, color: "var(--color-fg-subtle)" }}>
              收件人：当前账号邮箱
            </span>
          </div>
        </div>

        {updateMut.isError && (
          <ErrorBanner msg={(updateMut.error as Error).message} />
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={!dirty || updateMut.isPending}
            style={primaryBtn(updateMut.isPending)}
          >
            {updateMut.isPending ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
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
  const severityColor: Record<string, string> = {
    low: "oklch(0.55 0.08 200)", medium: "oklch(0.65 0.18 75)",
    high: "oklch(0.65 0.18 45)", critical: "oklch(0.60 0.22 25)",
  };

  if (loading) {
    return <Card><div style={{ padding: 20, fontSize: 13, color: "var(--color-fg-muted)" }}>加载中...</div></Card>;
  }

  if (reports.length === 0) {
    return (
      <Card>
        <div style={{ padding: 20, fontSize: 13, color: "var(--color-fg-muted)", textAlign: "center" }}>
          暂无反馈记录。遇到问题？点击右下角的反馈按钮提交。
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 500, color: "var(--color-fg-muted)" }}>ID</th>
            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 500, color: "var(--color-fg-muted)" }}>标题</th>
            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 500, color: "var(--color-fg-muted)" }}>严重度</th>
            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 500, color: "var(--color-fg-muted)" }}>状态</th>
            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 500, color: "var(--color-fg-muted)" }}>时间</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
              <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 11 }}>{r.display_id}</td>
              <td style={{ padding: "8px 12px", color: "var(--color-fg)" }}>{r.title}</td>
              <td style={{ padding: "8px 12px" }}>
                <span style={{ color: severityColor[r.severity] ?? "var(--color-fg-muted)", fontWeight: 500 }}>{r.severity}</span>
              </td>
              <td style={{ padding: "8px 12px" }}>
                <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 11, background: "var(--color-bg-sunken)" }}>
                  {statusLabel[r.status] ?? r.status}
                </span>
              </td>
              <td style={{ padding: "8px 12px", fontSize: 11, color: "var(--color-fg-muted)" }}>
                {new Date(r.created_at).toLocaleDateString("zh-CN")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h3>
      {right}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </label>
  );
}

function ReadOnly({ label, value, mono, hint }: { label: string; value: string; mono?: boolean; hint?: React.ReactNode }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          className={mono ? "mono" : undefined}
          style={{
            flex: 1,
            padding: "7px 11px",
            background: "var(--color-bg-sunken)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            fontSize: 13,
            color: "var(--color-fg)",
          }}
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
    <div
      style={{
        padding: "8px 11px",
        background: "rgba(239,68,68,0.08)",
        border: "1px solid #ef4444",
        borderRadius: "var(--radius-md)",
        color: "#ef4444",
        fontSize: 12.5,
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}
    >
      <Icon name="warning" size={13} />{msg}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  marginBottom: 5,
  color: "var(--color-fg-muted)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 11px",
  fontSize: 13,
  background: "var(--color-bg-elev)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-fg)",
  outline: "none",
};

const primaryBtn = (pending: boolean): React.CSSProperties => ({
  padding: "7px 18px",
  fontSize: 13,
  fontWeight: 500,
  background: pending ? "var(--color-accent-muted, oklch(0.45 0.18 250))" : "var(--color-accent)",
  color: "#fff",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: pending ? "not-allowed" : "pointer",
});

const NOTIF_TYPE_LABELS: Record<string, string> = {
  "bug_report.commented": "BUG 反馈：有新评论",
  "bug_report.reopened": "BUG 反馈：被重新打开",
  "bug_report.status_changed": "BUG 反馈：状态变更",
  "batch.rejected": "批次被驳回",
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
      <div style={{ padding: "12px 18px 18px" }}>
        <p style={{ fontSize: 12, color: "var(--color-fg-muted)", margin: "0 0 10px" }}>
          关闭某类通知后，新事件不会进入站内通知中心；已存档通知不受影响。邮件 digest 暂未开启。
        </p>
        {loading && (
          <div style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>加载中…</div>
        )}
        {!loading &&
          items.map((it) => (
            <div
              key={it.type}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 0",
                borderBottom: "1px solid var(--color-border-subtle)",
                fontSize: 13,
              }}
            >
              <div>
                <div style={{ fontWeight: 500 }}>{NOTIF_TYPE_LABELS[it.type] ?? it.type}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
                  {it.type}
                </div>
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={it.in_app}
                  disabled={savingType === it.type}
                  onChange={(e) => toggle(it.type, e.target.checked)}
                />
                <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
                  站内通知 {it.in_app ? "已开启" : "已静音"}
                </span>
              </label>
            </div>
          ))}
      </div>
    </Card>
  );
}

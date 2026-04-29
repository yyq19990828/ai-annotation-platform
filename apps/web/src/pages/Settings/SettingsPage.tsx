import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/components/ui/Toast";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuthStore } from "@/stores/authStore";
import { useChangePassword, useUpdateProfile } from "@/hooks/useMe";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { ROLE_LABELS } from "@/constants/roles";
import type { UserRole } from "@/types";

type SectionKey = "profile" | "system";

export function SettingsPage() {
  const { role } = usePermissions();
  const isAdmin = role === "super_admin";
  const [section, setSection] = useState<SectionKey>("profile");

  const sections: { key: SectionKey; label: string; icon: "user" | "settings" }[] = [
    { key: "profile", label: "个人资料", icon: "user" },
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
          <Field label="新密码（至少 6 位）">
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
    </div>
  );
}

function SystemSection() {
  const { data, isLoading, error } = useSystemSettings();

  return (
    <Card>
      <SectionHeader
        title="系统设置"
        right={
          <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
            如需修改，请编辑后端 .env 并重启服务
          </span>
        }
      />
      <div style={{ padding: 16 }}>
        {isLoading && <div style={{ color: "var(--color-fg-subtle)" }}>加载中...</div>}
        {error && <ErrorBanner msg={(error as Error).message} />}
        {data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
            <ReadOnly label="邀请有效期" value={`${data.invitation_ttl_days} 天`} />
            <ReadOnly label="前端基础地址" value={data.frontend_base_url} mono />
            <div>
              <div style={labelStyle}>SMTP 邮件</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                <ReadOnly label="主机" value={data.smtp.host ?? "未配置"} mono />
                <ReadOnly label="端口" value={data.smtp.port?.toString() ?? "—"} mono />
                <ReadOnly label="账号" value={data.smtp.user ?? "—"} mono />
                <ReadOnly label="发件人" value={data.smtp.from_address ?? "—"} mono />
              </div>
              <div style={{ marginTop: 8 }}>
                <Badge variant={data.smtp.configured ? "success" : "outline"} dot>
                  {data.smtp.configured ? "已配置（本期未启用真实发送，仍返回一次性链接）" : "未配置"}
                </Badge>
              </div>
            </div>
          </div>
        )}
      </div>
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

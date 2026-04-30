import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { useResolveInvitation, useRegister } from "@/hooks/useInvitation";
import { useAuthStore } from "@/stores/authStore";
import { ROLE_LABELS } from "@/constants/roles";
import type { UserRole } from "@/types";
import type { ApiError } from "@/api/client";

export function RegisterPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const existingToken = useAuthStore((s) => s.token);

  const resolve = useResolveInvitation(token);
  const register = useRegister();

  const [name, setName] = useState("");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  if (!token) {
    return <ErrorPanel title="缺少邀请令牌" hint="请通过完整的邀请链接打开此页面。" />;
  }

  // 已登录用户访问 /register 直接送回 dashboard，避免误操作
  if (existingToken) return <Navigate to="/dashboard" replace />;

  if (resolve.isLoading) {
    return <CenteredCard><span style={{ color: "var(--color-fg-muted)" }}>正在校验邀请链接…</span></CenteredCard>;
  }

  if (resolve.isError) {
    const err = resolve.error as ApiError;
    const status = err?.status;
    const detail =
      status === 404 ? "邀请链接无效" :
      status === 410 ? (err.message ?? "该邀请已失效") :
      (err?.message ?? "无法读取邀请信息");
    return <ErrorPanel title={detail} hint="请联系管理员重新发送邀请。" />;
  }

  const inv = resolve.data!;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !pwd || pwd.length < 6 || pwd !== pwd2) return;
    register.mutate(
      { token, name: name.trim(), password: pwd },
      {
        onSuccess: (data) => {
          setAuth(data.access_token, data.user);
          navigate("/dashboard", { replace: true });
        },
      },
    );
  };

  const passwordsMatch = !pwd || !pwd2 || pwd === pwd2;
  const passwordsValid = pwd.length >= 6;

  return (
    <CenteredCard>
      <Brand />
      <div style={cardStyle}>
        <h1 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 600 }}>设置你的账号</h1>
        <p style={{ margin: "0 0 18px", fontSize: 12.5, color: "var(--color-fg-muted)" }}>
          来自 <strong>{inv.invited_by_name ?? "管理员"}</strong> 的邀请，绑定邮箱{" "}
          <span className="mono" style={{ color: "var(--color-fg)" }}>{inv.email}</span>
        </p>

        <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
          <Pill>{ROLE_LABELS[inv.role as UserRole] ?? inv.role}</Pill>
          {inv.group_name && <Pill>{inv.group_name}</Pill>}
          <Pill>有效期至 {new Date(inv.expires_at).toLocaleString("zh-CN")}</Pill>
        </div>

        {register.isError && (
          <ErrorBanner msg={(register.error as Error).message} />
        )}

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="姓名">
            <input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="如何在平台中称呼你"
              style={inputStyle}
            />
          </Field>

          <Field label="密码（至少 8 位，需含大小写字母和数字）">
            <div style={{ position: "relative" }}>
              <input
                required
                type={showPwd ? "text" : "password"}
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                minLength={6}
                style={{ ...inputStyle, paddingRight: 36 }}
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                style={eyeBtnStyle}
                aria-label="切换密码可见性"
              >
                <Icon name={showPwd ? "eyeOff" : "eye"} size={14} />
              </button>
            </div>
          </Field>

          <Field label="再次输入密码">
            <input
              required
              type={showPwd ? "text" : "password"}
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              style={{
                ...inputStyle,
                borderColor: !passwordsMatch ? "#ef4444" : "var(--color-border)",
              }}
            />
            {!passwordsMatch && (
              <div style={{ fontSize: 11.5, color: "#ef4444", marginTop: 4 }}>两次密码不一致</div>
            )}
          </Field>

          <button
            type="submit"
            disabled={!name.trim() || !passwordsValid || !passwordsMatch || register.isPending}
            style={primaryBtnStyle(register.isPending)}
          >
            {register.isPending ? "创建中..." : "完成注册并登录"}
          </button>
        </form>
      </div>
    </CenteredCard>
  );
}

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24, justifyContent: "center" }}>
      <div style={brandIcon}>
        <div style={{ position: "absolute", inset: 6, border: "2px solid rgba(255,255,255,0.85)", borderRadius: 4 }} />
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>标注中心</div>
        <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>AI Annotation Platform</div>
      </div>
    </div>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-bg)", padding: 24 }}>
      <div style={{ width: 400 }}>{children}</div>
    </div>
  );
}

function ErrorPanel({ title, hint }: { title: string; hint: string }) {
  const navigate = useNavigate();
  return (
    <CenteredCard>
      <Brand />
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, color: "#ef4444" }}>
          <Icon name="warning" size={16} />
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h1>
        </div>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-fg-muted)" }}>{hint}</p>
        <button onClick={() => navigate("/login")} style={primaryBtnStyle(false)}>
          前往登录
        </button>
      </div>
    </CenteredCard>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div
      style={{
        marginBottom: 14,
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 5, color: "var(--color-fg-muted)" }}>{label}</div>
      {children}
    </label>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: 999,
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-sunken)",
        color: "var(--color-fg-muted)",
      }}
    >
      {children}
    </span>
  );
}

const brandIcon: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: "var(--radius-md)",
  background: "linear-gradient(135deg, var(--color-accent), oklch(0.55 0.22 280))",
  position: "relative",
  overflow: "hidden",
  flexShrink: 0,
};

const cardStyle: React.CSSProperties = {
  background: "var(--color-bg-elev)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-xl)",
  padding: "26px 30px 30px",
  boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 11px",
  fontSize: 13.5,
  background: "var(--color-bg-sunken)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-fg)",
  outline: "none",
};

const eyeBtnStyle: React.CSSProperties = {
  position: "absolute",
  right: 10,
  top: "50%",
  transform: "translateY(-50%)",
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--color-fg-subtle)",
  padding: 2,
  display: "flex",
  alignItems: "center",
};

const primaryBtnStyle = (pending: boolean): React.CSSProperties => ({
  marginTop: 6,
  width: "100%",
  padding: "9px 0",
  fontSize: 13.5,
  fontWeight: 600,
  background: pending ? "var(--color-accent-muted, oklch(0.45 0.18 250))" : "var(--color-accent)",
  color: "#fff",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: pending ? "not-allowed" : "pointer",
});

import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useLogin } from "@/hooks/useAuth";
import { useRegistrationStatus } from "@/hooks/useInvitation";
import { useAuthStore } from "@/stores/authStore";
import { Icon } from "@/components/ui/Icon";
import { Captcha } from "@/components/Captcha";
import { ApiError } from "@/api/client";

// v0.9.3 · 与后端 settings.login_captcha_threshold 同值；前端阈值仅做"何时渲染 Captcha"判断
const CAPTCHA_THRESHOLD = 5;

export function LoginPage() {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [failedCount, setFailedCount] = useState(0);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const login = useLogin();
  const regStatus = useRegistrationStatus();

  useEffect(() => {
    if (login.isError) {
      const err = login.error;
      if (err instanceof ApiError) {
        const h = err.headers?.["x-login-failed-count"];
        const n = h ? parseInt(h, 10) : NaN;
        if (Number.isFinite(n)) setFailedCount(n);
      }
    }
  }, [login.isError, login.error]);

  if (token) return <Navigate to={from} replace />;

  const captchaRequired = failedCount >= CAPTCHA_THRESHOLD;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    if (captchaRequired && !captchaToken) return;
    login.mutate(
      { email, password, captcha_token: captchaRequired ? captchaToken : undefined },
      {
        onSuccess: () => {
          setFailedCount(0);
          setCaptchaToken(null);
        },
      },
    );
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg)",
      }}
    >
      <div style={{ width: 380 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32, justifyContent: "center" }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--radius-md)",
              background: "linear-gradient(135deg, var(--color-accent), oklch(0.55 0.22 280))",
              position: "relative",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 6,
                border: "2px solid rgba(255,255,255,0.85)",
                borderRadius: 4,
              }}
            />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>标注中心</div>
            <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>AI Annotation Platform</div>
          </div>
        </div>

        {/* Card */}
        <div
          style={{
            background: "var(--color-bg-elev)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-xl)",
            padding: "28px 32px 32px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
          }}
        >
          <h1 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>登录</h1>
          <p style={{ margin: "0 0 24px", fontSize: 13, color: "var(--color-fg-muted)" }}>
            使用工作账号登录标注平台
          </p>

          {login.isError && (
            <div
              style={{
                marginBottom: 16,
                padding: "10px 12px",
                background: "var(--color-danger-soft, rgba(239,68,68,0.08))",
                border: "1px solid var(--color-danger, #ef4444)",
                borderRadius: "var(--radius-md)",
                fontSize: 13,
                color: "var(--color-danger, #ef4444)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Icon name="warning" size={14} />
              {(login.error as Error)?.message ?? "登录失败，请检查账号密码"}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 6, color: "var(--color-fg-muted)" }}>
                账号
              </label>
              <input
                type="text"
                autoComplete="username"
                placeholder="输入账号或邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "8px 11px",
                  fontSize: 13.5,
                  background: "var(--color-bg-sunken)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-fg)",
                  outline: "none",
                  transition: "border-color 0.15s",
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--color-accent)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--color-border)")}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 6, color: "var(--color-fg-muted)" }}>
                密码
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPwd ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "8px 36px 8px 11px",
                    fontSize: 13.5,
                    background: "var(--color-bg-sunken)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    color: "var(--color-fg)",
                    outline: "none",
                    transition: "border-color 0.15s",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--color-accent)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--color-border)")}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  style={{
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
                  }}
                >
                  <Icon name={showPwd ? "eyeOff" : "eye"} size={14} />
                </button>
              </div>
            </div>

            {captchaRequired && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)" }}>
                  连续失败已达 {failedCount} 次，请完成验证后重试
                </div>
                <Captcha onChange={setCaptchaToken} />
              </div>
            )}

            <button
              type="submit"
              disabled={login.isPending || (captchaRequired && !captchaToken)}
              style={{
                marginTop: 6,
                width: "100%",
                padding: "9px 0",
                fontSize: 13.5,
                fontWeight: 600,
                background: login.isPending ? "var(--color-accent-muted, oklch(0.45 0.18 250))" : "var(--color-accent)",
                color: "#fff",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: login.isPending ? "not-allowed" : "pointer",
                transition: "opacity 0.15s",
                letterSpacing: "0.01em",
                opacity: captchaRequired && !captchaToken ? 0.6 : 1,
              }}
            >
              {login.isPending ? "登录中..." : "登录"}
            </button>

            <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {regStatus.data?.open_registration_enabled ? (
                <Link
                  to="/register"
                  style={{ fontSize: 12, color: "var(--color-accent)", textDecoration: "none" }}
                >
                  没有账号？立即注册
                </Link>
              ) : <span />}
              <Link
                to="/forgot-password"
                style={{ fontSize: 12, color: "var(--color-accent)", textDecoration: "none" }}
              >
                忘记密码？
              </Link>
            </div>
          </form>

          {import.meta.env.MODE !== "production" && (
            <div style={{ marginTop: 20, padding: "12px 14px", background: "var(--color-bg-sunken)", borderRadius: "var(--radius-md)", fontSize: 12, color: "var(--color-fg-subtle)" }}>
              <div style={{ fontWeight: 500, marginBottom: 6, color: "var(--color-fg-muted)" }}>测试账号 (密码统一: 123456)</div>
              <div>超级管理员：<span className="mono">admin</span></div>
              <div style={{ marginTop: 2 }}>项目管理员：<span className="mono">pm</span></div>
              <div style={{ marginTop: 2 }}>质检员：<span className="mono">qa</span></div>
              <div style={{ marginTop: 2 }}>标注员：<span className="mono">anno</span></div>
              <div style={{ marginTop: 2 }}>观察者：<span className="mono">viewer</span></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

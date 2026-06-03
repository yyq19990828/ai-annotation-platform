import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useLogin } from "@/hooks/useAuth";
import { useRegistrationStatus, useResendVerification } from "@/hooks/useInvitation";
import { useAuthStore } from "@/stores/authStore";
import { Icon } from "@/components/ui/Icon";
import { Captcha } from "@/components/Captcha";
import { ApiError } from "@/api/client";
import styles from "./LoginPage.module.css";

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
  // v0.12.0 · 后端返回 email_not_verified 时展示重发入口
  const [unverified, setUnverified] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const login = useLogin();
  const regStatus = useRegistrationStatus();
  const resend = useResendVerification();

  useEffect(() => {
    if (login.isError) {
      const err = login.error;
      if (err instanceof ApiError) {
        const h = err.headers?.["x-login-failed-count"];
        const n = h ? parseInt(h, 10) : NaN;
        if (Number.isFinite(n)) setFailedCount(n);
        const code = (err.detailRaw as { code?: string } | undefined)?.code;
        setUnverified(code === "email_not_verified");
      }
    }
  }, [login.isError, login.error]);

  if (token) return <Navigate to={from} replace />;

  const captchaRequired = failedCount >= CAPTCHA_THRESHOLD;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    if (captchaRequired && !captchaToken) return;
    setUnverified(false);
    setResendDone(false);
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

  const handleResend = () => {
    if (!email || resend.isPending || resendDone) return;
    resend.mutate(email, { onSuccess: () => setResendDone(true) });
  };

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        {/* Logo */}
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <div className={styles.brandIconInner} />
          </div>
          <div>
            <div className={styles.brandTitle}>标注中心</div>
            <div className={styles.brandSubtitle}>AI Annotation Platform</div>
          </div>
        </div>

        {/* Card */}
        <div className={styles.card}>
          <h1 className={styles.title}>登录</h1>
          <p className={styles.subtitle}>
            使用工作账号登录标注平台
          </p>

          {login.isError && (
            <div className={styles.errorBanner}>
              <Icon name="warning" size={14} />
              {(login.error as Error)?.message ?? "登录失败，请检查账号密码"}
            </div>
          )}

          {unverified && (
            <div className={styles.errorBanner}>
              {resendDone ? (
                "验证邮件已重新发送，请查收邮箱"
              ) : (
                <button type="button" onClick={handleResend} disabled={resend.isPending} className={styles.link}>
                  {resend.isPending ? "发送中…" : "重新发送验证邮件"}
                </button>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className={styles.form}>
            <div>
              <label className={styles.label}>
                账号
              </label>
              <input
                type="text"
                autoComplete="username"
                placeholder="输入账号或邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={styles.input}
              />
            </div>

            <div>
              <label className={styles.label}>
                密码
              </label>
              <div className={styles.passwordField}>
                <input
                  type={showPwd ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={clsx(styles.input, styles.passwordInput)}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className={styles.eyeButton}
                >
                  <Icon name={showPwd ? "eyeOff" : "eye"} size={14} />
                </button>
              </div>
            </div>

            {captchaRequired && (
              <div className={styles.captchaBlock}>
                <div className={styles.captchaHint}>
                  连续失败已达 {failedCount} 次，请完成验证后重试
                </div>
                <Captcha onChange={setCaptchaToken} />
              </div>
            )}

            <button
              type="submit"
              disabled={login.isPending || (captchaRequired && !captchaToken)}
              className={clsx(
                styles.primaryButton,
                login.isPending && styles.primaryButtonPending,
                captchaRequired && !captchaToken && styles.primaryButtonDisabledSoft,
              )}
            >
              {login.isPending ? "登录中..." : "登录"}
            </button>

            <div className={styles.linksRow}>
              {regStatus.data?.open_registration_enabled ? (
                <Link
                  to="/register"
                  className={styles.link}
                >
                  没有账号？立即注册
                </Link>
              ) : <span />}
              <Link
                to="/forgot-password"
                className={styles.link}
              >
                忘记密码？
              </Link>
            </div>
          </form>

          {import.meta.env.MODE !== "production" && (
            <div className={styles.devAccounts}>
              <div className={styles.devAccountsTitle}>测试账号 (密码统一: 123456)</div>
              <div>超级管理员：<span className="mono">admin</span></div>
              <div className={styles.devAccountLine}>项目管理员：<span className="mono">pm</span></div>
              <div className={styles.devAccountLine}>质检员：<span className="mono">qa</span></div>
              <div className={styles.devAccountLine}>标注员：<span className="mono">anno</span></div>
              <div className={styles.devAccountLine}>观察者：<span className="mono">viewer</span></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

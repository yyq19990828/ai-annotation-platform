import { useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "@/api/client";
import { Icon } from "@/components/ui/Icon";
import { Captcha, isCaptchaRequired } from "@/components/Captcha";
import styles from "./ForgotPasswordPage.module.css";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRequired = isCaptchaRequired();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    if (captchaRequired && !captchaToken) {
      setError("请先完成人机验证");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiClient.publicPost("/auth/forgot-password", {
        email,
        captcha_token: captchaToken,
      });
      setSent(true);
    } catch {
      setError("请求失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.brand}>
          <div className={styles.iconBadge}>
            <Icon name="key" size={16} className={styles.iconBadgeSvg} />
          </div>
          <span className={styles.brandTitle}>忘记密码</span>
        </div>

        {sent ? (
          <div className={styles.success}>
            <div className={styles.successText}>
              如果该邮箱已注册，您将收到一封包含重置链接的邮件。
            </div>
            <Link
              to="/login"
              className={styles.successLink}
            >
              返回登录
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className={styles.label}>
              邮箱地址
            </label>
            <input
              type="email"
              autoComplete="email"
              placeholder="your@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={styles.input}
            />
            {error && (
              <div className={styles.errorText}>{error}</div>
            )}
            <div className={styles.captchaWrap}>
              <Captcha onChange={setCaptchaToken} />
            </div>
            <button
              type="submit"
              disabled={loading || (captchaRequired && !captchaToken)}
              className={loading ? `${styles.primaryButton} ${styles.primaryButtonPending}` : styles.primaryButton}
            >
              {loading ? "提交中..." : "发送重置链接"}
            </button>

            <div className={styles.backLinkWrap}>
              <Link
                to="/login"
                className={styles.backLink}
              >
                返回登录
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { Link, useSearchParams, Navigate } from "react-router-dom";
import { apiClient } from "@/api/client";
import { Icon } from "@/components/ui/Icon";
import styles from "./ResetPasswordPage.module.css";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (!token) return <Navigate to="/login" replace />;

  const mismatch = confirm && password !== confirm;
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || mismatch) return;
    setLoading(true);
    setError("");
    try {
      await apiClient.publicPost("/auth/reset-password", { token, new_password: password });
      setDone(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "重置失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.brand}>
          <div className={styles.iconBadge}>
            <Icon name="lock" size={16} className={styles.iconBadgeSvg} />
          </div>
          <span className={styles.brandTitle}>重置密码</span>
        </div>

        {done ? (
          <div className={styles.success}>
            <div className={styles.successText}>
              密码已重置，请使用新密码登录。
            </div>
            <Link
              to="/login"
              className={styles.successLink}
            >
              前往登录
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className={styles.label}>
              新密码（至少 8 位，需含大小写字母和数字）
            </label>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className={styles.input}
            />

            <label className={`${styles.label} ${styles.confirmLabel}`}>
              确认密码
            </label>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className={styles.input}
            />
            {mismatch && (
              <div className={styles.mismatchText}>两次密码不一致</div>
            )}
            {error && (
              <div className={styles.errorText}>{error}</div>
            )}
            <button
              type="submit"
              disabled={loading || !!mismatch}
              className={
                loading || mismatch
                  ? `${styles.primaryButton} ${styles.primaryButtonDisabled}`
                  : styles.primaryButton
              }
            >
              {loading ? "提交中..." : "重置密码"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

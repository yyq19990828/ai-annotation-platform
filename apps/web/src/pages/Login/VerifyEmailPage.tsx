import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams, Navigate } from "react-router-dom";
import { invitationsApi } from "@/api/invitations";
import { Icon } from "@/components/ui/Icon";
import styles from "./ResetPasswordPage.module.css";

type Phase = "verifying" | "done" | "error";

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [phase, setPhase] = useState<Phase>("verifying");
  const [error, setError] = useState("");
  // StrictMode 下 effect 会跑两次；token 一次性消费，用 ref 防止第二次请求报「已使用」
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    invitationsApi
      .verifyEmail(token)
      .then(() => setPhase("done"))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "验证失败");
        setPhase("error");
      });
  }, [token]);

  if (!token) return <Navigate to="/login" replace />;

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.brand}>
          <div className={styles.iconBadge}>
            <Icon name="lock" size={16} className={styles.iconBadgeSvg} />
          </div>
          <span className={styles.brandTitle}>邮箱验证</span>
        </div>

        {phase === "verifying" && (
          <div className={styles.successText}>正在验证邮箱…</div>
        )}

        {phase === "done" && (
          <div className={styles.success}>
            <div className={styles.successText}>邮箱已验证，现在可以登录了。</div>
            <Link to="/login" className={styles.successLink}>
              前往登录
            </Link>
          </div>
        )}

        {phase === "error" && (
          <div className={styles.success}>
            <div className={styles.errorText}>{error || "验证链接无效或已过期"}</div>
            <Link to="/login" className={styles.successLink}>
              返回登录
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

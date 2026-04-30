import { useState } from "react";
import { Link, useSearchParams, Navigate } from "react-router-dom";
import { apiClient } from "@/api/client";
import { Icon } from "@/components/ui/Icon";

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
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32, justifyContent: "center" }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--radius-md)",
              background: "var(--color-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="lock" size={16} style={{ color: "#fff" }} />
          </div>
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--color-fg)" }}>重置密码</span>
        </div>

        {done ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, color: "var(--color-fg-muted)", marginBottom: 16 }}>
              密码已重置，请使用新密码登录。
            </div>
            <Link
              to="/login"
              style={{ fontSize: 13, color: "var(--color-accent)", textDecoration: "none" }}
            >
              前往登录
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 6, color: "var(--color-fg-muted)" }}>
              新密码（至少 8 位，需含大小写字母和数字）
            </label>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
              }}
            />

            <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 6, marginTop: 12, color: "var(--color-fg-muted)" }}>
              确认密码
            </label>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
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
              }}
            />
            {mismatch && (
              <div style={{ fontSize: 11.5, color: "#ef4444", marginTop: 4 }}>两次密码不一致</div>
            )}
            {error && (
              <div style={{ fontSize: 11.5, color: "#ef4444", marginTop: 6 }}>{error}</div>
            )}
            <button
              type="submit"
              disabled={loading || !!mismatch}
              style={{
                marginTop: 16,
                width: "100%",
                padding: "9px 0",
                fontSize: 13.5,
                fontWeight: 600,
                background: loading ? "var(--color-accent-muted, oklch(0.45 0.18 250))" : "var(--color-accent)",
                color: "#fff",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: loading || mismatch ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "提交中..." : "重置密码"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

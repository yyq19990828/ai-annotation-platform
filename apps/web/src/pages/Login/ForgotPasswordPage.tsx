import { useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "@/api/client";
import { Icon } from "@/components/ui/Icon";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError("");
    try {
      await apiClient.publicPost("/auth/forgot-password", { email });
      setSent(true);
    } catch {
      setError("请求失败，请稍后重试");
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
            <Icon name="key" size={16} style={{ color: "#fff" }} />
          </div>
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--color-fg)" }}>忘记密码</span>
        </div>

        {sent ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, color: "var(--color-fg-muted)", marginBottom: 16 }}>
              如果该邮箱已注册，您将收到一封包含重置链接的邮件。
            </div>
            <Link
              to="/login"
              style={{ fontSize: 13, color: "var(--color-accent)", textDecoration: "none" }}
            >
              返回登录
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 6, color: "var(--color-fg-muted)" }}>
              邮箱地址
            </label>
            <input
              type="email"
              autoComplete="email"
              placeholder="your@company.com"
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
              }}
            />
            {error && (
              <div style={{ fontSize: 11.5, color: "#ef4444", marginTop: 6 }}>{error}</div>
            )}
            <button
              type="submit"
              disabled={loading}
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
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "提交中..." : "发送重置链接"}
            </button>

            <div style={{ marginTop: 14, textAlign: "center" }}>
              <Link
                to="/login"
                style={{ fontSize: 12.5, color: "var(--color-accent)", textDecoration: "none" }}
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

import { useState } from "react";
import { Link, useSearchParams, Navigate } from "react-router-dom";
import { apiClient } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/shadcn/ui/input";

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
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-[min(380px,100%)]">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-brand text-white">
            <Icon name="lock" size={16} />
          </div>
          <span className="text-lg font-bold">重置密码</span>
        </div>

        <div className="rounded-2xl border border-border bg-card px-8 py-7 shadow-xl">
          {done ? (
            <div className="text-center">
              <div className="mb-4 text-sm text-muted-foreground">
                密码已重置，请使用新密码登录。
              </div>
              <Link to="/login" className="text-sm text-brand hover:underline">
                前往登录
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                新密码（至少 8 位，需含大小写字母和数字）
              </label>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <label className="mb-1.5 mt-3.5 block text-sm font-medium text-muted-foreground">
                确认密码
              </label>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {mismatch && <div className="mt-2 text-sm text-status-danger">两次密码不一致</div>}
              {error && <div className="mt-2 text-sm text-status-danger">{error}</div>}
              <Button
                type="submit"
                variant="primary"
                disabled={loading || !!mismatch}
                className="mt-3.5 w-full"
              >
                {loading ? "提交中..." : "重置密码"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

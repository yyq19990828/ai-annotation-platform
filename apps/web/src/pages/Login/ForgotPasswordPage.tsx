import { useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/shadcn/ui/input";
import { Captcha, isCaptchaRequired } from "@/components/Captcha";

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
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-[min(380px,100%)]">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-brand text-white">
            <Icon name="key" size={16} />
          </div>
          <span className="text-lg font-bold">忘记密码</span>
        </div>

        <div className="rounded-2xl border border-border bg-card px-8 py-7 shadow-xl">
          {sent ? (
            <div className="text-center">
              <div className="mb-4 text-sm text-muted-foreground">
                如果该邮箱已注册，您将收到一封包含重置链接的邮件。
              </div>
              <Link to="/login" className="text-[13px] text-brand hover:underline">
                返回登录
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="mb-1.5 block text-[12.5px] font-medium text-muted-foreground">
                邮箱地址
              </label>
              <Input
                type="email"
                autoComplete="email"
                placeholder="your@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              {error && <div className="mt-2 text-[13px] text-status-danger">{error}</div>}
              <div className="mt-3.5">
                <Captcha onChange={setCaptchaToken} />
              </div>
              <Button
                type="submit"
                variant="primary"
                disabled={loading || (captchaRequired && !captchaToken)}
                className="mt-3.5 w-full"
              >
                {loading ? "提交中..." : "发送重置链接"}
              </Button>

              <div className="mt-2.5 text-center">
                <Link to="/login" className="text-xs text-brand hover:underline">
                  返回登录
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

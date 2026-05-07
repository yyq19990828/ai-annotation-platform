import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { usePermissions } from "@/hooks/usePermissions";
import { ROLE_LABELS } from "@/constants/roles";
import type { PageKey } from "@/types";

const PAGE_PATH: Record<PageKey, string> = {
  dashboard: "/dashboard",
  annotate: "/dashboard",
  review: "/review",
  users: "/users",
  datasets: "/datasets",
  storage: "/storage",
  "ai-pre": "/ai-pre",
  "model-market": "/model-market",
  training: "/training",
  audit: "/audit",
  bugs: "/bugs",
  settings: "/settings",
  "admin-people": "/admin/people",
};

export function UnauthorizedPage() {
  const { role, allowedPages } = usePermissions();
  const navigate = useNavigate();
  const fallback = PAGE_PATH[allowedPages[0] ?? "dashboard"] ?? "/dashboard";

  return (
    <div style={{ padding: "80px 28px", textAlign: "center", maxWidth: 480, margin: "0 auto" }}>
      <div
        style={{
          width: 64, height: 64, borderRadius: 16,
          background: "var(--color-bg-sunken)", border: "1px solid var(--color-border)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 20px", color: "var(--color-fg-muted)",
        }}
      >
        <Icon name="shield" size={28} />
      </div>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px", color: "var(--color-fg)" }}>
        无权访问此页面
      </h2>
      <p style={{ fontSize: 13, color: "var(--color-fg-muted)", margin: "0 0 16px", lineHeight: 1.6 }}>
        您当前的角色 <Badge variant="outline">{ROLE_LABELS[role]}</Badge> 没有访问此功能的权限。
        如需获取权限，请联系项目管理员。
      </p>
      <Button variant="primary" onClick={() => navigate(fallback)}>
        <Icon name="chevLeft" size={12} />返回首页
      </Button>
    </div>
  );
}

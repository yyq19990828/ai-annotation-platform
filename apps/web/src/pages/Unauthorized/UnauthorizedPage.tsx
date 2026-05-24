import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { usePermissions } from "@/hooks/usePermissions";
import { ROLE_LABELS } from "@/constants/roles";
import type { PageKey } from "@/types";
import styles from "./UnauthorizedPage.module.css";

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
  "project-templates": "/project-templates",
  "admin-people": "/admin/people",
  "admin-analytics": "/admin/analytics",
  "admin-health": "/admin/health",
};

export function UnauthorizedPage() {
  const { role, allowedPages } = usePermissions();
  const navigate = useNavigate();
  const fallback = PAGE_PATH[allowedPages[0] ?? "dashboard"] ?? "/dashboard";

  return (
    <div className={styles.page}>
      <div className={styles.iconWrap}>
        <Icon name="shield" size={28} />
      </div>
      <h2 className={styles.title}>
        无权访问此页面
      </h2>
      <p className={styles.description}>
        您当前的角色 <Badge variant="outline">{ROLE_LABELS[role]}</Badge> 没有访问此功能的权限。
        如需获取权限，请联系项目管理员。
      </p>
      <Button variant="primary" onClick={() => navigate(fallback)}>
        <Icon name="chevLeft" size={12} />返回首页
      </Button>
    </div>
  );
}

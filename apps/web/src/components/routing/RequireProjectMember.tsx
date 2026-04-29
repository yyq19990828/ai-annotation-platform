import { useEffect, type ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useProject } from "@/hooks/useProjects";
import { useToastStore } from "@/components/ui/Toast";
import { ApiError } from "@/api/client";

interface Props {
  children: ReactNode;
}

/**
 * 在进入 `/projects/:id/...` 类受限页面之前，先确认当前用户对该项目可见。
 * 后端 `GET /projects/:id` 已按成员资格过滤，403/404 直接弹回项目列表，
 * 让用户在跳转前就拿到提示，而不是进到工作台后才被服务端 403。
 */
export function RequireProjectMember({ children }: Props) {
  const { id } = useParams<{ id: string }>();
  const projectId = id ?? "";
  const { data, isLoading, isError, error } = useProject(projectId);
  const pushToast = useToastStore((s) => s.push);

  const denied = isError && error instanceof ApiError && (error.status === 403 || error.status === 404);

  useEffect(() => {
    if (denied) {
      pushToast({
        msg: error?.status === 404 ? "项目不存在或已被删除" : "你没有权限进入该项目",
        kind: "warning",
      });
    }
  }, [denied, error, pushToast]);

  if (!projectId) return <Navigate to="/projects" replace />;
  if (isLoading) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--color-fg-muted)", fontSize: 13 }}>
        正在校验项目权限…
      </div>
    );
  }
  if (denied || !data) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

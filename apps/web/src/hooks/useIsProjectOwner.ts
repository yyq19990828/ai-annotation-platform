import { useAuthStore } from "@/stores/authStore";
import type { ProjectResponse } from "@/api/projects";

/** super_admin 或项目 owner_id 为当前用户时返回 true */
export function useIsProjectOwner(project?: ProjectResponse | null): boolean {
  const user = useAuthStore((s) => s.user);
  if (!user || !project) return false;
  if (user.role === "super_admin") return true;
  return project.owner_id === user.id;
}

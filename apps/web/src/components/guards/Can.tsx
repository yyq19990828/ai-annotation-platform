import { usePermissions } from "@/hooks/usePermissions";
import type { Permission } from "@/constants/permissions";

interface CanProps {
  permission: Permission | Permission[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function Can({ permission, children, fallback = null }: CanProps) {
  const { hasPermission, hasAnyPermission } = usePermissions();
  const allowed = Array.isArray(permission)
    ? hasAnyPermission(...permission)
    : hasPermission(permission);
  return allowed ? <>{children}</> : <>{fallback}</>;
}

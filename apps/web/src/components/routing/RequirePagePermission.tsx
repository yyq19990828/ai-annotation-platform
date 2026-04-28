import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import type { PageKey } from "@/types";

interface Props {
  pageKey: PageKey;
  children: ReactNode;
}

export function RequirePagePermission({ pageKey, children }: Props) {
  const { canAccessPage } = usePermissions();
  if (!canAccessPage(pageKey)) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <>{children}</>;
}

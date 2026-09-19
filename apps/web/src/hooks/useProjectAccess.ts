import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { projectsApi, type ProjectAccessResponse, type ProjectCapability } from "@/api/projects";
import { useAuthStore } from "@/stores/authStore";

/**
 * Cache key for one account's access on one actual project.  Binding both the
 * account and the project means an account switch or a project switch can never
 * reuse another context's access; `bindAuthQueryCache` still cancels in-flight
 * old-account responses when credentials change.
 */
export function projectAccessQueryKey(
  projectId: string | undefined,
  userId: string | null,
  token: string | null,
) {
  return ["project-access", projectId ?? null, userId, token] as const;
}

export interface ProjectAccessState {
  access: ProjectAccessResponse | undefined;
  capabilities: ReadonlySet<ProjectCapability>;
  hasCapability: (...capabilities: ProjectCapability[]) => boolean;
  projectRole: ProjectAccessResponse["project_role"];
  /** Membership CAS version, echoed on role changes. */
  membershipVersion: number | null;
  isManager: boolean;
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * Resolve the current account's project-scoped access (capabilities + project
 * role) for a project id.  This is a presentation guard: the server remains the
 * authorization source and may still reject a request.
 */
export function useProjectAccess(
  projectId: string | undefined,
  options?: { enabled?: boolean },
): ProjectAccessState & Pick<UseQueryResult<ProjectAccessResponse>, "refetch"> {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const token = useAuthStore((state) => state.token);
  const enabled = (options?.enabled ?? true) && Boolean(projectId) && Boolean(userId);

  const query = useQuery({
    queryKey: projectAccessQueryKey(projectId, userId, token),
    queryFn: ({ signal }) => projectsApi.getAccess(projectId!, { signal }),
    enabled,
    staleTime: 30_000,
  });

  const access = query.data;
  const capabilities = new Set<ProjectCapability>(access?.capabilities ?? []);

  return {
    access,
    capabilities,
    hasCapability: (...required: ProjectCapability[]) =>
      required.every((capability) => capabilities.has(capability)),
    projectRole: access?.project_role ?? null,
    membershipVersion: access?.membership_version ?? null,
    isManager: access?.is_manager ?? false,
    isPending: query.isPending,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

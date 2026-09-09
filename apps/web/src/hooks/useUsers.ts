import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  usersApi,
  type InvitePayload,
  type OffboardingCommitRequest,
  type UserStatusFilter,
} from "../api/users";

export function useUsers(params?: {
  role?: string;
  project_id?: string;
  status?: UserStatusFilter;
}) {
  return useQuery({
    queryKey: ["users", params],
    queryFn: () => usersApi.list(params),
  });
}

export function useOffboardingPreview(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["users", "offboarding-preview", userId],
    queryFn: () => usersApi.offboardingPreview(userId as string),
    enabled: enabled && !!userId,
    retry: false,
  });
}

export function useOffboardUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: OffboardingCommitRequest }) =>
      usersApi.offboard(userId, payload),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["users", "offboarding-preview", variables.userId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["project-members"] });
    },
  });
}

export function useReactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string }) =>
      usersApi.reactivate(userId, reason ? { reason } : undefined),
    onSuccess: (_user, variables) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["users", "offboarding-preview", variables.userId] });
    },
  });
}

// v0.8.3 · UsersPage「本周活跃」/「在线」聚合卡（基于 last_seen_at）
export function useUsersStats() {
  return useQuery({
    queryKey: ["users", "stats"],
    queryFn: () => usersApi.stats(),
    refetchInterval: 60_000,
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: InvitePayload) => usersApi.invite(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["invitations"] });
    },
  });
}

export function useChangeUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      usersApi.changeRole(userId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => usersApi.deactivate(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export interface DeleteUserVariables {
  userId: string;
  transferToUserId?: string;
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: DeleteUserVariables | string) => {
      const v: DeleteUserVariables = typeof vars === "string" ? { userId: vars } : vars;
      return usersApi.remove(
        v.userId,
        v.transferToUserId ? { transfer_to_user_id: v.transferToUserId } : undefined,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useAssignUserGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, groupId }: { userId: string; groupId: string | null }) =>
      usersApi.assignGroup(userId, groupId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  invitationsApi,
  type InvitationPageParams,
  type InvitationStatus,
} from "@/api/invitations";
import { useAuthStore } from "@/stores/authStore";

export function useInvitations(params?: {
  status?: InvitationStatus | "all";
  scope?: "me" | "all";
}) {
  const ownerId = useAuthStore((state) => state.user?.id);
  return useQuery({
    queryKey: ["invitations", ownerId, params ?? {}],
    queryFn: ({ signal }) => invitationsApi.list(params, signal),
  });
}

export function useInvitationPage(params: InvitationPageParams) {
  const ownerId = useAuthStore((state) => state.user?.id);
  return useQuery({
    queryKey: ["invitations", "page", ownerId, params],
    queryFn: ({ signal }) => invitationsApi.page(params, signal),
  });
}

export function useInvitationStats(params: Omit<InvitationPageParams, "page" | "page_size">) {
  const ownerId = useAuthStore((state) => state.user?.id);
  return useQuery({
    queryKey: ["invitations", "stats", ownerId, params],
    queryFn: ({ signal }) => invitationsApi.stats(params, signal),
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invitationsApi.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invitations"] }),
  });
}

export function useResendInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invitationsApi.resend(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invitations"] }),
  });
}

export function useSendInvitationEmail() {
  return useMutation({
    mutationFn: (id: string) => invitationsApi.sendEmail(id),
  });
}

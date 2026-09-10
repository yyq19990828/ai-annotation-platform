import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  invitationsApi,
  type InvitationPageParams,
  type InvitationStatus,
} from "@/api/invitations";

export function useInvitations(params?: {
  status?: InvitationStatus | "all";
  scope?: "me" | "all";
}) {
  return useQuery({
    queryKey: ["invitations", params ?? {}],
    queryFn: () => invitationsApi.list(params),
  });
}

export function useInvitationPage(params: InvitationPageParams) {
  return useQuery({
    queryKey: ["invitations", "page", params],
    queryFn: () => invitationsApi.page(params),
  });
}

export function useInvitationStats(params: Omit<InvitationPageParams, "page" | "page_size">) {
  return useQuery({
    queryKey: ["invitations", "stats", params],
    queryFn: () => invitationsApi.stats(params),
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

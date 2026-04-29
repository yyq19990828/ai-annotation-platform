import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invitationsApi, type InvitationStatus } from "@/api/invitations";

export function useInvitations(params?: { status?: InvitationStatus | "all"; scope?: "me" | "all" }) {
  return useQuery({
    queryKey: ["invitations", params ?? {}],
    queryFn: () => invitationsApi.list(params),
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

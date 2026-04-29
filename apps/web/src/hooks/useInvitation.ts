import { useMutation, useQuery } from "@tanstack/react-query";
import {
  invitationsApi,
  type RegisterPayload,
} from "../api/invitations";
import { usersApi, type InvitePayload } from "../api/users";

export function useInviteUser() {
  return useMutation({
    mutationFn: (payload: InvitePayload) => usersApi.invite(payload),
  });
}

export function useResolveInvitation(token: string | null) {
  return useQuery({
    queryKey: ["invitation", token],
    queryFn: () => invitationsApi.resolve(token!),
    enabled: !!token,
    retry: false,
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (payload: RegisterPayload) => invitationsApi.register(payload),
  });
}

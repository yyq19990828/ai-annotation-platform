import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, type InvitePayload } from "../api/users";

export function useUsers(params?: { role?: string }) {
  return useQuery({
    queryKey: ["users", params],
    queryFn: () => usersApi.list(params),
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: InvitePayload) => usersApi.invite(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { groupsApi, type GroupCreatePayload, type GroupUpdatePayload } from "@/api/groups";

export function useGroups(enabled = true) {
  return useQuery({
    queryKey: ["groups"],
    queryFn: () => groupsApi.list(),
    enabled,
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: GroupCreatePayload) => groupsApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groups"] });
    },
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: GroupUpdatePayload }) =>
      groupsApi.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => groupsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

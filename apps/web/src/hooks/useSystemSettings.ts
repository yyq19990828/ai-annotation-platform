import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi, type SystemSettingsPatch } from "../api/settings";

export function useSystemSettings(enabled = true) {
  return useQuery({
    queryKey: ["system-settings"],
    queryFn: settingsApi.getSystem,
    enabled,
  });
}

export function useUpdateSystemSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SystemSettingsPatch) => settingsApi.updateSystem(patch),
    onSuccess: (data) => {
      qc.setQueryData(["system-settings"], data);
    },
  });
}

export function useTestSmtp() {
  return useMutation({
    mutationFn: () => settingsApi.testSmtp(),
  });
}

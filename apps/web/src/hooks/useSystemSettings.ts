import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi, type SystemSettingsPatch, type SystemSettingsReset } from "../api/settings";
import { isCurrentAuthOwner, useAuthStore } from "@/stores/authStore";

export function useSystemSettings(enabled = true) {
  const userId = useAuthStore((state) => state.user?.id);
  return useQuery({
    queryKey: ["system-settings", userId],
    queryFn: settingsApi.getSystem,
    enabled: enabled && !!userId,
  });
}

export function useUpdateSystemSettings() {
  const qc = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id);
  return useMutation({
    mutationFn: (patch: SystemSettingsPatch) => settingsApi.updateSystem(patch),
    onSuccess: (data) => {
      if (userId && isCurrentAuthOwner(userId)) qc.setQueryData(["system-settings", userId], data);
    },
  });
}

export function useResetSystemSettings() {
  const qc = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id);
  return useMutation({
    mutationFn: (payload: SystemSettingsReset) => settingsApi.resetSystem(payload),
    onSuccess: (data) => {
      if (userId && isCurrentAuthOwner(userId)) qc.setQueryData(["system-settings", userId], data);
    },
  });
}

export function useTestSmtp() {
  return useMutation({
    mutationFn: () => settingsApi.testSmtp(),
  });
}

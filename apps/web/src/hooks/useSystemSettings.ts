import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "../api/settings";

export function useSystemSettings(enabled = true) {
  return useQuery({
    queryKey: ["system-settings"],
    queryFn: settingsApi.getSystem,
    enabled,
  });
}

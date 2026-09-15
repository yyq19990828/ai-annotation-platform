import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  notificationsApi,
  type NotificationPreferencePatch,
  type NotificationPreferencesResponse,
} from "@/api/notifications";
import { isCurrentAuthOwner, useAuthStore } from "@/stores/authStore";

/**
 * 通知偏好的唯一查询入口（key 含账号）。个人设置页、工作台设置和
 * useNotificationSocket 共享同一份缓存；账号切换时 authQueryCache 会
 * clear()，不会串号。
 */
export function notificationPreferencesKey(userId: string | null | undefined) {
  return ["notification-preferences", userId ?? null] as const;
}

export function useNotificationPreferences(enabled = true) {
  const userId = useAuthStore((s) => s.user?.id);
  return useQuery<NotificationPreferencesResponse>({
    queryKey: notificationPreferencesKey(userId),
    queryFn: () => notificationsApi.getPreferences(),
    enabled: enabled && !!userId,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/**
 * 按类型更新偏好（至少提供 in_app/toast 之一）。`owner` 在调用点同步捕获
 * 当前账号；mutationFn 由 react-query 延迟批处理执行，届时账号可能已被
 * 替换，迟到的响应不得作用于后续账号。
 */
export function useUpdateNotificationPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: string; owner?: string } & NotificationPreferencePatch) => {
      const owner = input.owner ?? useAuthStore.getState().user?.id;
      const patch: NotificationPreferencePatch = {};
      if (input.in_app !== undefined) patch.in_app = input.in_app;
      if (input.toast !== undefined) patch.toast = input.toast;
      return notificationsApi.updatePreference(input.type, patch).then((result) => ({
        result,
        owner,
      }));
    },
    onSuccess: ({ owner }) => {
      // 账号已切换：不要为新账号触碰旧 key（缓存已被 authQueryCache 清空）
      if (!owner || !isCurrentAuthOwner(owner)) return;
      void qc.invalidateQueries({ queryKey: notificationPreferencesKey(owner) });
    },
  });
}

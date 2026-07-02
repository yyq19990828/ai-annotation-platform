import { useCallback } from "react";

import { authApi } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";

/**
 * v0.20.19 · 二次推理面板显隐偏好 (跨设备)。
 *
 * 真值源 = 服务端 `User.preferences.ui.secondary_bar_hidden` (经 authStore 响应式订阅)。
 * 与 useTheme 同范式: 切换时乐观更新 authStore + PATCH `{ui:{secondary_bar_hidden}}`
 * (后端 ui 子树深合并, 不冲掉 theme)。缺省 false = 显示 (不回归现状)。
 */
export function useSecondaryBarHiddenPref() {
  const hidden = useAuthStore(
    (s) => s.user?.preferences?.ui?.secondary_bar_hidden ?? false,
  );

  const setHidden = useCallback((next: boolean) => {
    const { user, setUser } = useAuthStore.getState();
    if (!user) return;
    const prevPrefs = user.preferences ?? {};
    setUser({
      ...user,
      preferences: {
        ...prevPrefs,
        ui: { ...prevPrefs.ui, secondary_bar_hidden: next },
      },
    });
    void authApi.updatePreferences({ ui: { secondary_bar_hidden: next } }).catch(
      () => {},
    );
  }, []);

  return { hidden, setHidden };
}

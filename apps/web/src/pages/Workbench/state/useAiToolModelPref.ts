import { useCallback, useEffect, useRef, useState } from "react";
import { authApi } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";

/**
 * v0.18.25 · 工作台交互工具「引擎(模型)选择」的用户级偏好。
 *
 * 与 {@link useAiToolParamPrefs} 同窝在 `User.preferences.ai` 下 (各占一个子键:
 * `params_by_backend` / `model_by_backend`)，跟用户走、跨设备、每位标注员各自一份。
 * 按 backend id 分桶: 不同 backend 的可选 model 集不同, 各记各的。
 *
 * 读取优先级链由调用方实现: 本会话显式选择 > 本偏好 (savedModelId) > /setup 默认 model
 * (见 useMLCapabilities 的 preferredModelId 入参)。
 *
 * 注: 后端 `ai` 子树为「深一层合并」(me.py update_preferences), 故本 hook 只提交
 * `{ai:{model_by_backend}}` 不会冲掉 `params_by_backend`。
 */
export function useAiToolModelPref(backendId: string | null | undefined) {
  const userId = useAuthStore((s) => s.user?.id);
  const [byBackend, setByBackend] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const pendingRef = useRef<Record<string, string> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setLoaded(false);
      return;
    }
    authApi
      .getPreferences()
      .then((res) => {
        if (!active) return;
        setByBackend(res.ai?.model_by_backend ?? {});
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const savedModelId = backendId ? byBackend[backendId] : undefined;

  const save = useCallback(
    (modelId: string) => {
      if (!backendId) return;
      setByBackend((prev) => {
        const next = { ...prev, [backendId]: modelId };
        pendingRef.current = next;
        return next;
      });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const payload = pendingRef.current;
        if (!payload) return;
        authApi
          .updatePreferences({ ai: { model_by_backend: payload } })
          .catch(() => {});
      }, 600);
    },
    [backendId],
  );

  return { savedModelId, loaded, save };
}

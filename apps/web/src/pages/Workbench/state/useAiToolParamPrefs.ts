import { useCallback, useEffect, useRef, useState } from "react";
import { authApi } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";

/**
 * 工作台 AI 工具参数的用户级偏好。
 *
 * 不同 ML backend 的 /setup.params schema 不同（gsam2 有 box/text_threshold，sam3 有
 * score_threshold 等），故按 backend id 分桶存取。每位用户各自一份 User.preferences.ai，
 * 天然隔离——多账户在同一项目调参互不影响。
 *
 * 读取优先级链由调用方实现：用户偏好（本 hook）→ 后端 /setup 默认（InteractiveToolBar.deriveDefaults）。
 */
export function useAiToolParamPrefs(backendId: string | null | undefined) {
  const userId = useAuthStore((s) => s.user?.id);
  const [byBackend, setByBackend] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [loaded, setLoaded] = useState(false);
  const pendingRef = useRef<Record<string, Record<string, unknown>> | null>(null);
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
        setByBackend(res.ai?.params_by_backend ?? {});
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

  const savedParams = backendId ? byBackend[backendId] : undefined;

  const save = useCallback(
    (params: Record<string, unknown>) => {
      if (!backendId) return;
      setByBackend((prev) => {
        const next = { ...prev, [backendId]: params };
        pendingRef.current = next;
        return next;
      });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const payload = pendingRef.current;
        if (!payload) return;
        authApi
          .updatePreferences({ ai: { params_by_backend: payload } })
          .catch(() => {});
      }, 600);
    },
    [backendId],
  );

  return { savedParams, loaded, save };
}

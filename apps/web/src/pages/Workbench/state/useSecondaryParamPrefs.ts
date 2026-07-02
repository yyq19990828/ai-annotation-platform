import { useCallback, useEffect, useRef, useState } from "react";
import { authApi } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";

/**
 * v0.20.17 · 单框二次推理的「参数 + 模型变体」用户级偏好。
 *
 * 与 useAiToolParamPrefs 同范式 (User.preferences.ai 子树, 后端深一层合并), 但按
 * `backendId:modelId` 分桶 (二次推理选具体 model, 比 backend 粒度更细, 避免同 backend 多 model
 * 的档位/阈值互相串)。一个桶同存该 model 的 params 与 variants 两组 KV。
 *
 * 整份 map 一次加载 (Bar 在多个能力间切换, 需全量), 暴露 debounce save; 保存失败静默降级
 * (Bar 仍用组件内 state), 不阻断推理。
 */
export type SecondaryPrefEntry = {
  params?: Record<string, unknown>;
  variants?: Record<string, unknown>;
};

export function useSecondaryParamPrefs() {
  const userId = useAuthStore((s) => s.user?.id);
  const [byModel, setByModel] = useState<Record<string, SecondaryPrefEntry>>({});
  const [loaded, setLoaded] = useState(false);
  const pendingRef = useRef<Record<string, SecondaryPrefEntry> | null>(null);
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
        setByModel(res.ai?.secondary_by_model ?? {});
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

  const save = useCallback((key: string, entry: SecondaryPrefEntry) => {
    setByModel((prev) => {
      const next = { ...prev, [key]: { ...prev[key], ...entry } };
      pendingRef.current = next;
      return next;
    });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const payload = pendingRef.current;
      if (!payload) return;
      authApi
        .updatePreferences({ ai: { secondary_by_model: payload } })
        .catch(() => {});
    }, 600);
  }, []);

  return { byModel, loaded, save };
}

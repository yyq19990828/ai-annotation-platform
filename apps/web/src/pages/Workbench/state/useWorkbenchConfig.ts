import { useCallback, useEffect, useState } from "react";
import {
  authApi,
  DEFAULT_WORKBENCH_PREFERENCES,
  type WorkbenchPreferences,
} from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";

interface WorkbenchConfigState {
  config: WorkbenchPreferences;
  loaded: boolean;
  saving: boolean;
  update: (patch: Partial<WorkbenchPreferences>) => Promise<void>;
}

function merge(remote: Partial<WorkbenchPreferences> | undefined | null): WorkbenchPreferences {
  return { ...DEFAULT_WORKBENCH_PREFERENCES, ...(remote ?? {}) };
}

/**
 * v0.9.41 · 工作台渲染配置 hook（I17）。
 * 首次挂载从 /auth/me/preferences 拉取；本地 setState 乐观更新，PATCH 失败时回滚到上次成功值。
 *
 * 多组件可同时挂载本 hook —— 由于背后只有一个 API 端点且服务端始终返回完整对象，
 * 不会出现部分字段冲突；如果未来需要全局共享，可上提到 zustand store。
 */
export function useWorkbenchConfig(): WorkbenchConfigState {
  const user = useAuthStore((s) => s.user);
  const [config, setConfig] = useState<WorkbenchPreferences>(() =>
    merge(user?.preferences?.workbench),
  );
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!user) {
      setLoaded(false);
      return;
    }
    authApi
      .getPreferences()
      .then((res) => {
        if (!active) return;
        setConfig(merge(res.workbench));
        setLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const update = useCallback(
    async (patch: Partial<WorkbenchPreferences>) => {
      const prev = config;
      const next = { ...prev, ...patch };
      setConfig(next);
      setSaving(true);
      try {
        const res = await authApi.updatePreferences({ workbench: next });
        setConfig(merge(res.workbench));
      } catch {
        setConfig(prev);
      } finally {
        setSaving(false);
      }
    },
    [config],
  );

  return { config, loaded, saving, update };
}

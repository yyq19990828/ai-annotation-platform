import { useCallback, useEffect, useMemo, useState } from "react";
import {
  authApi,
  DEFAULT_WORKBENCH_PREFERENCES,
  type WorkbenchPreferences,
} from "@/api/auth";
import type { ProjectRenderingConfig } from "@/api/projects";
import { useAuthStore } from "@/stores/authStore";

// v0.10.10 · I17.3 · 项目级覆盖的字段名集合（用于 SettingsPage badge 与控件 disabled）。
// 与 ProjectRenderingConfig 字段同集，不含 longTaskSampleRate（后者属用户/环境层）。
export type LockableField = keyof Omit<WorkbenchPreferences, "longTaskSampleRate">;

interface WorkbenchConfigState {
  config: WorkbenchPreferences;
  loaded: boolean;
  saving: boolean;
  update: (patch: Partial<WorkbenchPreferences>) => Promise<void>;
  /** v0.10.10 · I17.3 · 被项目级覆盖的字段名（用户级修改会立刻被合并覆盖）。 */
  lockedFields: LockableField[];
}

function mergeUser(
  remote: Partial<WorkbenchPreferences> | undefined | null,
): WorkbenchPreferences {
  return { ...DEFAULT_WORKBENCH_PREFERENCES, ...(remote ?? {}) };
}

/**
 * v0.10.10 · 把项目级 rendering_config 合进用户级 preferences。
 * 仅 non-null/non-undefined 字段覆盖；其余字段沿用用户级。
 * 同时返回被覆盖的字段名列表，供 UI 渲染「项目锁定」badge。
 */
function applyProjectOverride(
  user: WorkbenchPreferences,
  project: ProjectRenderingConfig | null | undefined,
): { merged: WorkbenchPreferences; lockedFields: LockableField[] } {
  if (!project) return { merged: user, lockedFields: [] };
  const merged: WorkbenchPreferences = { ...user };
  const locked: LockableField[] = [];
  const fields: LockableField[] = [
    "smoothImage",
    "cssImageFilter",
    "controlPointsSize",
    "snapToGrid",
  ];
  for (const key of fields) {
    const v = project[key];
    if (v !== null && v !== undefined) {
      (merged[key] as WorkbenchPreferences[typeof key]) =
        v as WorkbenchPreferences[typeof key];
      locked.push(key);
    }
  }
  return { merged, lockedFields: locked };
}

/**
 * v0.9.41 · 工作台渲染配置 hook（I17）。
 * v0.10.10 · I17.3 · 支持项目级覆盖：合并优先级 = DEFAULTS → user prefs → project rendering_config。
 *
 * 多组件可同时挂载本 hook —— Settings 页面不传 project (= 纯用户视图);
 * 工作台传 currentProject.rendering_config，合并后驱动 KonvaImage 等。
 */
export function useWorkbenchConfig(
  projectRenderingConfig?: ProjectRenderingConfig | null,
): WorkbenchConfigState {
  const user = useAuthStore((s) => s.user);
  const [userConfig, setUserConfig] = useState<WorkbenchPreferences>(() =>
    mergeUser(user?.preferences?.workbench),
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
        setUserConfig(mergeUser(res.workbench));
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
      const prev = userConfig;
      const next = { ...prev, ...patch };
      setUserConfig(next);
      setSaving(true);
      try {
        const res = await authApi.updatePreferences({ workbench: next });
        setUserConfig(mergeUser(res.workbench));
      } catch {
        setUserConfig(prev);
      } finally {
        setSaving(false);
      }
    },
    [userConfig],
  );

  const { merged, lockedFields } = useMemo(
    () => applyProjectOverride(userConfig, projectRenderingConfig),
    [userConfig, projectRenderingConfig],
  );

  return { config: merged, loaded, saving, update, lockedFields };
}

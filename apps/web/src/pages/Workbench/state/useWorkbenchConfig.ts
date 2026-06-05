import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  authApi,
  DEFAULT_WORKBENCH_PREFERENCES,
  type FloatingInspectorState,
  type TriViewFloatState,
  type WorkbenchLayoutPreferences,
  type WorkbenchPreferences,
} from "@/api/auth";
import type { ProjectRenderingConfig } from "@/api/projects";
import { useAuthStore } from "@/stores/authStore";

// v0.10.10 · I17.3 · 项目级覆盖的字段名集合（用于 SettingsPage badge 与控件 disabled）。
// 与 ProjectRenderingConfig 字段同集，不含 longTaskSampleRate / layout（后两者属用户层）。
export type LockableField =
  | "smoothImage"
  | "cssImageFilter"
  | "controlPointsSize"
  | "snapToGrid";

export type WorkbenchLayoutPatch = Omit<
  Partial<WorkbenchLayoutPreferences>,
  "floatingInspector" | "triViewFloat"
> & {
  floatingInspector?: Partial<FloatingInspectorState> | null;
  triViewFloat?: Partial<TriViewFloatState> | null;
};

interface WorkbenchConfigState {
  config: WorkbenchPreferences;
  layout: WorkbenchLayoutPreferences;
  loaded: boolean;
  saving: boolean;
  update: (patch: Partial<WorkbenchPreferences>) => Promise<void>;
  setLayout: (patch: WorkbenchLayoutPatch) => void;
  /** v0.10.10 · I17.3 · 被项目级覆盖的字段名（用户级修改会立刻被合并覆盖）。 */
  lockedFields: LockableField[];
}

function mergeUser(
  remote: Partial<WorkbenchPreferences> | undefined | null,
): WorkbenchPreferences {
  return {
    ...DEFAULT_WORKBENCH_PREFERENCES,
    ...(remote ?? {}),
    layout: mergeLayout(remote?.layout),
  };
}

const LAYOUT_STORAGE_KEYS = {
  leftOpen: "workbench.leftOpen",
  rightOpen: "workbench.rightOpen",
  leftWidth: "workbench.leftWidth",
  rightWidth: "workbench.rightWidth",
  floatingInspector: "workbench.floatingInspector",
  triViewFloat: "workbench.triViewFloat",
};

function readBool(key: string): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* ignore localStorage failures */
  }
  return undefined;
}

function readClampedNumber(
  key: string,
  min: number,
  max: number,
): number | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const v = Number(window.localStorage.getItem(key));
    return Number.isFinite(v) && v >= min && v <= max ? v : undefined;
  } catch {
    return undefined;
  }
}

function readJsonObject<T extends object>(key: string): Partial<T> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readLocalLayout(): WorkbenchLayoutPatch {
  return {
    leftOpen: readBool(LAYOUT_STORAGE_KEYS.leftOpen),
    rightOpen: readBool(LAYOUT_STORAGE_KEYS.rightOpen),
    leftWidth: readClampedNumber(LAYOUT_STORAGE_KEYS.leftWidth, 200, 560),
    rightWidth: readClampedNumber(LAYOUT_STORAGE_KEYS.rightWidth, 220, 600),
    floatingInspector: readJsonObject<FloatingInspectorState>(
      LAYOUT_STORAGE_KEYS.floatingInspector,
    ),
    triViewFloat: readJsonObject<TriViewFloatState>(
      LAYOUT_STORAGE_KEYS.triViewFloat,
    ),
  };
}

function writeLocalLayout(layout: WorkbenchLayoutPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEYS.leftOpen,
      layout.leftOpen ? "1" : "0",
    );
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEYS.rightOpen,
      layout.rightOpen ? "1" : "0",
    );
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEYS.leftWidth,
      String(layout.leftWidth),
    );
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEYS.rightWidth,
      String(layout.rightWidth),
    );
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEYS.floatingInspector,
      JSON.stringify(layout.floatingInspector),
    );
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEYS.triViewFloat,
      JSON.stringify(layout.triViewFloat),
    );
  } catch {
    /* local fallback is best-effort */
  }
}

function mergeFloatingInspector(
  remote: Partial<FloatingInspectorState> | null | undefined,
): FloatingInspectorState {
  return {
    ...DEFAULT_WORKBENCH_PREFERENCES.layout.floatingInspector,
    ...(remote ?? {}),
  };
}

function mergeTriViewFloat(
  remote: Partial<TriViewFloatState> | null | undefined,
): TriViewFloatState {
  return {
    ...DEFAULT_WORKBENCH_PREFERENCES.layout.triViewFloat,
    ...(remote ?? {}),
  };
}

function mergeLayout(
  remote: Partial<WorkbenchLayoutPreferences> | null | undefined,
): WorkbenchLayoutPreferences {
  const local = readLocalLayout();
  const merged = {
    ...DEFAULT_WORKBENCH_PREFERENCES.layout,
    ...local,
    ...(remote ?? {}),
  };
  return {
    leftOpen: merged.leftOpen ?? DEFAULT_WORKBENCH_PREFERENCES.layout.leftOpen,
    rightOpen: merged.rightOpen ?? DEFAULT_WORKBENCH_PREFERENCES.layout.rightOpen,
    leftWidth: merged.leftWidth ?? DEFAULT_WORKBENCH_PREFERENCES.layout.leftWidth,
    rightWidth: merged.rightWidth ?? DEFAULT_WORKBENCH_PREFERENCES.layout.rightWidth,
    floatingInspector: mergeFloatingInspector({
      ...(local.floatingInspector ?? {}),
      ...(remote?.floatingInspector ?? {}),
    }),
    triViewFloat: mergeTriViewFloat({
      ...(local.triViewFloat ?? {}),
      ...(remote?.triViewFloat ?? {}),
    }),
  };
}

function applyLayoutPatch(
  current: WorkbenchLayoutPreferences,
  patch: WorkbenchLayoutPatch,
): WorkbenchLayoutPreferences {
  return {
    ...current,
    ...patch,
    floatingInspector:
      patch.floatingInspector === undefined
        ? current.floatingInspector
        : mergeFloatingInspector({
            ...current.floatingInspector,
            ...(patch.floatingInspector ?? {}),
          }),
    triViewFloat:
      patch.triViewFloat === undefined
        ? current.triViewFloat
        : mergeTriViewFloat({
            ...current.triViewFloat,
            ...(patch.triViewFloat ?? {}),
          }),
  };
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
  const userId = user?.id;
  const [userConfig, setUserConfig] = useState<WorkbenchPreferences>(() =>
    mergeUser(user?.preferences?.workbench),
  );
  const userConfigRef = useRef(userConfig);
  const layoutSaveTimerRef = useRef<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    userConfigRef.current = userConfig;
  }, [userConfig]);

  useEffect(
    () => () => {
      if (layoutSaveTimerRef.current !== null) {
        window.clearTimeout(layoutSaveTimerRef.current);
      }
    },
    [],
  );

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
        const next = mergeUser(res.workbench);
        setUserConfig(next);
        writeLocalLayout(next.layout);
        setLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const update = useCallback(
    async (patch: Partial<WorkbenchPreferences>) => {
      const prev = userConfigRef.current;
      const next = {
        ...prev,
        ...patch,
        layout: patch.layout ? mergeLayout(patch.layout) : prev.layout,
      };
      userConfigRef.current = next;
      setUserConfig(next);
      setSaving(true);
      try {
        const res = await authApi.updatePreferences({ workbench: next });
        const saved = mergeUser(res.workbench);
        userConfigRef.current = saved;
        setUserConfig(saved);
        writeLocalLayout(saved.layout);
      } catch {
        userConfigRef.current = prev;
        setUserConfig(prev);
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const setLayout = useCallback(
    (patch: WorkbenchLayoutPatch) => {
      const prev = userConfigRef.current;
      const next = {
        ...prev,
        layout: applyLayoutPatch(prev.layout, patch),
      };
      userConfigRef.current = next;
      setUserConfig(next);
      writeLocalLayout(next.layout);

      if (layoutSaveTimerRef.current !== null) {
        window.clearTimeout(layoutSaveTimerRef.current);
      }
      if (!userId) return;

      layoutSaveTimerRef.current = window.setTimeout(() => {
        const payload = userConfigRef.current;
        setSaving(true);
        authApi
          .updatePreferences({ workbench: payload })
          .then((res) => {
            const saved = mergeUser(res.workbench);
            userConfigRef.current = saved;
            setUserConfig(saved);
            writeLocalLayout(saved.layout);
          })
          .catch((err) => {
            console.warn("Failed to persist workbench layout preferences", err);
          })
          .finally(() => setSaving(false));
      }, 300);
    },
    [userId],
  );

  const { merged, lockedFields } = useMemo(
    () => applyProjectOverride(userConfig, projectRenderingConfig),
    [userConfig, projectRenderingConfig],
  );

  return {
    config: merged,
    layout: userConfig.layout,
    loaded,
    saving,
    update,
    setLayout,
    lockedFields,
  };
}

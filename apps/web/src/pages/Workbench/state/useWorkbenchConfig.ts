import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  authApi,
  DEFAULT_WORKBENCH_PREFERENCES,
  type FloatingPanelState,
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
  | "floatingTaskQueue"
  | "floatingClassPalette"
  | "floatingInspector"
  | "floatingDiscussion"
  | "triViewFloat"
> & {
  floatingTaskQueue?: Partial<FloatingPanelState> | null;
  floatingClassPalette?: Partial<FloatingPanelState> | null;
  floatingInspector?: Partial<FloatingPanelState> | null;
  floatingDiscussion?: Partial<FloatingPanelState> | null;
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
  options?: { preferLocalLayout?: boolean },
): WorkbenchPreferences {
  return {
    ...DEFAULT_WORKBENCH_PREFERENCES,
    ...(remote ?? {}),
    layout: mergeLayout(remote?.layout, options),
  };
}

const LAYOUT_STORAGE_KEYS = {
  leftOpen: "workbench.leftOpen",
  rightOpen: "workbench.rightOpen",
  leftWidth: "workbench.leftWidth",
  rightWidth: "workbench.rightWidth",
  floatingTaskQueue: "workbench.floatingTaskQueue",
  floatingClassPalette: "workbench.floatingClassPalette",
  floatingInspector: "workbench.floatingInspector",
  floatingDiscussion: "workbench.floatingDiscussion",
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
    floatingTaskQueue: readJsonObject<FloatingPanelState>(
      LAYOUT_STORAGE_KEYS.floatingTaskQueue,
    ),
    floatingClassPalette: readJsonObject<FloatingPanelState>(
      LAYOUT_STORAGE_KEYS.floatingClassPalette,
    ),
    floatingInspector: readJsonObject<FloatingPanelState>(
      LAYOUT_STORAGE_KEYS.floatingInspector,
    ),
    floatingDiscussion: readJsonObject<FloatingPanelState>(
      LAYOUT_STORAGE_KEYS.floatingDiscussion,
    ),
    triViewFloat: readJsonObject<TriViewFloatState>(
      LAYOUT_STORAGE_KEYS.triViewFloat,
    ),
  };
}

function definedPatch<T extends object>(
  patch: Partial<T> | null | undefined,
): Partial<T> {
  if (!patch) return {};
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(patch) as Array<
    [keyof T, T[keyof T] | undefined]
  >) {
    if (value !== undefined) out[key] = value as T[keyof T];
  }
  return out;
}

function mergeLayoutPatch<T extends object>(
  local: Partial<T> | null | undefined,
  remote: Partial<T> | null | undefined,
  preferLocal: boolean,
): Partial<T> {
  const localDefined = definedPatch(local);
  const remoteDefined = definedPatch(remote);
  return preferLocal
    ? { ...remoteDefined, ...localDefined }
    : { ...localDefined, ...remoteDefined };
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
      LAYOUT_STORAGE_KEYS.floatingTaskQueue,
      JSON.stringify(layout.floatingTaskQueue),
    );
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEYS.floatingClassPalette,
      JSON.stringify(layout.floatingClassPalette),
    );
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEYS.floatingInspector,
      JSON.stringify(layout.floatingInspector),
    );
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEYS.floatingDiscussion,
      JSON.stringify(layout.floatingDiscussion),
    );
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEYS.triViewFloat,
      JSON.stringify(layout.triViewFloat),
    );
  } catch {
    /* local fallback is best-effort */
  }
}

function mergeFloatingPanel(
  fallback: FloatingPanelState,
  remote: Partial<FloatingPanelState> | null | undefined,
): FloatingPanelState {
  return {
    ...fallback,
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
  options?: { preferLocalLayout?: boolean },
): WorkbenchLayoutPreferences {
  const local = readLocalLayout();
  const preferLocal = options?.preferLocalLayout === true;
  const merged = {
    ...DEFAULT_WORKBENCH_PREFERENCES.layout,
    ...mergeLayoutPatch<WorkbenchLayoutPatch>(local, remote, preferLocal),
  };
  const floatingTaskQueue = mergeLayoutPatch(
    local.floatingTaskQueue,
    remote?.floatingTaskQueue,
    preferLocal,
  );
  const floatingClassPalette = mergeLayoutPatch(
    local.floatingClassPalette,
    remote?.floatingClassPalette,
    preferLocal,
  );
  const floatingInspector = mergeLayoutPatch(
    local.floatingInspector,
    remote?.floatingInspector,
    preferLocal,
  );
  const floatingDiscussion = mergeLayoutPatch(
    local.floatingDiscussion,
    remote?.floatingDiscussion,
    preferLocal,
  );
  const triViewFloat = mergeLayoutPatch(
    local.triViewFloat,
    remote?.triViewFloat,
    preferLocal,
  );
  return {
    leftOpen: merged.leftOpen ?? DEFAULT_WORKBENCH_PREFERENCES.layout.leftOpen,
    rightOpen: merged.rightOpen ?? DEFAULT_WORKBENCH_PREFERENCES.layout.rightOpen,
    leftWidth: merged.leftWidth ?? DEFAULT_WORKBENCH_PREFERENCES.layout.leftWidth,
    rightWidth: merged.rightWidth ?? DEFAULT_WORKBENCH_PREFERENCES.layout.rightWidth,
    floatingTaskQueue: mergeFloatingPanel(
      DEFAULT_WORKBENCH_PREFERENCES.layout.floatingTaskQueue,
      floatingTaskQueue,
    ),
    floatingClassPalette: mergeFloatingPanel(
      DEFAULT_WORKBENCH_PREFERENCES.layout.floatingClassPalette,
      floatingClassPalette,
    ),
    floatingInspector: mergeFloatingPanel(
      DEFAULT_WORKBENCH_PREFERENCES.layout.floatingInspector,
      floatingInspector,
    ),
    floatingDiscussion: mergeFloatingPanel(
      DEFAULT_WORKBENCH_PREFERENCES.layout.floatingDiscussion,
      floatingDiscussion,
    ),
    triViewFloat: mergeTriViewFloat(triViewFloat),
  };
}

function applyLayoutPatch(
  current: WorkbenchLayoutPreferences,
  patch: WorkbenchLayoutPatch,
): WorkbenchLayoutPreferences {
  return {
    ...current,
    ...patch,
    floatingTaskQueue:
      patch.floatingTaskQueue === undefined
        ? current.floatingTaskQueue
        : mergeFloatingPanel(DEFAULT_WORKBENCH_PREFERENCES.layout.floatingTaskQueue, {
            ...current.floatingTaskQueue,
            ...(patch.floatingTaskQueue ?? {}),
          }),
    floatingClassPalette:
      patch.floatingClassPalette === undefined
        ? current.floatingClassPalette
        : mergeFloatingPanel(DEFAULT_WORKBENCH_PREFERENCES.layout.floatingClassPalette, {
            ...current.floatingClassPalette,
            ...(patch.floatingClassPalette ?? {}),
          }),
    floatingInspector:
      patch.floatingInspector === undefined
        ? current.floatingInspector
        : mergeFloatingPanel(DEFAULT_WORKBENCH_PREFERENCES.layout.floatingInspector, {
            ...current.floatingInspector,
            ...(patch.floatingInspector ?? {}),
          }),
    floatingDiscussion:
      patch.floatingDiscussion === undefined
        ? current.floatingDiscussion
        : mergeFloatingPanel(DEFAULT_WORKBENCH_PREFERENCES.layout.floatingDiscussion, {
            ...current.floatingDiscussion,
            ...(patch.floatingDiscussion ?? {}),
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
    mergeUser(user?.preferences?.workbench, { preferLocalLayout: true }),
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

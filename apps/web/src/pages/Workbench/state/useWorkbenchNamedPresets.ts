import { useCallback, useMemo, useReducer, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  authApi,
  MAX_NAMED_WORKSPACE_PRESETS,
  MAX_WORKSPACE_PRESET_NAME_LENGTH,
  type NamedWorkspacePreset,
  type UserPreferences,
} from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";
import {
  readWorkspaceEnvelope,
  sanitizeWorkspaceSnapshot,
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceContext,
  type WorkspaceSnapshot,
} from "../layout/workbenchLayoutSnapshot";
import { userPreferencesQueryKey } from "./useUserPreferences";

/**
 * 账号级「命名布局预设」的唯一写入者。
 *
 * 与 useWorkbenchWorkspaceLayout 的分工:那边只写 `workspace.contexts.<当前上下文>`
 * (当前布局自动记住), 这里只写 `workspace.namedPresets` (用户显式另存的清单)。两条
 * 路径的键互不相交, 后端把整份 namedPresets 当原子 map 替换, 所以省略某条即删除。
 *
 * 无法解析的条目 (损坏 / 来自更新版本) 保留原样参与每次整表提交, 只在界面上禁用应用,
 * 避免旧客户端把新版预设洗掉。
 */

export interface WorkbenchNamedPreset {
  id: string;
  name: string;
  context: WorkspaceContext;
  /** null = 快照无法恢复;只能删除, 不能应用。 */
  snapshot: WorkspaceSnapshot | null;
}

export type NamedPresetFailure = "invalid-name" | "duplicate-name" | "limit" | "request";

function readPresets(value: unknown): Record<string, NamedWorkspacePreset> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([id, preset]) =>
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) &&
      !!preset &&
      typeof preset === "object" &&
      typeof (preset as NamedWorkspacePreset).name === "string",
  );
  return Object.fromEntries(entries) as Record<string, NamedWorkspacePreset>;
}

export function useWorkbenchNamedPresets() {
  const userId = useAuthStore((state) => state.user?.id);
  const queryClient = useQueryClient();
  // Same key and stale time as useUserPreferences: one shared GET, one cache.
  const query = useQuery({
    queryKey: userPreferencesQueryKey(userId),
    queryFn: () => authApi.getPreferences(),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const saving = useRef(false);

  const stored = useMemo(
    () => readPresets(query.data?.workbench?.layout?.workspace?.namedPresets),
    [query.data],
  );

  const presets = useMemo<WorkbenchNamedPreset[]>(
    () =>
      Object.entries(stored)
        .map(([id, preset]) => ({
          id,
          name: preset.name,
          context: preset.context,
          snapshot: readWorkspaceEnvelope(preset).snapshot,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")),
    [stored],
  );

  const write = useCallback(
    async (next: Record<string, NamedWorkspacePreset>): Promise<boolean> => {
      if (!userId || saving.current) return false;
      saving.current = true;
      refresh();
      try {
        await authApi.updatePreferences({
          workbench: { layout: { workspace: { engine: "dockview@8", namedPresets: next } } },
        });
        // Replace only this key: the layout writer owns the sibling contexts map.
        queryClient.setQueryData<UserPreferences>(
          userPreferencesQueryKey(userId),
          (previous) =>
            previous && {
              ...previous,
              workbench: {
                ...previous.workbench,
                layout: {
                  ...previous.workbench.layout,
                  workspace: {
                    ...previous.workbench.layout.workspace,
                    engine: "dockview@8",
                    namedPresets: next,
                  },
                },
              },
            },
        );
        return true;
      } catch {
        return false;
      } finally {
        saving.current = false;
        refresh();
      }
    },
    [queryClient, userId],
  );

  /** 同名保存视为更新已有预设,不占新名额。 */
  const save = useCallback(
    async (
      name: string,
      context: WorkspaceContext,
      snapshot: WorkspaceSnapshot,
    ): Promise<NamedPresetFailure | null> => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > MAX_WORKSPACE_PRESET_NAME_LENGTH) return "invalid-name";
      const existing = Object.entries(stored).find(([, preset]) => preset.name.trim() === trimmed);
      if (!existing && Object.keys(stored).length >= MAX_NAMED_WORKSPACE_PRESETS) return "limit";
      let clean: WorkspaceSnapshot;
      try {
        clean = sanitizeWorkspaceSnapshot(snapshot);
      } catch {
        return "request";
      }
      const id = existing?.[0] ?? crypto.randomUUID();
      const next = {
        ...stored,
        [id]: {
          name: trimmed,
          context,
          schemaVersion: WORKSPACE_SCHEMA_VERSION,
          snapshot: clean,
        },
      };
      return (await write(next)) ? null : "request";
    },
    [stored, write],
  );

  const rename = useCallback(
    async (id: string, name: string): Promise<NamedPresetFailure | null> => {
      const trimmed = name.trim();
      const preset = stored[id];
      if (!preset) return "request";
      if (!trimmed || trimmed.length > MAX_WORKSPACE_PRESET_NAME_LENGTH) return "invalid-name";
      if (
        Object.entries(stored).some(
          ([other, value]) => other !== id && value.name.trim() === trimmed,
        )
      )
        return "duplicate-name";
      const next = { ...stored, [id]: { ...preset, name: trimmed } };
      return (await write(next)) ? null : "request";
    },
    [stored, write],
  );

  const remove = useCallback(
    async (id: string): Promise<NamedPresetFailure | null> => {
      if (!stored[id]) return null;
      const next = Object.fromEntries(Object.entries(stored).filter(([other]) => other !== id));
      return (await write(next)) ? null : "request";
    },
    [stored, write],
  );

  return {
    presets,
    loaded: !!userId && !query.isPending && !query.isError,
    saving: saving.current,
    full: Object.keys(stored).length >= MAX_NAMED_WORKSPACE_PRESETS,
    save,
    rename,
    remove,
  };
}

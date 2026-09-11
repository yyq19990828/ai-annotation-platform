import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  DEFAULT_WORKBENCH_PREFERENCES,
  type StoredNamedWorkspacePresets,
  type UserPreferences,
  type UserPreferencesPatch,
} from "@/api/auth";
import { createWorkspacePreset } from "../layout/workbenchLayoutPresets";
import { userPreferencesQueryKey } from "./useUserPreferences";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("@/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/auth")>()),
  authApi: { getPreferences: mocks.get, updatePreferences: mocks.patch },
}));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(
    (selector: (value: { user: { id: string } }) => unknown) => selector({ user: { id: "u1" } }),
    { getState: () => ({ user: { id: "u1" } }) },
  ),
}));

import { useWorkbenchNamedPresets } from "./useWorkbenchNamedPresets";

const bounds = { width: 1600, height: 900 };

function preferences(engine: string, namedPresets: StoredNamedWorkspacePresets): UserPreferences {
  return {
    workbench: {
      ...DEFAULT_WORKBENCH_PREFERENCES,
      layout: {
        ...DEFAULT_WORKBENCH_PREFERENCES.layout,
        workspace: { engine, contexts: {}, namedPresets },
      },
    },
    ai: {},
    ui: {},
  };
}

function currentPreset(name: string) {
  return {
    name,
    context: "review:image",
    schemaVersion: 5,
    snapshot: createWorkspacePreset("review", bounds, "review:image"),
  };
}

describe("useWorkbenchNamedPresets", () => {
  let client: QueryClient;
  let remote: UserPreferences;
  let raw: StoredNamedWorkspacePresets;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    raw = {
      p1: currentPreset("审核宽讨论"),
      future: {
        name: "新版布局",
        context: "review:image",
        schemaVersion: 99,
        snapshot: { future: true },
      },
      "future.id": { name: "新 ID", context: "review:image", schemaVersion: 99 },
      damaged: { schemaVersion: 5, snapshot: { broken: true } },
      "damaged id": null,
    };
    remote = preferences("dockview@8", raw);
    mocks.get.mockReset().mockResolvedValue(remote);
    mocks.patch.mockReset().mockImplementation(async (payload: UserPreferencesPatch) => {
      const next = payload.workbench?.layout?.workspace?.namedPresets ?? {};
      return preferences("dockview@9", next);
    });
  });

  function setup() {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(() => useWorkbenchNamedPresets(), { wrapper });
  }

  it("round-trips opaque entries, preserves a newer engine and cancels stale refetches", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.full).toBe(true);
    expect(result.current.count).toBe(5);
    expect(result.current.presets.map((preset) => preset.id)).toEqual(["p1", "future"]);

    let resolveStale!: (value: UserPreferences) => void;
    mocks.get.mockReturnValueOnce(
      new Promise<UserPreferences>((resolve) => {
        resolveStale = resolve;
      }),
    );
    const refetch = client.refetchQueries({ queryKey: userPreferencesQueryKey("u1") });
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    const cancel = vi.spyOn(client, "cancelQueries");

    await act(async () => {
      expect(await result.current.rename("p1", "审核专用")).toBeNull();
    });
    const workspace = mocks.patch.mock.calls[0][0].workbench.layout.workspace;
    expect(workspace).not.toHaveProperty("engine");
    expect(workspace.namedPresets).toEqual({
      ...raw,
      p1: { ...(raw.p1 as Record<string, unknown>), name: "审核专用" },
    });
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.patch.mock.invocationCallOrder[0],
    );

    resolveStale(remote);
    await refetch;
    await waitFor(() => {
      const workspace = client.getQueryData<UserPreferences>(userPreferencesQueryKey("u1"))!
        .workbench.layout.workspace!;
      expect(workspace.engine).toBe("dockview@9");
      expect((workspace.namedPresets?.p1 as { name: string }).name).toBe("审核专用");
      expect(workspace.namedPresets?.["future.id"]).toEqual(raw["future.id"]);
      expect(workspace.namedPresets?.damaged).toEqual(raw.damaged);
    });
  });

  it("keeps a newer-schema preset delete-only", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.presets.find((preset) => preset.id === "future")?.snapshot).toBeNull();

    await act(async () => {
      expect(await result.current.rename("future", "不应改名")).toBe("request");
    });
    await act(async () => {
      expect(
        await result.current.save(
          "新版布局",
          "review:image",
          createWorkspacePreset("review", bounds, "review:image"),
        ),
      ).toBe("duplicate-name");
    });
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("refetches the authoritative map after a rejected atomic write", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    mocks.patch.mockRejectedValueOnce(new Error("stale opaque map"));
    mocks.get.mockResolvedValue(preferences("dockview@9", { p1: currentPreset("远端最新名称") }));

    await act(async () => {
      expect(await result.current.rename("p1", "本地过期名称")).toBe("request");
    });

    await waitFor(() => {
      expect(result.current.presets.map((preset) => preset.name)).toEqual(["远端最新名称"]);
      expect(result.current.count).toBe(1);
    });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});

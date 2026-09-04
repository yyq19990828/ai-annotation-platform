import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKBENCH_PREFERENCES, type UserPreferences } from "@/api/auth";
import { ApiError } from "@/api/client";
import { createWorkspacePreset } from "../layout/workbenchLayoutPresets";
import type { WorkspaceContext, WorkspaceEnvelope } from "../layout/workbenchLayoutSnapshot";
import { userPreferencesQueryKey } from "./useUserPreferences";
import { useWorkbenchWorkspaceLayout, workspaceStorageKey } from "./useWorkbenchWorkspaceLayout";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  user: { id: "u1" },
}));

vi.mock("@/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/auth")>()),
  authApi: { getPreferences: mocks.get, updatePreferences: mocks.patch },
}));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(
    (selector: (state: { user: { id: string } }) => unknown) => selector({ user: mocks.user }),
    { getState: () => ({ user: mocks.user }) },
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const initial = createWorkspacePreset("standard");
const changed = createWorkspacePreset("review");
const latest = createWorkspacePreset("focus");
const v1 = (snapshot = initial): WorkspaceEnvelope => ({ schemaVersion: 1, snapshot });

function preferences(
  envelope: WorkspaceEnvelope | undefined = v1(),
  context: WorkspaceContext = "annotate:image",
): UserPreferences {
  return {
    workbench: {
      ...DEFAULT_WORKBENCH_PREFERENCES,
      layout: {
        ...DEFAULT_WORKBENCH_PREFERENCES.layout,
        workspace: { engine: "dockview@8", contexts: envelope ? { [context]: envelope } : {} },
      },
    },
    ai: {},
    ui: {},
  };
}

function setup(context: WorkspaceContext = "annotate:image") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return {
    client,
    ...renderHook(({ currentContext }) => useWorkbenchWorkspaceLayout(currentContext, initial), {
      wrapper,
      initialProps: { currentContext: context },
    }),
  };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.user = { id: "u1" };
  window.localStorage.clear();
  mocks.get.mockResolvedValue(preferences());
  mocks.patch.mockImplementation(async (payload) => ({
    ...preferences(),
    workbench: { ...DEFAULT_WORKBENCH_PREFERENCES, layout: payload.workbench.layout },
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("workspace layout owner", () => {
  it("renders the account cache, blocks every write until initial GET, then hydrates once", async () => {
    window.localStorage.setItem(
      workspaceStorageKey("u1", "annotate:image"),
      JSON.stringify(v1(changed)),
    );
    const get = deferred<UserPreferences>();
    mocks.get.mockReturnValue(get.promise);
    const { result, client } = setup();
    expect(result.current.snapshot).toEqual(changed);
    expect(result.current.readOnly).toBe(true);
    expect(result.current.save(latest)).toBe(false);
    expect(result.current.reset(initial)).toBe(false);
    expect(mocks.patch).not.toHaveBeenCalled();

    await act(async () => get.resolve(preferences(v1(latest))));
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.snapshot).toEqual(latest);
    expect(result.current.restoreRevision).toBe(1);
    expect(result.current.readOnly).toBe(false);
    act(() => client.setQueryData(userPreferencesQueryKey("u1"), preferences()));
    expect(result.current.snapshot).toEqual(latest);
    expect(result.current.restoreRevision).toBe(1);
  });

  it("waits for an initial refetch even when the shared query already has stale data", async () => {
    const get = deferred<UserPreferences>();
    mocks.get.mockReturnValue(get.promise);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(userPreferencesQueryKey("u1"), preferences(), { updatedAt: 1 });
    const { result } = renderHook(() => useWorkbenchWorkspaceLayout("annotate:image", initial), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    expect(result.current.initialized).toBe(false);
    await act(async () => get.resolve(preferences(v1(changed))));
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.snapshot).toEqual(changed);
  });

  it("unlocks local changes after an initial GET failure and ignores subsequent refetch", async () => {
    mocks.get.mockRejectedValue(new Error("offline"));
    const { result, client } = setup();
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.readOnly).toBe(false);
    expect(result.current.error).toBeTruthy();
    vi.useFakeTimers();
    act(() => {
      expect(result.current.save(changed)).toBe(true);
    });
    act(() => client.setQueryData(userPreferencesQueryKey("u1"), preferences(v1(latest))));
    expect(result.current.snapshot).toEqual(initial);
    expect(result.current.restoreRevision).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it("persists the initial legacy conversion only when the authoritative context is absent", async () => {
    const get = preferences();
    get.workbench.layout.workspace!.contexts = {};
    mocks.get.mockResolvedValue(get);
    const { result } = setup();
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.dirty).toBe(true);
    expect(result.current.restoreRevision).toBe(0);
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    expect(mocks.patch.mock.calls[0][0].workbench.layout.workspace.contexts).toEqual({
      "annotate:image": v1(),
    });
  });

  it("debounces, allows one request in flight and writes only the newest pending context snapshot", async () => {
    const requests = [deferred<UserPreferences>(), deferred<UserPreferences>()];
    mocks.patch.mockReturnValueOnce(requests[0].promise).mockReturnValueOnce(requests[1].promise);
    const { result } = setup();
    await waitFor(() => expect(result.current.initialized).toBe(true));
    vi.useFakeTimers();
    act(() => result.current.save(changed));
    await act(async () => vi.advanceTimersByTimeAsync(299));
    expect(mocks.patch).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.save(initial);
      result.current.save(latest);
    });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    await act(async () => requests[0].resolve(preferences(v1(changed))));
    expect(mocks.patch).toHaveBeenCalledTimes(2);
    expect(mocks.patch.mock.calls[1][0]).toEqual({
      workbench: {
        layout: { workspace: { engine: "dockview@8", contexts: { "annotate:image": v1(latest) } } },
      },
    });
    expect(result.current.snapshot).toEqual(initial);
    await act(async () => requests[1].resolve(preferences(v1(latest))));
    expect(result.current.dirty).toBe(false);
  });

  it("keeps failed saves dirty without retry loops or rolling back the visible layout", async () => {
    mocks.patch.mockRejectedValueOnce(new ApiError(500, "offline"));
    const { result } = setup();
    await waitFor(() => expect(result.current.initialized).toBe(true));
    vi.useFakeTimers();
    act(() => result.current.save(changed));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(result.current.dirty).toBe(true);
    expect(result.current.error).toBeTruthy();
    expect(result.current.readOnly).toBe(false);
    expect(
      JSON.parse(window.localStorage.getItem(workspaceStorageKey("u1", "annotate:image"))!),
    ).toEqual(v1(changed));
    act(() => result.current.save(latest));
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(result.current.dirty).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("a schema downgrade conflict discards pending writes and makes reset read-only", async () => {
    const save = deferred<UserPreferences>();
    mocks.patch.mockReturnValue(save.promise);
    const { result } = setup();
    await waitFor(() => expect(result.current.initialized).toBe(true));
    vi.useFakeTimers();
    act(() => result.current.save(changed));
    await act(async () => vi.advanceTimersByTimeAsync(300));
    act(() => result.current.save(latest));
    await act(async () =>
      save.reject(new ApiError(409, "Conflict", { reason: "layout_schema_downgrade" })),
    );
    expect(result.current.readOnlyReason).toBe("newer-schema");
    expect(result.current.snapshot).toEqual(initial);
    expect(result.current.dirty).toBe(false);
    expect(result.current.reset(initial)).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it.each([2, 3] as const)(
    "does not interpret a future schema %s as v1 or permit resetting it",
    async (schemaVersion) => {
      mocks.get.mockResolvedValue(preferences({ schemaVersion, snapshot: { future: true } }));
      const { result } = setup();
      await waitFor(() => expect(result.current.initialized).toBe(true));
      expect(result.current.readOnlyReason).toBe("newer-schema");
      expect(result.current.reset(initial)).toBe(false);
      expect(mocks.patch).not.toHaveBeenCalled();
    },
  );

  it("invalid snapshots require an explicit reset before a standard layout may be saved", async () => {
    mocks.get.mockResolvedValue(
      preferences({ schemaVersion: 1, snapshot: {} } as WorkspaceEnvelope),
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.readOnlyReason).toBe("invalid");
    expect(result.current.save(changed)).toBe(false);
    vi.useFakeTimers();
    act(() => {
      expect(result.current.reset(initial)).toBe(true);
    });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(result.current.readOnly).toBe(false);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it("never writes a previous context's pending snapshot into a new context", async () => {
    const get = preferences();
    get.workbench.layout.workspace!.contexts["review:video"] = v1(latest);
    mocks.get.mockResolvedValue(get);
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.initialized).toBe(true));
    vi.useFakeTimers();
    act(() => result.current.save(changed));
    rerender({ currentContext: "review:video" });
    expect(result.current.snapshot).toEqual(latest);
    expect(result.current.dirty).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(
      JSON.parse(window.localStorage.getItem(workspaceStorageKey("u1", "annotate:image"))!),
    ).toEqual(v1(changed));
  });

  it("isolates cache, initial hydration and in-flight callbacks when the account changes", async () => {
    const patch = deferred<UserPreferences>();
    mocks.patch.mockReturnValue(patch.promise);
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.initialized).toBe(true));
    vi.useFakeTimers();
    act(() => result.current.save(changed));
    await act(async () => vi.advanceTimersByTimeAsync(300));
    mocks.user = { id: "u2" };
    const get = deferred<UserPreferences>();
    mocks.get.mockReturnValue(get.promise);
    window.localStorage.setItem(
      workspaceStorageKey("u2", "annotate:image"),
      JSON.stringify(v1(latest)),
    );
    rerender({ currentContext: "annotate:image" });
    expect(result.current.snapshot).toEqual(latest);
    expect(result.current.initialized).toBe(false);
    await act(async () => patch.resolve(preferences(v1(changed))));
    expect(result.current.snapshot).toEqual(latest);
    await act(async () => {
      get.resolve(preferences());
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.snapshot).toEqual(initial);
    expect(result.current.initialized).toBe(true);
  });
});

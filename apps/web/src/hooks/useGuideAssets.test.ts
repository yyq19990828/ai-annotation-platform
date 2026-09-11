import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signUrl: vi.fn(),
  uploadInit: vi.fn(),
  uploadComplete: vi.fn(),
  remove: vi.fn(),
}));
const { signUrl, uploadInit, uploadComplete, remove } = mocks;

vi.mock("@/api/projects", () => ({
  projectsApi: {
    guideAssets: mocks,
  },
}));

import { useGuideAssets } from "./useGuideAssets";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useGuideAssets", () => {
  beforeEach(() => {
    signUrl.mockReset();
    uploadInit.mockReset();
    uploadComplete.mockReset();
    remove.mockReset();
  });

  it("resolves complete guide-asset sources with expiry metadata and deduplicates inflight signing", async () => {
    const gate = deferred<{ url: string; expires_in: number }>();
    signUrl.mockReturnValue(gate.promise);
    const { result } = renderHook(() => useGuideAssets("project-1"));

    const first = result.current.resolveImage("guide-asset:asset-a");
    const second = result.current.resolveImage("guide-asset:asset-a");
    expect(signUrl).toHaveBeenCalledTimes(1);
    expect(signUrl).toHaveBeenCalledWith("project-1", "asset-a");

    gate.resolve({ url: "https://cdn.example/a.png", expires_in: 3600 });
    await expect(first).resolves.toMatchObject({ url: "https://cdn.example/a.png" });
    await expect(second).resolves.toMatchObject({ url: "https://cdn.example/a.png" });
    expect((await first).expiresAt).toBeGreaterThan(Date.now());

    await expect(
      result.current.resolveImage("guide-asset:asset-a", { refresh: true }),
    ).resolves.toEqual(expect.objectContaining({ url: "https://cdn.example/a.png" }));
    expect(signUrl).toHaveBeenCalledTimes(2);
  });

  it("does not let a late previous-project result populate the new project's cache", async () => {
    const oldGate = deferred<{ url: string; expires_in: number }>();
    const newGate = deferred<{ url: string; expires_in: number }>();
    signUrl.mockImplementation((projectId: string) =>
      projectId === "project-old" ? oldGate.promise : newGate.promise,
    );
    const view = renderHook(({ projectId }) => useGuideAssets(projectId), {
      initialProps: { projectId: "project-old" },
    });
    const oldResolver = view.result.current.resolveImage;
    const oldRequest = oldResolver("guide-asset:shared-key");

    view.rerender({ projectId: "project-new" });
    const newRequest = view.result.current.resolveImage("guide-asset:shared-key");
    expect(signUrl).toHaveBeenCalledTimes(2);
    expect(signUrl).toHaveBeenNthCalledWith(1, "project-old", "shared-key");
    expect(signUrl).toHaveBeenNthCalledWith(2, "project-new", "shared-key");

    oldGate.resolve({ url: "https://cdn.example/old.png", expires_in: 3600 });
    await expect(oldRequest).resolves.toMatchObject({ url: "https://cdn.example/old.png" });
    newGate.resolve({ url: "https://cdn.example/new.png", expires_in: 3600 });
    await expect(newRequest).resolves.toMatchObject({ url: "https://cdn.example/new.png" });

    await expect(view.result.current.resolveImage("guide-asset:shared-key")).resolves.toMatchObject(
      {
        url: "https://cdn.example/new.png",
      },
    );
    expect(signUrl).toHaveBeenCalledTimes(2);
  });

  it("rejects a retired resolver instead of reading the new project's cache", async () => {
    signUrl.mockResolvedValue({ url: "https://cdn.example/new.png", expires_in: 3600 });
    const view = renderHook(({ projectId }) => useGuideAssets(projectId), {
      initialProps: { projectId: "project-old" },
    });
    const oldResolver = view.result.current.resolveImage;
    view.rerender({ projectId: "project-new" });
    await expect(oldResolver("guide-asset:key")).rejects.toThrow("project context changed");
    await waitFor(() => expect(signUrl).not.toHaveBeenCalled());
  });
});

import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useOnlineStatus } from "./useOnlineStatus";

const queue = vi.hoisted(() => ({ countDurably: vi.fn(), subscribe: vi.fn() }));
vi.mock("@/pages/Workbench/state/offlineQueue", () => queue);

beforeEach(() => {
  vi.resetAllMocks();
  queue.subscribe.mockReturnValue(() => {});
});

it("keeps the submit gate unknown while storage is loading or failed", async () => {
  let reject!: (error: Error) => void;
  queue.countDurably.mockReturnValue(
    new Promise((_resolve, rejectRead) => {
      reject = rejectRead;
    }),
  );
  const scope = { userId: "alice" };
  const { result } = renderHook(() => useOnlineStatus(scope));
  expect(result.current.queueReady).toBe(false);
  await act(async () => {
    reject(new Error("Storage unavailable"));
  });
  expect(result.current.queueReady).toBe(false);
  expect(result.current.queueReadError).toContain("无法读取");
});

it("does not use the previous account's resolved queue during a scope switch", async () => {
  queue.countDurably.mockResolvedValueOnce(2);
  const first = { userId: "alice" };
  const { result, rerender } = renderHook(({ scope }) => useOnlineStatus(scope), {
    initialProps: { scope: first },
  });
  await act(async () => {});
  expect(result.current.queueReady).toBe(true);
  expect(result.current.queueCount).toBe(2);
  let resolve!: (count: number) => void;
  queue.countDurably.mockReturnValueOnce(
    new Promise<number>((resolveRead) => {
      resolve = resolveRead;
    }),
  );
  rerender({ scope: { userId: "bob" } });
  expect(result.current.queueReady).toBe(false);
  await act(async () => {
    resolve(0);
  });
  expect(result.current.queueReady).toBe(true);
  expect(result.current.queueCount).toBe(0);
});

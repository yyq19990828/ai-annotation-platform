import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "./src/mocks/server";

// v0.16.0 · react-konva → DOM stand-in mock(画布栈统一地基)。
// 把 Konva 组件渲染成带 data-konva / data-testid 的 <div>,使现有 RTL 风格
// (fireEvent + getByTestId + 回调断言)能对 Konva 组件生效。
// 注意:vi.mock 提升到文件顶部;工厂返回 import(...) 的 Promise,vitest 会 await。
// 局限:只验证交互 / props,不验证真实 canvas 渲染(渲染回归交给 Playwright)。
vi.mock("react-konva", () => import("./src/test/konvaMock"));

// v0.8.5 · jsdom 在 about:blank（opaque origin）下不提供 localStorage / sessionStorage，
// 导致 zustand persist 在 setState 时炸 "storage.setItem is not a function"。统一 polyfill。
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
  };
}
const g = globalThis as unknown as {
  localStorage?: Storage;
  sessionStorage?: Storage;
};
if (!g.localStorage || typeof g.localStorage.setItem !== "function") {
  Object.defineProperty(globalThis, "localStorage", {
    value: createMemoryStorage(),
    writable: true,
    configurable: true,
  });
}
if (!g.sessionStorage || typeof g.sessionStorage.setItem !== "function") {
  Object.defineProperty(globalThis, "sessionStorage", {
    value: createMemoryStorage(),
    writable: true,
    configurable: true,
  });
}
afterEach(() => {
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
});

// 整套单测共享一个 MSW server。
// 测试里如需覆盖某接口：`server.use(http.get(..., ...))`
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./src/mocks/server";

// 整套单测共享一个 MSW server。
// 测试里如需覆盖某接口：`server.use(http.get(..., ...))`
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/**
 * vitest 环境下的 MSW server。
 * 在 vitest.setup.ts 里启动 / 重置 / 关闭，单测中可临时 server.use(...) 覆盖。
 */
export const server = setupServer(...handlers);

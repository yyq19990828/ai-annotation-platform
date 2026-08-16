import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/shadcn/ui/tooltip";

import { FreshnessIndicator } from "./FreshnessIndicator";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
});

describe("FreshnessIndicator", () => {
  it("悬停陈旧来源时展示错误与上次更新时间", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <FreshnessIndicator
          source={{
            name: "router_ledger",
            label: "路由账本",
            stale: true,
            error: "Redis 连接超时，进入 30 秒退避",
            updated_at: "2026-07-13T01:59:45.000Z",
          }}
        />
      </TooltipProvider>,
    );

    await user.hover(screen.getByText("路由账本", { exact: true }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "路由账本：Redis 连接超时，进入 30 秒退避",
    );
  });
});

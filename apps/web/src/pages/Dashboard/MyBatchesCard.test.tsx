import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseMyBatches = vi.fn();

vi.mock("@/hooks/useDashboard", () => ({
  useMyBatches: () => mockUseMyBatches(),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToastStore: <T,>(selector: (state: { push: () => void }) => T) => selector({ push: vi.fn() }),
}));

import { MyBatchesCard } from "./MyBatchesCard";

function renderUI() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MyBatchesCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MyBatchesCard", () => {
  beforeEach(() => mockUseMyBatches.mockReset());

  it("首屏离线暂停 → 显示等待网络连接而不是隐藏卡片", () => {
    mockUseMyBatches.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isPaused: true,
      fetchStatus: "paused",
    });
    renderUI();
    expect(screen.getByRole("status")).toHaveTextContent(
      "网络连接已断开，分派批次会在恢复后自动继续",
    );
  });
});

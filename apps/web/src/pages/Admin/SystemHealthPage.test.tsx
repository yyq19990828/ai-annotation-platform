import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockGetSystemHealth = vi.fn();
vi.mock("@/api/adminSystemHealth", () => ({
  adminSystemHealthApi: {
    get: () => mockGetSystemHealth(),
  },
}));

import { SystemHealthPage } from "./SystemHealthPage";

function renderUI() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SystemHealthPage />
    </QueryClientProvider>,
  );
}

describe("SystemHealthPage", () => {
  beforeEach(() => {
    mockGetSystemHealth.mockReset();
    mockGetSystemHealth.mockResolvedValue({
      status: "degraded",
      version: "0.10.58",
      components: [
        { name: "db", label: "PostgreSQL", status: "ok", latency_ms: 1.2, detail: null },
        { name: "redis", label: "Redis", status: "ok", latency_ms: 2.3, detail: null },
        { name: "minio", label: "MinIO", status: "ok", latency_ms: 3.4, detail: null },
        { name: "celery", label: "Celery", status: "degraded", latency_ms: 4.5, detail: null },
      ],
      celery: {
        active_count: 1,
        queues: [{ name: "ml", length: 42, status: "degraded" }],
        workers: [
          {
            name: "celery@test",
            last_heartbeat_seconds_ago: 180,
            pool_max: 4,
            status: "degraded",
          },
        ],
      },
    });
  });

  it("renders component health, queues and worker heartbeat", async () => {
    renderUI();

    expect(await screen.findByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("Redis")).toBeInTheDocument();
    expect(screen.getByText("ml")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("celery@test")).toBeInTheDocument();
    expect(screen.getByText("3.0m")).toBeInTheDocument();
  });
});

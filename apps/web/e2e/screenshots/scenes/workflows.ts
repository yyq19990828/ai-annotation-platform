import type { ScreenshotScene } from "./_types";

// 工作流类截图：失败预测恢复 jobs 列表。
// failed-jobs 用 page.route mock 后端响应，不污染真实 DB（同 ai-pre.ts 思路）。

interface MockJob {
  id: string;
  project_id: string;
  project_name: string;
  project_display_id: string | null;
  batch_id: string | null;
  ml_backend_id: string | null;
  prompt: string;
  output_mode: string;
  status: "running" | "completed" | "failed";
  total_tasks: number;
  success_count: number;
  failed_count: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  total_cost: number | null;
  error_message: string | null;
}

function makeFailedJob(i: number): MockJob {
  const prompts = [
    "person, car, truck",
    "traffic light, stop sign",
    "person",
    "helmet, vest",
    "vehicle plates",
  ];
  const errors = [
    "model timeout",
    "backend connection refused",
    "CUDA out of memory",
    "invalid prompt schema",
    "rate limited by upstream",
  ];
  return {
    id: `mock-fail-${i}-${"0".repeat(28)}`.slice(0, 36),
    project_id: `mock-proj-${i}-${"0".repeat(26)}`.slice(0, 36),
    project_name: `演示项目 ${i + 1}`,
    project_display_id: `P-${100 + i}`,
    batch_id: `mock-batch-${i}-${"0".repeat(25)}`.slice(0, 36),
    ml_backend_id: null,
    prompt: prompts[i % prompts.length],
    output_mode: "manual",
    status: "failed",
    total_tasks: 80 + i * 20,
    success_count: 80 + i * 20 - 3,
    failed_count: 3,
    started_at: new Date(Date.now() - i * 3600_000).toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: 60_000 + i * 12_000,
    total_cost: null,
    error_message: errors[i % errors.length],
  };
}

export const WORKFLOW_SCENES: ScreenshotScene[] = [
  {
    name: "workflows/failed-prediction-recovery-jobs-list",
    role: "admin",
    route: () => "/ai-pre/jobs",
    prepare: async (page) => {
      // mock 返回全 failed job；不带 status query / 不切 select（客户端筛选会清空 mock 列表），
      // 列表本身全为失败态 + 错误信息，即可展示「失败恢复」场景。
      await page.route("**/api/v1/admin/preannotate-jobs*", async (route) => {
        const items = Array.from({ length: 6 }, (_, i) => makeFailedJob(i));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items, next_cursor: null }),
        });
      });
      await page.goto("/ai-pre/jobs");
      await page.waitForLoadState("networkidle");
    },
    capture: { kind: "fullPage" },
    target: "docs-site/user-guide/images/workflows/failed-prediction-recovery-jobs-list.png",
  },
];

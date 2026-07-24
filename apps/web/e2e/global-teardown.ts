import { request, type FullConfig } from "@playwright/test";

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  const apiBase = process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:8010";
  const context = await request.newContext({ baseURL: apiBase, timeout: 5_000 });

  try {
    const response = await context.post("/api/v1/__test/seed/cleanup");
    if (!response.ok()) {
      throw new Error(`seed/cleanup failed: ${response.status()} ${await response.text()}`);
    }
  } finally {
    await context.dispose();
  }
}

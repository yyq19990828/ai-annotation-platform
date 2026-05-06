/**
 * v0.8.3 · annotation E2E（最小 happy path）：annotator 登录后 /annotate 路由可达。
 * 详细 bbox 拖框流程依赖 Konva 画布事件，留给下一版（与 SAM 接入同期）。
 */
import { test, expect } from "../fixtures/seed";

test.describe("annotation workbench", () => {
  test("annotator 登录 → /annotate 路由可达", async ({ page, seed }) => {
    const data = await seed.reset();
    await seed.injectToken(page, data.annotator_email);
    await page.goto("/annotate");
    await expect(page).toHaveURL(/\/annotate/);
    await page.waitForLoadState("networkidle");
  });
});

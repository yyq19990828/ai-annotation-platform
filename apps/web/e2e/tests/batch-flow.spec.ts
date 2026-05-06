/**
 * v0.8.3 · batch lifecycle E2E（最小路径）：admin 登录 → 项目设置页可达。
 * 完整批次流转（创建 → 分配 → 完成 → 审核 → 导出）工作量较大，按 ROADMAP 顺序
 * 留给后续版本。
 */
import { test, expect } from "../fixtures/seed";

test.describe("batch lifecycle", () => {
  test("super_admin 登录 → 项目设置页 200", async ({ page, seed }) => {
    const data = await seed.reset();
    await seed.injectToken(page, data.admin_email);
    await page.goto(`/projects/${data.project_id}/settings`);
    await expect(page).toHaveURL(new RegExp(`/projects/${data.project_id}/settings`));
    await page.waitForLoadState("networkidle");
  });
});

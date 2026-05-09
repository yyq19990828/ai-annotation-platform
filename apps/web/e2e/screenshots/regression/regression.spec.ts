/**
 * M4 · 视觉回归 spec。
 *
 * 执行：`pnpm screenshots:regression`（每次 release 前跑一次，不进 PR CI）
 *
 * 原理：
 *   - 使用 seed-fixed（每次 reset 到固定 fixture，数据一致）
 *   - expect(page).toHaveScreenshot() 对比基线截图（首次自动生成）
 *   - 阈值 maxDiffPixelRatio:0.01，容忍 1% 像素差异（抗字体渲染）
 *
 * 基线文件：regression/__screenshots__/（提交入 git，随 UI 变更更新）
 * 更新基线：pnpm screenshots:regression -- --update-snapshots
 *
 * 失败时：报告附 diff 三联图（base / current / diff）。
 */
import { test, expect } from "../../fixtures/seed-fixed";

test.describe("visual regression", () => {
  // ── 登录页 ───────────────────────────────────────────────────
  test("login page", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("auth-storage");
    });
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.addStyleTag({
      content: "*,*::before,*::after{animation-duration:0!important;transition-duration:0!important;}",
    });
    await expect(page).toHaveScreenshot("login.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  // ── 项目列表 ─────────────────────────────────────────────────
  test("projects list", async ({ page, fixedSeed, seedData }) => {
    await fixedSeed.injectToken(page, seedData.admin_email);
    await page.goto("/projects");
    await page.waitForLoadState("networkidle");
    await page.addStyleTag({
      content: "*,*::before,*::after{animation-duration:0!important;transition-duration:0!important;}",
    });
    // mask 时间戳类字段
    await expect(page).toHaveScreenshot("projects-list.png", {
      maxDiffPixelRatio: 0.01,
      mask: [page.locator("time[datetime]"), page.locator("[data-screenshot-mask]")],
    });
  });

  // ── 标注工作台（bbox 工具）──────────────────────────────────
  test("bbox workbench", async ({ page, fixedSeed, seedData }) => {
    if (!seedData.project_id) { test.skip(); return; }
    await fixedSeed.injectToken(page, seedData.annotator_email);
    await page.goto(`/projects/${seedData.project_id}/annotate`);
    await page.waitForLoadState("networkidle");
    await page.addStyleTag({
      content: "*,*::before,*::after{animation-duration:0!important;transition-duration:0!important;}",
    });
    await expect(page).toHaveScreenshot("bbox-workbench.png", {
      maxDiffPixelRatio: 0.01,
      mask: [page.locator("[data-screenshot-mask]"), page.locator("[data-testid='task-counter']")],
    });
  });

  // ── 审核工作台 ───────────────────────────────────────────────
  test("review workbench", async ({ page, fixedSeed, seedData }) => {
    if (!seedData.task_ids[0]) { test.skip(); return; }
    await fixedSeed.injectToken(page, seedData.reviewer_email);
    await page.goto(`/review?task=${seedData.task_ids[0]}`);
    await page.waitForLoadState("networkidle");
    await page.addStyleTag({
      content: "*,*::before,*::after{animation-duration:0!important;transition-duration:0!important;}",
    });
    await expect(page).toHaveScreenshot("review-workbench.png", {
      maxDiffPixelRatio: 0.01,
      mask: [page.locator("[data-screenshot-mask]")],
    });
  });

  // ── 导出设置 ─────────────────────────────────────────────────
  test("export settings", async ({ page, fixedSeed, seedData }) => {
    if (!seedData.project_id) { test.skip(); return; }
    await fixedSeed.injectToken(page, seedData.admin_email);
    await page.goto(`/projects/${seedData.project_id}/settings`);
    await page.waitForLoadState("networkidle");
    const exportTab = page.getByTestId("settings-tab-export");
    if (await exportTab.count()) await exportTab.click();
    await page.addStyleTag({
      content: "*,*::before,*::after{animation-duration:0!important;transition-duration:0!important;}",
    });
    await expect(page).toHaveScreenshot("export-settings.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  // ── AI 预标注入口 ─────────────────────────────────────────────
  test("ai-pre stepper", async ({ page, fixedSeed, seedData }) => {
    await fixedSeed.injectToken(page, seedData.admin_email);
    await page.goto("/ai-pre");
    await page.waitForLoadState("networkidle");
    await page.addStyleTag({
      content: "*,*::before,*::after{animation-duration:0!important;transition-duration:0!important;}",
    });
    await expect(page).toHaveScreenshot("ai-pre-stepper.png", {
      maxDiffPixelRatio: 0.01,
    });
  });
});

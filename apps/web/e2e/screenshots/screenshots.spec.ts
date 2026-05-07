/**
 * v0.8.7 F4 · Playwright 截图自动化主入口。
 *
 * 执行：`pnpm screenshots`（手动触发，**不进 CI** —— playwright.config.ts 已 testIgnore）
 *
 * 前置条件（与 test:e2e 一致）：
 *   1. docker compose up -d
 *   2. uv run alembic upgrade head （apps/api）
 *   3. uv run uvicorn app.main:app --port 8000
 *   4. pnpm dev   （apps/web）
 *
 * 跑一遍把 14 张 PNG 写到 docs-site/user-guide/images/，然后 git diff 人眼审阅。
 * keypoint 两张（human-pose / hand）等非 image-det 工作台落地后再补。
 */
import { test } from "../fixtures/seed";
import { SCENES, type Role } from "./scenes";

// 仓库根 = `apps/web/e2e/screenshots/` 上溯 4 级。
// `import.meta.url` 是 file:// URL，对中文路径会 percent-encode；必须 decodeURIComponent
// 才能写到本地正确位置（否则会落到 `AI%E6%A0%87%E6%B3%A8...` 镜像目录）。
const HERE = decodeURIComponent(new URL(".", import.meta.url).pathname);
const REPO_ROOT = HERE.replace(/\/apps\/web\/e2e\/screenshots\/?$/, "");

test.describe("screenshots automation", () => {
  for (const scene of SCENES) {
    test(scene.name, async ({ page, seed }, info) => {
      const data = await seed.reset();

      const emailMap: Record<Role, string> = {
        admin: data.admin_email,
        annotator: data.annotator_email,
        reviewer: data.reviewer_email,
      };

      // 视口
      const vp = scene.viewport ?? { width: 1440, height: 900 };
      await page.setViewportSize(vp);

      // 角色注入：getting-started 两张需要登录态，scene.prepare 内部自行登出
      await seed.injectToken(page, emailMap[scene.role]);

      // 路由
      await page.goto(scene.route(data));
      // prepare 钩子（高亮元素 / 切 tab / 打开 modal）
      if (scene.prepare) await scene.prepare(page, data);

      // 关闭动画 + 等 networkidle
      await page.addStyleTag({
        content: "*,*::before,*::after{animation-duration:0!important;transition-duration:0!important;}",
      });
      await page.waitForLoadState("networkidle");

      const out = `${REPO_ROOT}/${scene.target}`;
      await page.screenshot({
        path: out,
        fullPage: false,
        animations: "disabled",
      });
      info.annotations.push({ type: "screenshot", description: out });
    });
  }
});

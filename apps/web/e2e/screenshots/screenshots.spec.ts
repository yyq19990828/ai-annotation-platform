/**
 * v0.8.7 F4 · Playwright 截图自动化主入口。
 *
 * 执行：`pnpm screenshots`（手动触发，**不进 CI** —— 走独立 config）
 *
 * 前置条件（与 test:e2e 一致）：
 *   1. docker compose up -d
 *   2. uv run alembic upgrade head （apps/api）
 *   3. uv run uvicorn app.main:app --port 8000
 *   4. pnpm dev   （apps/web）
 *   5. cd apps/api && PYTHONPATH=. uv run python scripts/seed.py
 *      （首次需要：创建 admin / pm / qa / anno / viewer 等开发账号 + 2 个示例项目）
 *
 * **不破坏 dev 数据**：v0.8.7 起改用 `seed.peek()` 只读窥探现有数据（首个
 * super_admin / 首个项目 / 首个任务），不再 TRUNCATE 整库。已积累的项目 / 数据集 /
 * 标注会保留；缺数据的场景脚本兜底跳过，可按提示重跑 seed.py 补齐。
 *
 * 跑一遍把 13 张 PNG 写到 docs-site/user-guide/images/，然后 git diff 人眼审阅。
 * keypoint 两张（human-pose / hand）等非 image-det 工作台落地后再补。
 */
import { test } from "../fixtures/seed";
import type { SeedData } from "../fixtures/seed";
import { SCENES, type Role } from "./scenes";

// 仓库根 = `apps/web/e2e/screenshots/` 上溯 4 级。
// `import.meta.url` 是 file:// URL，对中文路径会 percent-encode；必须 decodeURIComponent
// 才能写到本地正确位置（否则会落到 `AI%E6%A0%87%E6%B3%A8...` 镜像目录）。
const HERE = decodeURIComponent(new URL(".", import.meta.url).pathname);
const REPO_ROOT = HERE.replace(/\/apps\/web\/e2e\/screenshots\/?$/, "");

test.describe("screenshots automation", () => {
  // v0.8.7 F4 · 整个 suite 只 peek 一次现有数据；不调 reset() 不破坏 dev 数据。
  let cached: SeedData | null = null;
  test.beforeAll(async ({ request }) => {
    const res = await request.get(
      `${process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:8000"}/api/v1/__test/seed/peek`,
    );
    if (!res.ok()) {
      throw new Error(`seed/peek failed: ${res.status()} ${await res.text()}`);
    }
    const peek = (await res.json()) as {
      admin_email: string | null;
      project_id: string | null;
      task_id: string | null;
    };
    if (!peek.admin_email) {
      throw new Error(
        "seed/peek 找不到 super_admin 用户。请先跑 `cd apps/api && PYTHONPATH=. uv run python scripts/seed.py` 创建开发账号。",
      );
    }
    cached = {
      admin_email: peek.admin_email,
      // annotator / reviewer 缺失时兜底用 admin（super_admin 各页面都可访问）
      annotator_email: peek.admin_email,
      reviewer_email: peek.admin_email,
      project_id: peek.project_id ?? "",
      task_ids: peek.task_id ? [peek.task_id] : [],
    };
  });

  for (const scene of SCENES) {
    test(scene.name, async ({ page, seed }, info) => {
      if (!cached) throw new Error("seed peek 未完成");
      const data = cached;

      // 缺关键数据时跳过（如 review/* 需要 task_id；export/* 需要 project_id）
      const needsProject = scene.route(data).includes(data.project_id || "__none__");
      const needsTask = scene.route(data).includes(data.task_ids[0] || "__none__");
      if (needsProject && !data.project_id) {
        info.annotations.push({
          type: "skipped",
          description: "无项目数据：跑 seed.py 或新建一个项目后再来",
        });
        test.skip();
      }
      if (needsTask && !data.task_ids[0]) {
        info.annotations.push({
          type: "skipped",
          description: "无任务数据：跑 seed.py 或在项目内上传至少一张图后再来",
        });
        test.skip();
      }

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

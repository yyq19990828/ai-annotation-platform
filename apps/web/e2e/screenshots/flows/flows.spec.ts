/**
 * M3 · 流程录制 spec。
 *
 * 执行：`pnpm screenshots:flows`（单独 project，video:on 全程录制）
 *
 * 前置条件同 screenshots.spec.ts。
 * 每条 test 跑完后把 .webm → GIF 落到
 * apps/web/e2e/screenshots/outputs/flows/。
 */
import { test } from "../../fixtures/seed";
import type { SeedData } from "../../fixtures/seed";
import { runE2eQuickstart } from "./e2e-quickstart";
import { runAiPreannotate } from "./ai-preannotate";
import { runReviewReject } from "./review-reject";
import { convertToGif, copyAsWebm } from "../_helpers/recorder";
import path from "path";
import fs from "fs";

const HERE = decodeURIComponent(new URL(".", import.meta.url).pathname);
const REPO_ROOT = HERE.replace(/\/apps\/web\/e2e\/screenshots\/flows\/?$/, "");
const FLOWS_OUT = path.join(REPO_ROOT, "apps/web/e2e/screenshots/outputs/flows");
const DOCS_GIF  = path.join(REPO_ROOT, "docs-site/user-guide/images/getting-started");

let cached: SeedData | null = null;

test.beforeAll(async ({ request }) => {
  const res = await request.get(
    `${process.env.PLAYWRIGHT_API_BASE ?? "http://localhost:8000"}/api/v1/__test/seed/peek`,
  );
  if (!res.ok()) throw new Error(`seed/peek failed: ${res.status()}`);
  const peek = (await res.json()) as {
    admin_email: string | null;
    project_id: string | null;
    task_id: string | null;
  };
  if (!peek.admin_email) throw new Error("seed/peek: 找不到 admin 用户");
  cached = {
    admin_email:     peek.admin_email,
    annotator_email: peek.admin_email,
    reviewer_email:  peek.admin_email,
    project_id:      peek.project_id ?? "",
    task_ids:        peek.task_id ? [peek.task_id] : [],
    ml_backend_id:   "",
  };
});

async function finalize(
  page: { video(): { path(): Promise<string | null> } | null },
  gifName: string,
) {
  const video = page.video();
  if (!video) {
    console.warn("[flows] video 未开启，检查 playwright config 的 flows project");
    return;
  }
  const webmPath = await video.path();
  if (!webmPath) { console.warn("[flows] 无法获取 video 路径"); return; }

  const outWebm = path.join(FLOWS_OUT, `${gifName}.webm`);
  const outGif  = path.join(FLOWS_OUT, `${gifName}.gif`);

  await copyAsWebm(webmPath, outWebm);
  await convertToGif(webmPath, outGif, { fps: 10, maxWidth: 1280 });

  // e2e-quickstart.gif 同步到文档站
  if (gifName === "e2e-quickstart") {
    const docsGif = path.join(DOCS_GIF, "e2e.gif");
    fs.mkdirSync(path.dirname(docsGif), { recursive: true });
    if (fs.existsSync(outGif)) {
      fs.copyFileSync(outGif, docsGif);
      console.log(`[flows] ✓ 同步 e2e.gif 到文档站：${docsGif}`);
    }
  }
}

test.describe("flow recordings", () => {
  test("e2e-quickstart — 登录→标注→提交", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    await seed.injectToken(page, cached.admin_email);
    await runE2eQuickstart(page, cached);
    await finalize(page, "e2e-quickstart");
  });

  test("ai-preannotate — AI 预标注发起流程", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    await seed.injectToken(page, cached.admin_email);
    await runAiPreannotate(page, cached);
    await finalize(page, "ai-preannotate");
  });

  test("review-reject — 审核拒回流程", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    await seed.injectToken(page, cached.reviewer_email);
    await runReviewReject(page, cached);
    await finalize(page, "review-reject");
  });
});

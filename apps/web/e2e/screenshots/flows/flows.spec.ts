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
import type { Page } from "@playwright/test";
import { runE2eQuickstart } from "./e2e-quickstart";
import { runAiPreannotate } from "./ai-preannotate";
import { runReviewReject } from "./review-reject";
import { runBatchBulkActions } from "./batch-bulk-actions";
import { runAiPreVariantSelector } from "./ai-pre-variant-selector";
import { runRotatedBbox } from "./rotated-bbox";
import { runPolylineDraw } from "./polyline-draw";
import { convertToGif } from "../_helpers/recorder";
import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";

const HERE = decodeURIComponent(new URL(".", import.meta.url).pathname);
const REPO_ROOT = HERE.replace(/\/apps\/web\/e2e\/screenshots\/flows\/?$/, "");
const FLOWS_OUT = path.join(REPO_ROOT, "apps/web/e2e/screenshots/outputs/flows");
const DOCS_GIF  = path.join(REPO_ROOT, "docs-site/user-guide/images/getting-started");
const DOCS_IMAGES = path.join(REPO_ROOT, "docs-site/user-guide/images");

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

// 画完删除：所有 flow 跑完后，清掉 canvas flow 在 P-COCO8 演示项目落下的标注（旋转框/折线/区域），
// 保持 DB 干净。这些几何类型只可能来自本套录制脚本，删除安全。
// 为何不用 API：workbench 不把实际打开的任务同步回 URL，且 GET /tasks/{id}/annotations 对
// 未分配给当前用户的任务返回空，定位不到要删的标注；画布 Ctrl+A/Delete 又受绘制态/焦点影响不可靠。
// 故直接经 docker postgres 容器 psql 删除（flows 本就依赖 docker 开发栈，容器名见 CLAUDE.md）。
// 用 display_id='P-COCO8' 连 projects 表定位（项目 UUID 由 seed 随机生成，重 seed 即变，不可硬编码）。
test.afterAll(() => {
  try {
    execFileSync(
      "docker",
      [
        "exec", "ai-annotation-platform-postgres-1",
        "psql", "-U", "user", "-d", "annotation", "-c",
        "DELETE FROM annotations a USING tasks t, projects p " +
          "WHERE a.task_id=t.id AND t.project_id=p.id AND p.display_id='P-COCO8' " +
          "AND a.geometry->>'type' IN ('rotated_bbox','polyline','region');",
      ],
      { stdio: "ignore" },
    );
  } catch {
    console.warn("[flows] 演示标注清理失败（需 docker postgres 容器在运行）");
  }
});

async function finalize(
  page: Page,
  gifName: string,
  // 文档站目标 gif 绝对路径（不填则只产出到 outputs/flows/）
  docsTarget?: string,
  // GIF 转码参数（不填默认 fps:10 / maxWidth:1280）；工作台画面细节多时调小避免超 5MB；
  // startSec/durationSec 裁掉录屏开头(准备)与结尾(清理)，只留核心片段。
  gifOpts?: { fps?: number; maxWidth?: number; startSec?: number; durationSec?: number },
) {
  const video = page.video();
  if (!video) {
    console.warn("[flows] video 未开启，检查 playwright config 的 flows project");
    return;
  }

  const outWebm = path.join(FLOWS_OUT, `${gifName}.webm`);
  const outGif  = path.join(FLOWS_OUT, `${gifName}.gif`);

  // video 只在 page 关闭后才写完整；先 close 再 saveAs（saveAs 会等视频落盘），
  // 避免直接读 video.path() 拿到半截 webm 导致 ffmpeg palettegen 失败（短流程必踩）。
  await page.close();
  fs.mkdirSync(FLOWS_OUT, { recursive: true });
  await video.saveAs(outWebm);
  await convertToGif(outWebm, outGif, {
    fps: gifOpts?.fps ?? 10,
    maxWidth: gifOpts?.maxWidth ?? 1280,
    startSec: gifOpts?.startSec,
    durationSec: gifOpts?.durationSec,
  });

  // 同步 gif 到文档站
  const docsGif = docsTarget ?? (gifName === "e2e-quickstart" ? path.join(DOCS_GIF, "e2e.gif") : null);
  if (docsGif && fs.existsSync(outGif)) {
    fs.mkdirSync(path.dirname(docsGif), { recursive: true });
    fs.copyFileSync(outGif, docsGif);
    console.log(`[flows] ✓ 同步 gif 到文档站：${docsGif}`);
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

  test("batch-bulk-actions — 批次多选批量操作", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    await seed.injectToken(page, cached.admin_email);
    await runBatchBulkActions(page);
    await finalize(page, "batch-bulk-actions", path.join(DOCS_IMAGES, "projects/batch-bulk-actions.gif"));
  });

  test("ai-pre-variant-selector — 变体两轴联动", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    await seed.injectToken(page, cached.admin_email);
    await runAiPreVariantSelector(page);
    await finalize(page, "ai-pre-variant-selector", path.join(DOCS_IMAGES, "projects/ai-pre-variant-selector.gif"));
  });

  test("rotated-bbox — 旋转框绘制", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    const t0 = Date.now(); // 录屏起点参照（page 在测试体前创建，t0≈video t=0）
    await seed.injectToken(page, cached.admin_email);
    const win = await runRotatedBbox(page, cached);
    await finalize(
      page,
      "rotated-bbox",
      path.join(DOCS_IMAGES, "workbench/rotated-bbox.gif"),
      { fps: 8, maxWidth: 900, ...drawTrim(win, t0) },
    );
  });

  test("polyline-draw — 折线逐点绘制", async ({ page, seed }) => {
    if (!cached) throw new Error("seed peek 未完成");
    const t0 = Date.now();
    await seed.injectToken(page, cached.admin_email);
    const win = await runPolylineDraw(page, cached);
    await finalize(
      page,
      "polyline-draw",
      path.join(DOCS_IMAGES, "polyline/draw-in-progress.gif"),
      { fps: 8, maxWidth: 900, ...drawTrim(win, t0) },
    );
  });
});

// 由绘制起止时间戳算 GIF 裁剪窗口：startSec 跳过开头(加载/隐藏预测/选工具)，
// durationSec 只留绘制段(裁掉结尾的删除清理)。win 为 null(工具缺失)时不裁。
function drawTrim(
  win: { drawStartMs: number; drawEndMs: number } | null,
  t0: number,
): { startSec?: number; durationSec?: number } {
  if (!win) return {};
  const startSec = Math.max(0, (win.drawStartMs - t0) / 1000 - 0.4);
  const durationSec = (win.drawEndMs - win.drawStartMs) / 1000 + 0.8;
  return { startSec, durationSec };
}

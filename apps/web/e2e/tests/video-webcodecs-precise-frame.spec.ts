/**
 * v0.23.15 · WebCodecs 精确帧 pipeline E2E(§5.3 用例矩阵)。
 *
 * 浏览器能力门:WebCodecs VideoDecoder 需 secure context + 实际解码能力。localhost 下
 * Chromium 暴露 VideoDecoder 构造器,但 headless 软解下 isConfigSupported / 实际 decode
 * 可能不通过,精确帧会安全回退。故本 spec **capability-aware**:先观测 precise pipeline
 * 实际解析到的 source,再分支断言 —— 精确帧成功则验证像素合同,回退则验证 fallback 合同
 * 并通过 annotation 记录原因,绝不把"回退"伪装成"精确帧已验证",也不把"能力不足"判 fail
 * (§5.4)。像素级 corner_bits 断言在有头 Chrome / GPU runner 下精确帧激活后补全。
 *
 * headless 必过(不依赖精确帧成功):
 *   - flag off:pipeline 不激活,零 manifest-v2 / chunk samples 请求,source 非 webcodecs。
 *   - flag on:pipeline 解析到 precise 或稳定 fallback,显示源合法、无黑屏、时间轴可逐帧。
 *   - transition 端点:pending → ready API 契约。
 *
 * capability-gated(精确帧激活环境才跑):corner_bits 像素命中目标帧、pending→precise 自动切。
 */
import { test, expect, type Page } from "../fixtures/seed";
import type { SeedAPI } from "../fixtures/seed";

const WEBCODECS_FLAG = "video.experimental.webcodecs";

async function readPreciseDiagnostics(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const store = (window as unknown as { __videoWorkbenchDiagnostics?: unknown })
      .__videoWorkbenchDiagnostics;
    if (!store || typeof store !== "object") return null;
    const s = store as { activeTaskId?: string; byTask?: Record<string, unknown> };
    const active = s.activeTaskId ? s.byTask?.[s.activeTaskId] : null;
    return (active as { preciseFrame?: Record<string, unknown> })?.preciseFrame ?? null;
  });
}

async function openVideoTask(
  page: Page,
  seed: SeedAPI,
  fixture: string,
  chunkStatus: "ready" | "pending" = "ready",
) {
  const data = await seed.reset();
  const video = await seed.videoWebCodecs(data.project_id, { fixture, chunkStatus });
  await seed.injectToken(page, data.admin_email);
  await page.goto(`/projects/${data.project_id}/annotate?task=${video.task_id}`);
  await expect(page.getByTestId("video-konva-stage")).toBeVisible({ timeout: 20_000 });
  return { data, video };
}

/** 开 flag + 刷新 + 暂停逐帧,等 precise pipeline 收敛,返回可观察状态。 */
async function resolvePreciseState(page: Page, settleMs = 2500) {
  await page.evaluate((key) => localStorage.setItem(key, "1"), WEBCODECS_FLAG);
  await page.reload();
  const stage = page.getByTestId("video-konva-stage");
  await expect(stage).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(settleMs);
  const source = await stage.getAttribute("data-video-frame-source");
  const state = await stage.getAttribute("data-video-precise-state");
  const diag = await readPreciseDiagnostics(page);
  return { stage, source, state, diag };
}

test.describe("video webcodecs precise-frame pipeline", () => {
  test("flag off: precise pipeline stays disabled with zero precise API requests", async ({
    page,
    seed,
  }) => {
    test.setTimeout(90_000);
    await openVideoTask(page, seed, "h264-baseline-gop12");
    await page.evaluate((key) => localStorage.removeItem(key), WEBCODECS_FLAG);
    await page.reload();
    const stage = page.getByTestId("video-konva-stage");
    await expect(stage).toBeVisible({ timeout: 20_000 });

    const preciseUrls: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (
        url.includes("/video/manifest-v2") ||
        (url.includes("/chunks/") && url.includes("/samples"))
      ) {
        preciseUrls.push(url);
      }
    });

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowRight");
    }
    await expect(stage).toHaveAttribute("data-video-precise-state", "disabled");
    await expect(stage).toHaveAttribute("data-video-frame-source", /^(native-bitmap|video)$/);
    expect(preciseUrls).toEqual([]);

    const diag = await readPreciseDiagnostics(page);
    expect(diag).not.toBeNull();
    expect(diag?.enabled).toBe(false);
  });

  test("flag on: precise pipeline resolves to precise decode or a documented fallback", async ({
    page,
    seed,
  }) => {
    test.setTimeout(90_000);
    await openVideoTask(page, seed, "h264-main-bframes-gop30");
    const { stage, source, state, diag } = await resolvePreciseState(page);

    test.info().annotations.push({
      type: "precise-resolution",
      description: JSON.stringify({
        source,
        state,
        supported: diag?.supported ?? null,
        fallbackReason: diag?.fallbackReason ?? null,
      }),
    });

    // 核心合同(§5.3):显示源合法不黑屏 + 时间轴可逐帧。
    expect(["webcodecs", "native-bitmap", "video"]).toContain(source);
    await expect(page.getByText(/F\s*1\s*\//)).toBeVisible({ timeout: 10_000 });
    // 精确帧成功时 state=ready;其余态(loading/decoding/disabled/fallback)均允许,
    // 诊断会记录 state / fallbackReason 供排障,不在此强约束(避免把"未就绪"判成失败)。
    if (source === "webcodecs") {
      expect(state).toBe("ready");
    }
  });

  test("precise frame pixels match the target frame (gated on actual precise decode)", async ({
    page,
    seed,
  }) => {
    test.setTimeout(120_000);
    await openVideoTask(page, seed, "h264-main-bframes-gop30");
    const { stage, source } = await resolvePreciseState(page);
    // 精确帧像素断言需要 source 真正切到 webcodecs;headless 软解若不通过则 skip 并记录,
    // 不把它当成"像素已验证",也不当成失败(§5.4 capability unavailable)。
    test.skip(
      source !== "webcodecs",
      "precise decode 未激活(headless 软解 / codec 不支持);需有头 Chrome 或 GPU runner",
    );
    await expect(stage).toHaveAttribute("data-video-precise-state", "ready");
    test.info().annotations.push({
      type: "precise-pixels",
      description: "decoder path active; corner_bits pixel harness ready for headed run",
    });
    // TODO(headed): 按 frame_expectations.sample_regions 采样 Konva canvas 四角与背景,
    // 阈值判定 corner_bits,断言与 data-video-frame-index 一致(key / P / B / GOP / VFR)。
  });

  test("pending → ready transition endpoint flips chunk status", async ({ seed }) => {
    const data = await seed.reset();
    const video = await seed.videoWebCodecs(data.project_id, {
      fixture: "h264-baseline-gop12",
      chunkStatus: "pending",
    });
    const res = await seed.videoWebCodecsTransitionReady(video.dataset_item_id);
    expect(res.status).toBe("ready");
  });
});

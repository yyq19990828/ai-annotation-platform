/**
 * WebCodecs 精确帧浏览器合同：
 * - flag off 覆盖首次挂载到 reload 的完整请求生命周期；
 * - flag on 必须收敛到 ready、稳定 fallback 或明确的原语能力缺失；
 * - 有解码能力时从 Konva media canvas 读取确定性 H.264 帧标记；
 * - pending 必须经真实浏览器轮询自动恢复，unsupported/malformed 必须稳定降级。
 */
import { test, expect, type Page } from "../fixtures/seed";
import type { SeedAPI } from "../fixtures/seed";

const WEBCODECS_FLAG = "video.experimental.webcodecs";
const TERMINAL_TIMEOUT_MS = 20_000;
const REQUIRE_PRECISE_DECODE = process.env.PLAYWRIGHT_REQUIRE_WEBCODECS === "1";

interface NormalizedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FrameExpectation {
  frame_index: number;
  background_luma: number;
  corner_bits: number[];
  pts_ms?: number;
  duration_ms?: number;
  is_keyframe?: boolean;
  decode_index?: number;
}

interface FrameExpectations {
  width: number;
  height: number;
  frame_count: number;
  sample_regions: {
    background: NormalizedRegion;
    corners: Array<NormalizedRegion & { bit: number }>;
  };
  frames: FrameExpectation[];
}

interface PreciseDiagnostics {
  enabled?: boolean;
  supported?: boolean;
  state?: string;
  source?: string;
  frameIndex?: number;
  fallbackReason?: string | null;
  targetTimestampUs?: number | null;
}

interface PreciseSnapshot {
  source: string | null;
  state: string | null;
  frameIndex: number | null;
  diag: PreciseDiagnostics | null;
  terminal: "ready" | "fallback" | "unsupported" | "pending";
}

function isPreciseApiRequest(rawUrl: string): boolean {
  const pathname = new URL(rawUrl).pathname;
  return (
    /^\/api\/v1\/tasks\/[^/]+\/video\/manifest-v2$/.test(pathname) ||
    /^\/api\/v1\/videos\/[^/]+\/chunks\/\d+(?:\/samples)?$/.test(pathname)
  );
}

function isChunkMetadataUrl(rawUrl: string): boolean {
  return /^\/api\/v1\/videos\/[^/]+\/chunks\/\d+$/.test(new URL(rawUrl).pathname);
}

async function readPreciseDiagnostics(page: Page): Promise<PreciseDiagnostics | null> {
  return page.evaluate(() => {
    const store = (
      window as unknown as {
        __videoWorkbenchDiagnostics?: {
          activeTaskId?: string;
          byTask?: Record<string, { preciseFrame?: PreciseDiagnostics }>;
        };
      }
    ).__videoWorkbenchDiagnostics;
    return store?.activeTaskId ? (store.byTask?.[store.activeTaskId]?.preciseFrame ?? null) : null;
  });
}

async function readPreciseSnapshot(page: Page): Promise<PreciseSnapshot> {
  const stage = page.getByTestId("video-konva-stage");
  const [source, state, frameIndexRaw, diag] = await Promise.all([
    stage.getAttribute("data-video-frame-source"),
    stage.getAttribute("data-video-precise-state"),
    stage.getAttribute("data-video-frame-index"),
    readPreciseDiagnostics(page),
  ]);
  const frameIndex =
    frameIndexRaw !== null && Number.isFinite(Number(frameIndexRaw)) ? Number(frameIndexRaw) : null;
  let terminal: PreciseSnapshot["terminal"] = "pending";
  if (
    source === "webcodecs" &&
    state === "ready" &&
    frameIndex !== null &&
    diag?.frameIndex === frameIndex
  ) {
    terminal = "ready";
  } else if (
    state === "fallback" &&
    (source === "native-bitmap" || source === "video") &&
    typeof diag?.fallbackReason === "string" &&
    diag.fallbackReason.length > 0
  ) {
    terminal = "fallback";
  } else if (
    state === "disabled" &&
    diag?.enabled === true &&
    diag.supported === false &&
    (source === "native-bitmap" || source === "video")
  ) {
    terminal = "unsupported";
  }
  return { source, state, frameIndex, diag, terminal };
}

async function waitForPreciseTerminal(page: Page): Promise<PreciseSnapshot> {
  await expect
    .poll(async () => (await readPreciseSnapshot(page)).terminal, {
      timeout: TERMINAL_TIMEOUT_MS,
      message: "precise pipeline 应收敛到 ready、稳定 fallback 或明确 unsupported",
    })
    .toMatch(/^(ready|fallback|unsupported)$/);
  return readPreciseSnapshot(page);
}

async function setWebCodecsFlag(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, value ? "1" : "0");
    },
    { key: WEBCODECS_FLAG, value: enabled },
  );
}

async function seedAndOpenVideoTask(
  page: Page,
  seed: SeedAPI,
  fixture: string,
  options?: { chunkStatus?: "ready" | "pending"; flag?: boolean },
) {
  const data = await seed.reset();
  const video = await seed.videoWebCodecs(data.project_id, {
    fixture,
    chunkStatus: options?.chunkStatus ?? "ready",
  });
  await seed.injectToken(page, data.admin_email);
  await setWebCodecsFlag(page, options?.flag ?? true);
  await page.goto(`/projects/${data.project_id}/annotate?task=${video.task_id}`);
  await expect(page.getByTestId("video-konva-stage")).toBeVisible({ timeout: 20_000 });
  return {
    data,
    video: {
      ...video,
      frame_expectations: video.frame_expectations as unknown as FrameExpectations,
    },
  };
}

async function seekToFrame(page: Page, targetFrame: number): Promise<void> {
  const stage = page.getByTestId("video-konva-stage");
  const currentRaw = await stage.getAttribute("data-video-frame-index");
  const current = Number(currentRaw ?? 0);
  const key = targetFrame >= current ? "ArrowRight" : "ArrowLeft";
  for (let i = 0; i < Math.abs(targetFrame - current); i += 1) {
    await page.keyboard.press(key);
  }
  await expect(stage).toHaveAttribute("data-video-frame-index", String(targetFrame), {
    timeout: 10_000,
  });
}

async function sampleFrameMarkers(
  page: Page,
  regions: FrameExpectations["sample_regions"],
): Promise<{
  background: { luma: number; alpha: number };
  corners: Array<{ bit: number; luma: number; alpha: number }>;
}> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return page.evaluate((sampleRegions) => {
    const stage = document.querySelector<HTMLElement>('[data-testid="video-konva-stage"]');
    const canvas = stage?.querySelector<HTMLCanvasElement>(".konvajs-content > canvas");
    if (!canvas) throw new Error("Konva media canvas not found");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Konva media canvas 2D context unavailable");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (pixels.data[(y * canvas.width + x) * 4 + 3] < 200) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX || maxY < minY) throw new Error("Konva media canvas has no opaque pixels");
    const mediaWidth = maxX - minX + 1;
    const mediaHeight = maxY - minY + 1;
    const average = (region: NormalizedRegion) => {
      const insetX = region.w * 0.2;
      const insetY = region.h * 0.2;
      const left = Math.max(minX, Math.floor(minX + (region.x + insetX) * mediaWidth));
      const top = Math.max(minY, Math.floor(minY + (region.y + insetY) * mediaHeight));
      const right = Math.min(maxX, Math.ceil(minX + (region.x + region.w - insetX) * mediaWidth));
      const bottom = Math.min(maxY, Math.ceil(minY + (region.y + region.h - insetY) * mediaHeight));
      let lumaTotal = 0;
      let alphaTotal = 0;
      let count = 0;
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          const r = pixels.data[offset];
          const g = pixels.data[offset + 1];
          const b = pixels.data[offset + 2];
          lumaTotal += 0.2126 * r + 0.7152 * g + 0.0722 * b;
          alphaTotal += pixels.data[offset + 3];
          count += 1;
        }
      }
      if (count === 0) throw new Error("pixel sample region is empty");
      return { luma: lumaTotal / count, alpha: alphaTotal / count };
    };
    return {
      background: average(sampleRegions.background),
      corners: sampleRegions.corners.map((region) => ({
        bit: region.bit,
        ...average(region),
      })),
    };
  }, regions);
}

async function assertFramePixels(
  page: Page,
  expectations: FrameExpectations,
  targetFrame: number,
): Promise<void> {
  const expected = expectations.frames.find((frame) => frame.frame_index === targetFrame);
  expect(expected, `missing frame expectation ${targetFrame}`).toBeDefined();
  const sampled = await sampleFrameMarkers(page, expectations.sample_regions);
  expect(sampled.background.alpha).toBeGreaterThan(240);
  expect(Math.abs(sampled.background.luma - expected!.background_luma)).toBeLessThanOrEqual(40);
  for (const corner of sampled.corners) {
    expect(corner.alpha).toBeGreaterThan(240);
    const expectedBit = expected!.corner_bits[corner.bit];
    if (expectedBit === 1) expect(corner.luma).toBeGreaterThan(160);
    else expect(corner.luma).toBeLessThan(95);
  }
  const diag = await readPreciseDiagnostics(page);
  expect(diag?.frameIndex).toBe(targetFrame);
  if (typeof expected!.pts_ms === "number") {
    expect(diag?.targetTimestampUs).toBe(expected!.pts_ms * 1000);
  }
}

function annotateResolution(snapshot: PreciseSnapshot): void {
  test.info().annotations.push({
    type: "precise-resolution",
    description: JSON.stringify({
      source: snapshot.source,
      state: snapshot.state,
      supported: snapshot.diag?.supported ?? null,
      fallbackReason: snapshot.diag?.fallbackReason ?? null,
    }),
  });
}

function skipIfCodecCapabilityUnavailable(snapshot: PreciseSnapshot): void {
  const capabilityUnavailable =
    !REQUIRE_PRECISE_DECODE &&
    (snapshot.terminal === "unsupported" ||
      (snapshot.terminal === "fallback" &&
        (snapshot.diag?.fallbackReason === "codec_unsupported" ||
          snapshot.diag?.fallbackReason === "decode_failed")));
  test.skip(
    capabilityUnavailable,
    `H.264 precise decode unavailable: ${snapshot.diag?.fallbackReason ?? "missing primitives"}`,
  );
}

const PIXEL_SCENARIOS = [
  { fixture: "h264-baseline-gop12", targets: [0, 1, 5], label: "baseline key/P" },
  {
    fixture: "h264-main-bframes-gop30",
    targets: [1, 2, 3, 17, 33],
    label: "main B-frame reorder",
  },
  { fixture: "h264-boundary-gop8", targets: [7, 8, 9], label: "GOP boundary" },
  { fixture: "h264-vfr", targets: [1, 2, 3], label: "VFR timestamp" },
] as const;

test.describe("video webcodecs precise-frame pipeline", () => {
  test("flag off: full page lifecycle has zero precise API requests", async ({ page, seed }) => {
    test.setTimeout(90_000);
    const data = await seed.reset();
    const video = await seed.videoWebCodecs(data.project_id, {
      fixture: "h264-baseline-gop12",
      chunkStatus: "ready",
    });
    await seed.injectToken(page, data.admin_email);
    await setWebCodecsFlag(page, false);
    const preciseUrls: string[] = [];
    page.on("request", (request) => {
      if (isPreciseApiRequest(request.url())) preciseUrls.push(request.url());
    });

    await page.goto(`/projects/${data.project_id}/annotate?task=${video.task_id}`);
    const stage = page.getByTestId("video-konva-stage");
    await expect(stage).toBeVisible({ timeout: 20_000 });
    for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowRight");
    await page.reload();
    await expect(stage).toBeVisible({ timeout: 20_000 });
    await expect(stage).toHaveAttribute("data-video-precise-state", "disabled");
    await expect(stage).toHaveAttribute("data-video-frame-source", /^(native-bitmap|video)$/);
    expect(preciseUrls).toEqual([]);
    expect((await readPreciseDiagnostics(page))?.enabled).toBe(false);
  });

  test("flag on: pipeline reaches ready or a documented stable fallback", async ({
    page,
    seed,
  }) => {
    test.setTimeout(90_000);
    await seedAndOpenVideoTask(page, seed, "h264-main-bframes-gop30");
    await seekToFrame(page, 1);
    const snapshot = await waitForPreciseTerminal(page);
    annotateResolution(snapshot);
    expect(["ready", "fallback", "unsupported"]).toContain(snapshot.terminal);
    await expect(page.getByText(/F\s*1\s*\//)).toBeVisible({ timeout: 10_000 });
  });

  for (const scenario of PIXEL_SCENARIOS) {
    test(`precise pixels: ${scenario.label}`, async ({ page, seed }) => {
      test.setTimeout(120_000);
      const { video } = await seedAndOpenVideoTask(page, seed, scenario.fixture);
      const expectations = video.frame_expectations;
      expect(expectations.frames).toHaveLength(expectations.frame_count);
      if (scenario.fixture === "h264-main-bframes-gop30") {
        expect(
          scenario.targets.some((target) => {
            const frame = expectations.frames.find((item) => item.frame_index === target);
            return frame?.decode_index !== frame?.frame_index;
          }),
        ).toBe(true);
      }
      if (scenario.fixture === "h264-vfr") {
        const pts = expectations.frames.slice(0, 4).map((frame) => frame.pts_ms ?? 0);
        const deltas = pts.slice(1).map((value, index) => value - pts[index]);
        expect(deltas[0]).toBeGreaterThanOrEqual(32);
        expect(deltas[0]).toBeLessThanOrEqual(35);
        expect(deltas[1]).toBeGreaterThanOrEqual(65);
        expect(deltas[1]).toBeLessThanOrEqual(68);
        expect(deltas[2]).toBeGreaterThanOrEqual(32);
        expect(deltas[2]).toBeLessThanOrEqual(35);
      }

      for (const target of scenario.targets) {
        await seekToFrame(page, target);
        const snapshot = await waitForPreciseTerminal(page);
        annotateResolution(snapshot);
        skipIfCodecCapabilityUnavailable(snapshot);
        expect(snapshot.terminal, JSON.stringify(snapshot)).toBe("ready");
        await assertFramePixels(page, expectations, target);
      }
    });
  }

  test("pending chunk is polled and automatically resumes precise decode", async ({
    page,
    seed,
  }) => {
    test.setTimeout(120_000);
    const chunkStatuses: number[] = [];
    page.on("response", (response) => {
      if (isChunkMetadataUrl(response.url())) chunkStatuses.push(response.status());
    });
    const { video } = await seedAndOpenVideoTask(page, seed, "h264-baseline-gop12", {
      chunkStatus: "pending",
    });
    const stage = page.getByTestId("video-konva-stage");
    await expect
      .poll(
        async () => {
          const snapshot = await readPreciseSnapshot(page);
          if (snapshot.terminal === "unsupported") return "unsupported";
          return snapshot.state === "chunk-pending" ? "chunk-pending" : "pending";
        },
        {
          timeout: 15_000,
          message: "pending fixture 应进入 chunk-pending 或明确 unsupported",
        },
      )
      .toMatch(/^(chunk-pending|unsupported)$/);
    const initial = await readPreciseSnapshot(page);
    if (initial.terminal === "unsupported") {
      annotateResolution(initial);
      test.skip(
        !REQUIRE_PRECISE_DECODE,
        "WebCodecs primitives unavailable; pending pipeline cannot activate",
      );
    }
    await expect(stage).toHaveAttribute("data-video-precise-state", "chunk-pending");
    await expect.poll(() => chunkStatuses.includes(202), { timeout: 10_000 }).toBe(true);

    const transition = await seed.videoWebCodecsTransitionReady(
      video.dataset_item_id,
      video.chunk_id,
    );
    expect(transition.status).toBe("ready");
    await expect.poll(() => chunkStatuses.includes(200), { timeout: 15_000 }).toBe(true);
    const snapshot = await waitForPreciseTerminal(page);
    annotateResolution(snapshot);
    skipIfCodecCapabilityUnavailable(snapshot);
    expect(snapshot.terminal, JSON.stringify(snapshot)).toBe("ready");
  });

  for (const fault of [
    { fixture: "unsupported-config", reason: "codec_unsupported" },
    { fixture: "malformed-samples", reason: "invalid_sample_range" },
  ] as const) {
    test(`${fault.fixture} reaches stable fallback`, async ({ page, seed }) => {
      test.setTimeout(90_000);
      await seedAndOpenVideoTask(page, seed, fault.fixture);
      await seekToFrame(page, 1);
      const snapshot = await waitForPreciseTerminal(page);
      annotateResolution(snapshot);
      if (snapshot.terminal === "unsupported") {
        test.skip(
          !REQUIRE_PRECISE_DECODE,
          "WebCodecs primitives unavailable; fault path cannot activate",
        );
      }
      expect(snapshot.terminal).toBe("fallback");
      expect(snapshot.diag?.fallbackReason).toBe(fault.reason);
      expect(snapshot.source).toMatch(/^(native-bitmap|video)$/);
      await expect(page.getByText(/F\s*1\s*\//)).toBeVisible({ timeout: 10_000 });
    });
  }
});

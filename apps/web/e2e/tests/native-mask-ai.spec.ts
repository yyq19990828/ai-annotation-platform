import type { APIResponse, Page, Request } from "@playwright/test";
import {
  expect,
  test,
  type SeedNativeMaskCandidateData,
} from "../fixtures/seed";

const API_BASE = process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:8010";
const MATRIX = process.env.PLAYWRIGHT_RASTER_MASK_MATRIX;

interface AcceptedMaskResponse {
  prediction: { id: string };
  annotation: {
    id: string;
    annotation_type: "raster_mask" | "video_track_mask";
  };
  content_digest: string;
  replayed: boolean;
}

const nativeSetup = {
  name: "e2e-native-mask",
  version: "1.0.0",
  model_version: "e2e-native-mask",
  is_interactive: true,
  supported_prompts: ["point", "interactive_box", "exemplar", "mask", "scribble"],
  supported_inputs: ["full_image", "point_prompt", "bbox_prompt", "mask_prompt", "scribble_prompt"],
  supported_geometric_outputs: ["polygon", "mask"],
  models: [
    {
      id: "e2e-native-mask",
      display_name: "E2E Native Mask",
      task: "interactive_seg",
      model_family: "e2e",
      composition: "atom",
      is_interactive: true,
      supported_prompts: ["point", "interactive_box", "exemplar", "mask", "scribble"],
      supported_inputs: ["full_image", "point_prompt", "bbox_prompt", "mask_prompt", "scribble_prompt"],
      supported_geometric_outputs: ["polygon", "mask"],
      resource_profile: { device: "cpu", batchable: false },
    },
  ],
};

async function routeNativeCandidate(
  page: Page,
  fixture: SeedNativeMaskCandidateData,
  options?: { failFirst?: boolean },
): Promise<{ contexts: Array<Record<string, unknown>> }> {
  const contexts: Array<Record<string, unknown>> = [];
  let failedPrompt = false;
  await page.route(
    /\/api\/v1\/projects\/[^/]+\/ml-backends\/[^/]+\/setup/,
    (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(nativeSetup) }),
  );
  await page.route(
    /\/api\/v1\/projects\/[^/]+\/ml-backends\/[^/]+\/interactive-annotating(?:-frame)?/,
    async (route) => {
      const request = route.request();
      if (request.headers()["content-type"]?.includes("application/json")) {
        const body = request.postDataJSON() as { context?: Record<string, unknown> };
        contexts.push(body.context ?? {});
      } else {
        const match = request.postData()?.match(/name="context"\r?\n\r?\n([^\r\n]+)/);
        contexts.push(match ? JSON.parse(match[1]) as Record<string, unknown> : {});
      }
      const isTargetPrompt = contexts.at(-1)?.type === "scribble";
      const shouldFail = options?.failFirst && isTargetPrompt && !failedPrompt;
      if (shouldFail) failedPrompt = true;
      await route.fulfill(shouldFail ? {
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          detail: { reason: "temporary_failure", message: "retry the same prompt" },
        }),
      } : {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fixture.response),
      });
    },
  );
  return { contexts };
}

async function generateAndAccept(
  page: Page,
  projectId: string,
  taskId: string,
  media: "image" | "video",
): Promise<AcceptedMaskResponse> {
  await page.goto(`/projects/${projectId}/annotate?task=${taskId}`);
  const stage = page.getByTestId(media === "image" ? "workbench-stage" : "video-konva-stage");
  await expect(stage).toBeVisible({ timeout: 20_000 });

  const point = page.getByTestId(
    media === "image" ? "tool-btn-smart-point" : "video-tool-btn-smart-point",
  );
  await expect(point).toBeVisible({ timeout: 15_000 });
  await expect(point).not.toHaveAttribute("aria-disabled", "true");
  await point.click();
  await expect(page.getByTestId("single-frame-output-geometry-select")).toHaveValue("mask");

  const box = await stage.boundingBox();
  if (!box) throw new Error("workbench stage has no bounding box");
  const interactiveResponse = page.waitForResponse((response) =>
    /\/interactive-annotating(?:-frame)?$/.test(new URL(response.url()).pathname),
  );
  await page.mouse.click(box.x + box.width * 0.68, box.y + box.height * 0.48);
  expect((await interactiveResponse).status()).toBe(200);
  await expect(page.getByText("候选待处理", { exact: true })).toBeVisible({ timeout: 10_000 });
  // Native candidate bounds are derived asynchronously by the shared raster renderer.
  await page.waitForTimeout(media === "image" ? 250 : 750);

  await page.keyboard.press("Enter");
  const picker = page.getByTestId("class-picker-popover");
  await expect(picker).toBeVisible({ timeout: 10_000 });
  const accepted = page.waitForResponse((response) =>
    response.url().endsWith(`/api/v1/tasks/${taskId}/ai-mask-candidates/accept`)
    && response.request().method() === "POST",
  );
  await picker.getByText("car", { exact: true }).click();
  const response = await accepted;
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<AcceptedMaskResponse>;
}

async function expectRleEquals(
  response: APIResponse,
  expected: SeedNativeMaskCandidateData["rle"],
): Promise<void> {
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(await response.json()).toEqual(expected);
}

test.describe("native Mask interactive candidate acceptance", () => {
  test.skip(MATRIX !== "native", "requires the native raster Mask matrix");

  test("image candidate and committed raster Mask keep identical pixels", async ({ page, request, seed }) => {
    const data = await seed.reset();
    const taskId = data.task_ids[0];
    await seed.configureRasterMask(data.project_id, true);
    await seed.advanceTask({ taskId, toStatus: "pending", annotatorEmail: data.annotator_email });
    const fixture = await seed.nativeMaskCandidate(taskId);
    const routed = await routeNativeCandidate(page, fixture);
    await seed.injectToken(page, data.annotator_email);

    const accepted = await generateAndAccept(page, data.project_id, taskId, "image");
    expect(accepted.annotation.annotation_type).toBe("raster_mask");
    expect(accepted.prediction.id).toBeTruthy();
    expect(accepted.replayed).toBe(false);
    expect(routed.contexts.at(-1)?.output_geometry).toBe("mask");

    const token = await seed.accessToken(data.annotator_email);
    await expectRleEquals(
      await request.get(
        `${API_BASE}/api/v1/annotations/${accepted.annotation.id}/mask-content`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
      fixture.rle,
    );
  });

  test("video current-frame candidate and committed keyframe keep identical pixels", async ({ page, request, seed }) => {
    const data = await seed.reset();
    const { task_id: taskId } = await seed.videoTask(data.project_id);
    await seed.advanceTask({ taskId, toStatus: "pending", annotatorEmail: data.annotator_email });
    const fixture = await seed.nativeMaskCandidate(taskId);
    const routed = await routeNativeCandidate(page, fixture);
    await seed.injectToken(page, data.annotator_email);

    const accepted = await generateAndAccept(page, data.project_id, taskId, "video");
    expect(accepted.annotation.annotation_type).toBe("video_track_mask");
    expect(routed.contexts.at(-1)?.output_geometry).toBe("mask");

    const token = await seed.accessToken(data.annotator_email);
    await expectRleEquals(
      await request.get(
        `${API_BASE}/api/v1/annotations/${accepted.annotation.id}/mask-content/0`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
      fixture.rle,
    );
  });

  test("saved Mask negative scribble survives a failed prompt retry and refresh", async ({ page, request, seed }) => {
    const data = await seed.reset();
    const taskId = data.task_ids[0];
    await seed.configureRasterMask(data.project_id, true);
    await seed.advanceTask({ taskId, toStatus: "pending", annotatorEmail: data.annotator_email });
    const source = await seed.injectRasterMask({
      taskId,
      userEmail: data.annotator_email,
    });
    const fixture = await seed.nativeMaskCandidate(taskId, {
      variant: "negative_scribble",
      promptFamily: "scribble",
      negativeScribbles: 1,
      promptSource: {
        annotationId: source.annotation_id,
        sourceVersion: 1,
        sourceDigest: source.mask.sha256,
      },
    });
    const routed = await routeNativeCandidate(page, fixture, { failFirst: true });
    await seed.injectToken(page, data.annotator_email);

    const token = await seed.accessToken(data.annotator_email);
    const before = await request.get(
      `${API_BASE}/api/v1/annotations/${source.annotation_id}/mask-content`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect((await before.json()).counts).not.toEqual(fixture.rle.counts);

    await page.goto(`/projects/${data.project_id}/annotate?task=${taskId}`);
    const stage = page.getByTestId("workbench-stage");
    await expect(stage).toBeVisible({ timeout: 20_000 });
    await page.getByTestId(`box-list-item-${source.annotation_id}`).click();
    const scribble = page.getByTestId("tool-btn-smart-scribble");
    await expect(scribble).not.toHaveAttribute("aria-disabled", "true");
    await scribble.click();
    await expect(page.getByTestId("mask-prompt-source")).toContainText("精修 Mask");
    const polarity = page.getByTestId("ai-tool-polarity");
    await polarity.click();
    await expect(polarity).toHaveAttribute("title", /负向/);

    const box = await stage.boundingBox();
    if (!box) throw new Error("workbench stage has no bounding box");
    await page.mouse.move(box.x + box.width * 0.46, box.y + box.height * 0.46);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.54, { steps: 8 });
    await page.mouse.up();
    const scribbleContexts = () => routed.contexts.filter((context) => context.type === "scribble");
    await expect.poll(() => scribbleContexts().length, { timeout: 10_000 }).toBe(1);

    const retry = page.getByTestId("interactive-prompt-retry");
    await expect(retry).toBeVisible({ timeout: 10_000 });
    const staleAcceptRequests: string[] = [];
    const captureAccept = (request: Request) => {
      if (request.url().endsWith(`/api/v1/tasks/${taskId}/ai-mask-candidates/accept`)) {
        staleAcceptRequests.push(request.url());
      }
    };
    page.on("request", captureAccept);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("class-picker-popover")).toBeHidden();
    await page.waitForTimeout(200);
    page.off("request", captureAccept);
    expect(staleAcceptRequests).toEqual([]);

    await retry.click();
    await expect.poll(() => scribbleContexts().length, { timeout: 10_000 }).toBe(2);
    await expect(page.getByText("候选待处理", { exact: true })).toBeVisible({ timeout: 10_000 });

    expect(scribbleContexts()[1]).toEqual(scribbleContexts()[0]);
    expect(scribbleContexts()[1]?.mask_prompt_source).toMatchObject({
      annotation_id: source.annotation_id,
    });
    expect(scribbleContexts()[1]?.scribbles).toEqual([
      expect.objectContaining({ polarity: 0 }),
    ]);

    await page.keyboard.press("Enter");
    const picker = page.getByTestId("class-picker-popover");
    await expect(picker).toBeVisible({ timeout: 10_000 });
    const accepted = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/tasks/${taskId}/ai-mask-candidates/accept`)
      && response.request().method() === "POST",
    );
    await picker.getByText("car", { exact: true }).click();
    const acceptedResponse = await accepted;
    expect(acceptedResponse.status()).toBe(200);
    const acceptedBody = await acceptedResponse.json() as AcceptedMaskResponse;
    expect(acceptedBody.annotation.id).toBe(source.annotation_id);

    await expectRleEquals(
      await request.get(
        `${API_BASE}/api/v1/annotations/${source.annotation_id}/mask-content`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
      fixture.rle,
    );
    await page.reload();
    await expect(page.getByTestId(`box-list-item-${source.annotation_id}`)).toBeVisible({ timeout: 15_000 });
    await expectRleEquals(
      await request.get(
        `${API_BASE}/api/v1/annotations/${source.annotation_id}/mask-content`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
      fixture.rle,
    );
  });
});

import type { APIResponse, Page } from "@playwright/test";
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
  supported_prompts: ["point", "interactive_box", "exemplar"],
  supported_inputs: ["full_image", "point_prompt", "bbox_prompt"],
  supported_geometric_outputs: ["polygon", "mask"],
  models: [
    {
      id: "e2e-native-mask",
      display_name: "E2E Native Mask",
      task: "interactive_seg",
      model_family: "e2e",
      composition: "atom",
      is_interactive: true,
      supported_prompts: ["point", "interactive_box", "exemplar"],
      supported_inputs: ["full_image", "point_prompt", "bbox_prompt"],
      supported_geometric_outputs: ["polygon", "mask"],
      resource_profile: { device: "cpu", batchable: false },
    },
  ],
};

async function routeNativeCandidate(
  page: Page,
  fixture: SeedNativeMaskCandidateData,
): Promise<{ contexts: Array<Record<string, unknown>> }> {
  const contexts: Array<Record<string, unknown>> = [];
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
      await route.fulfill({
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
  expect(response.status()).toBe(200);
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
});

import { expect, test, type Page } from "@playwright/test";
import { annotationPaintedPixels } from "../fixtures/annotation-canvas-pixels";

async function stageFixture(page: Page, taintedLayer: "media" | "annotation" = "media") {
  await page.route("http://canvas-ui.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div data-testid="stage"><div class="konvajs-content">
        <canvas id="media" width="32" height="32"></canvas>
        <canvas id="annotation" width="32" height="32"></canvas>
        <canvas id="overlay" width="32" height="32"></canvas>
      </div></div>`,
    }),
  );
  await page.route("http://canvas-media.test/image.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="black"/></svg>',
    }),
  );
  await page.goto("http://canvas-ui.test/");
  await page.evaluate(async (layer) => {
    const image = new Image();
    image.src = "http://canvas-media.test/image.svg";
    await image.decode();
    const canvas = document.getElementById(layer) as HTMLCanvasElement;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    const annotation = document.getElementById("annotation") as HTMLCanvasElement;
    annotation.getContext("2d")!.fillRect(2, 3, 4, 5);
  }, taintedLayer);
  return page.getByTestId("stage");
}

test("annotation pixels exclude cross-origin media and retain hide/restore evidence", async ({
  page,
}) => {
  const stage = await stageFixture(page);
  const mediaError = await page.locator("#media").evaluate((element) => {
    try {
      (element as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, 1, 1);
      return null;
    } catch (error) {
      return error instanceof DOMException ? error.name : String(error);
    }
  });
  expect(mediaError).toBe("SecurityError");
  expect(await annotationPaintedPixels(stage)).toBe(4 * 5);
  await page.locator("#annotation").evaluate((element) => {
    (element as HTMLCanvasElement).getContext("2d")!.clearRect(0, 0, 32, 32);
  });
  expect(await annotationPaintedPixels(stage)).toBe(0);
  await page.locator("#annotation").evaluate((element) => {
    (element as HTMLCanvasElement).getContext("2d")!.fillRect(2, 3, 4, 5);
  });
  expect(await annotationPaintedPixels(stage)).toBe(4 * 5);
});

test("missing annotation layers cannot pass as an empty rendering", async ({ page }) => {
  await page.setContent(
    '<div class="konvajs-content"><canvas width="32" height="32"></canvas></div>',
  );
  await expect(annotationPaintedPixels(page.locator("body"))).rejects.toThrow(
    "annotation canvas is not ready",
  );
});

test("tainted annotation layers still fail instead of silently returning zero", async ({
  page,
}) => {
  const stage = await stageFixture(page, "annotation");
  await expect(annotationPaintedPixels(stage)).rejects.toThrow(/tainted|cross-origin/);
});

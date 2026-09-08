import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type Konva from "konva";

const require = createRequire(import.meta.url);

test("canvas resize clears the previous viewport while keeping software WebGL available", async ({
  page,
}) => {
  await page.setContent('<div id="stage"></div>');
  await page.addScriptTag({ path: resolve(dirname(require.resolve("konva")), "../konva.js") });
  const pixels = await page.evaluate(async () => {
    const K = (window as unknown as { Konva: typeof Konva }).Konva;
    const stage = new K.Stage({
      container: "stage",
      width: 877,
      height: 720.5,
      x: 0,
      y: 113.59375,
      scaleX: 0.68515625,
      scaleY: 0.68515625,
    });
    const layer = new K.Layer();
    const group = new K.Group();
    layer.add(group);
    group.add(
      new K.Rect({
        x: 536,
        y: 345,
        width: 180,
        height: 194,
        stroke: "#00a455",
        fill: "rgba(0,164,85,0.12)",
        shadowColor: "#00a455",
        shadowBlur: 8,
        shadowOpacity: 0.4,
      }),
    );
    const label = new K.Label({ x: 536, y: 310 });
    label.add(new K.Tag({ fill: "#00a455", cornerRadius: 4 }));
    label.add(new K.Text({ text: "car", fill: "white", fontSize: 17.5, padding: 5.8 }));
    group.add(label);
    for (const [x, y] of [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1, 0.5],
      [1, 1],
      [0.5, 1],
      [0, 1],
      [0, 0.5],
    ]) {
      group.add(
        new K.Rect({
          x: 536 + x * 180 - 5.8,
          y: 345 + y * 194 - 5.8,
          width: 11.6,
          height: 11.6,
          fill: "white",
          stroke: "#00a455",
          strokeWidth: 2.2,
          cornerRadius: 2.9,
        }),
      );
    }
    stage.add(layer);
    stage.draw();
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 250));
    const alpha = (x: number, y: number) => layer.getContext().getImageData(x, y, 1, 1).data[3];
    await settle();
    stage.setAttrs({ width: 1398, x: 58.5555, y: 0, scaleX: 1.0006944, scaleY: 1.0006944 });
    await settle();
    stage.setAttrs({ width: 877, x: 0, y: 113.59375, scaleX: 0.68515625, scaleY: 0.68515625 });
    await settle();
    const restoredOld = alpha(670, 460);
    const restoredCurrent = alpha(400, 400);
    stage.destroy();

    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) throw new Error("Screenshot 3D scenes require software WebGL2");
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const webglPixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, webglPixel);
    return { restoredOld, restoredCurrent, webglPixel: [...webglPixel] };
  });
  expect(pixels.restoredOld).toBe(0);
  expect(pixels.restoredCurrent).toBeGreaterThan(20);
  expect(pixels.webglPixel).toEqual([255, 0, 0, 255]);
});

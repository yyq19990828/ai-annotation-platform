import assert from "node:assert/strict";
import test from "node:test";
import { encodeCocoRle } from "../../../src/pages/Workbench/stage/shared/geometry/maskRle.ts";
import {
  assertSamRecordingSavedGeometry,
  pickSamRecordingCandidate,
} from "./_sam-recording-candidates.ts";

const anchor = [0.4, 0.4, 0.6, 0.8] as const;
const car = { x: 0.4, y: 0.4, width: 0.2, height: 0.4 };
const rectangle = (value = car) => ({ type: "rectanglelabels", value });
const polygon = (points: number[][]) => ({ type: "polygonlabels", value: { points } });
const carPoints = [
  [0.4, 0.4],
  [0.6, 0.4],
  [0.6, 0.8],
  [0.4, 0.8],
];

function mask(x: number, y: number, width: number, height: number) {
  const pixels = new Uint8Array(100 * 100);
  for (let row = y; row < y + height; row += 1) {
    pixels.fill(1, row * 100 + x, row * 100 + x + width);
  }
  return { type: "mask", value: { rle: encodeCocoRle(pixels, 100, 100) } };
}

test("selects the whole-car Mask at original index 2 over a higher-scoring plate, another car and full image", () => {
  const selected = pickSamRecordingCandidate(
    [
      {
        ...mask(47, 70, 6, 2),
        score: 0.99,
        value: { ...mask(47, 70, 6, 2).value, preview: { points: carPoints } },
      },
      mask(10, 40, 20, 40),
      { ...mask(40, 40, 20, 40), score: 0.8, candidate_id: "whole-car" },
      mask(0, 0, 100, 100),
    ],
    anchor,
  );
  assert.equal(selected.index, 2);
  assert.equal(selected.candidate_id, "whole-car");
  assert.equal(selected.pixel_area, 800);
  assert.equal(selected.area, 0.08);
  assert.ok(Math.abs(selected.iou - 1) < 1e-9);
  assert.deepEqual(selected.bbox, { x: 0.4, y: 0.4, w: 0.2, h: 0.4 });
});

test("Mask area and bounds come from foreground, and digest agrees with the protocol golden value", () => {
  const selected = pickSamRecordingCandidate(
    [{ type: "mask", value: { rle: { encoding: "coco_rle", size: [2, 3], counts: [1, 2, 3] } } }],
    [0, 0, 2 / 3, 1],
  );
  assert.equal(selected.digest, "31aac8090eb25a3e167242e7304df317ca8793c84d5b7f3f4700844c6942f72b");
  assert.equal(selected.pixel_area, 2);
  assert.equal(selected.area, 1 / 3);
  assert.deepEqual(selected.bbox, { x: 0, y: 0, w: 2 / 3, h: 1 });
});

test("chooses the greatest IoU rather than the first adequate match", () => {
  const selected = pickSamRecordingCandidate(
    [rectangle({ ...car, width: 0.25 }), rectangle()],
    anchor,
  );
  assert.equal(selected.index, 1);
});

test("low overlap, plate-only, full-image and empty results fail instead of silently using index zero", () => {
  for (const result of [
    [],
    [mask(47, 70, 6, 2)],
    [mask(10, 40, 20, 40)],
    [mask(0, 0, 100, 100)],
    [rectangle({ ...car, x: 0.55 })],
  ]) {
    assert.throws(() => pickSamRecordingCandidate(result, anchor), /IoU >= 0.5/);
  }
  assert.throws(() => pickSamRecordingCandidate([mask(0, 0, 100, 100)], [0, 0, 1, 1]));
});

test("invalid candidates are excluded while the original transport index remains intact", () => {
  const selected = pickSamRecordingCandidate(
    [
      null,
      { type: "unknown", value: {} },
      { type: "mask", value: { rle: { encoding: "coco_rle", size: [10, 10], counts: [1, 2] } } },
      rectangle({ ...car, width: Number.NaN }),
      polygon([
        [0.4, 0.4],
        [0.5, 0.5],
      ]),
      rectangle(),
    ],
    anchor,
  );
  assert.equal(selected.index, 5);
  assert.throws(() => pickSamRecordingCandidate([rectangle()], [0.6, 0.4, 0.4, 0.8]));
});

test("saved native Mask must have the selected exact content digest and image dimensions", () => {
  const selected = pickSamRecordingCandidate([mask(40, 40, 20, 40)], anchor);
  assert.equal(selected.geometry.type, "raster_mask");
  if (selected.geometry.type !== "raster_mask") throw new Error("Expected Mask");
  const geometry = selected.geometry;
  assert.doesNotThrow(() =>
    assertSamRecordingSavedGeometry(
      { ...geometry, mask: { ...geometry.mask, uri: "masks/car" } },
      selected,
    ),
  );
  assert.throws(
    () =>
      assertSamRecordingSavedGeometry(
        { type: "raster_mask", mask: { ...geometry.mask, sha256: "0".repeat(64) } },
        selected,
      ),
    /digest/,
  );
  assert.throws(() =>
    assertSamRecordingSavedGeometry(
      { type: "raster_mask", mask: { ...geometry.mask, size: [50, 200] } },
      selected,
    ),
  );
  assert.throws(() =>
    assertSamRecordingSavedGeometry({ type: "bbox", ...selected.bbox }, selected),
  );
});

test("rectangle candidates save the exact normalized bbox", () => {
  const selected = pickSamRecordingCandidate([rectangle()], anchor);
  assert.ok(Math.abs(selected.area - 0.08) < 1e-9);
  assert.doesNotThrow(() =>
    assertSamRecordingSavedGeometry({ type: "bbox", ...selected.bbox }, selected),
  );
  assert.throws(() =>
    assertSamRecordingSavedGeometry({ type: "bbox", ...selected.bbox, w: 0.057 }, selected),
  );
});

test("polygon points must match even when a wrong shape shares the selected bbox", () => {
  const selected = pickSamRecordingCandidate([polygon(carPoints)], anchor);
  assert.ok(Math.abs(selected.area - 0.08) < 1e-9);
  assert.doesNotThrow(() =>
    assertSamRecordingSavedGeometry({ type: "polygon", points: carPoints }, selected),
  );
  assert.throws(() =>
    assertSamRecordingSavedGeometry(
      {
        type: "polygon",
        points: [
          [0.4, 0.4],
          [0.6, 0.5],
          [0.6, 0.8],
          [0.4, 0.8],
        ],
      },
      selected,
    ),
  );
  assert.throws(() =>
    assertSamRecordingSavedGeometry(
      { type: "polygon", points: carPoints, holes: [carPoints] },
      selected,
    ),
  );
});

test("polygon save verification follows primary-component selection and frontend simplification", () => {
  const points = [
    [0.4, 0.4],
    [0.5, 0.4],
    [0.6, 0.4],
    [0.6, 0.8],
    [0.4, 0.8],
  ];
  const selected = pickSamRecordingCandidate(
    [
      {
        type: "polygonlabels",
        value: {
          polygons: [
            {
              points: [
                [0.1, 0.1],
                [0.12, 0.1],
                [0.1, 0.12],
              ],
            },
            { points },
          ],
        },
      },
    ],
    anchor,
  );
  assert.equal(selected.geometry.type, "polygon");
  if (selected.geometry.type !== "polygon") throw new Error("Expected polygon");
  assert.ok(selected.geometry.points.length < points.length);
  assert.doesNotThrow(() => assertSamRecordingSavedGeometry(selected.geometry, selected));
  assert.throws(() => assertSamRecordingSavedGeometry({ type: "polygon", points }, selected));
});

test("Magic Box polygon conversion must be explicit and save its tight bbox", () => {
  const selected = pickSamRecordingCandidate([polygon(carPoints)], anchor);
  const saved = { type: "bbox", ...selected.bbox };
  assert.throws(() => assertSamRecordingSavedGeometry(saved, selected));
  assert.doesNotThrow(() =>
    assertSamRecordingSavedGeometry(saved, selected, { polygonAsBbox: true }),
  );
  assert.throws(() =>
    assertSamRecordingSavedGeometry({ ...saved, h: 0.013 }, selected, { polygonAsBbox: true }),
  );
});

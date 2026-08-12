import { describe, expect, it } from "vitest";
import {
  chooseImagePyramidLevel,
  imageTileDeviceBudget,
  imageTileGeometry,
  imageTilesForRect,
  parseImagePyramidManifest,
  singleImageFitsDecodedBudget,
  visibleImageRect,
  type ImagePyramidManifestV1,
} from "./imagePyramid";

const manifest: ImagePyramidManifestV1 = {
  schema: "aap-image-pyramid/v1",
  generation: 4,
  sourceFingerprint: "sha256:source",
  normalizationVersion: "exif-autorotate-srgb-v1",
  width: 1025,
  height: 513,
  tileSize: 512,
  overlap: 1,
  format: "webp",
  levels: [
    { level: 0, scaleFactor: 1, width: 1025, height: 513, columns: 3, rows: 2 },
    { level: 1, scaleFactor: 2, width: 513, height: 257, columns: 2, rows: 1 },
    { level: 2, scaleFactor: 4, width: 257, height: 129, columns: 1, rows: 1 },
    { level: 3, scaleFactor: 8, width: 129, height: 65, columns: 1, rows: 1 },
    { level: 4, scaleFactor: 16, width: 65, height: 33, columns: 1, rows: 1 },
    { level: 5, scaleFactor: 32, width: 33, height: 17, columns: 1, rows: 1 },
    { level: 6, scaleFactor: 64, width: 17, height: 9, columns: 1, rows: 1 },
    { level: 7, scaleFactor: 128, width: 9, height: 5, columns: 1, rows: 1 },
    { level: 8, scaleFactor: 256, width: 5, height: 3, columns: 1, rows: 1 },
    { level: 9, scaleFactor: 512, width: 3, height: 2, columns: 1, rows: 1 },
    { level: 10, scaleFactor: 1024, width: 2, height: 1, columns: 1, rows: 1 },
    { level: 11, scaleFactor: 2048, width: 1, height: 1, columns: 1, rows: 1 },
  ],
  overview: { width: 512, height: 256, contentDigest: "sha256:overview" },
};

describe("image pyramid geometry", () => {
  it("validates the full-resolution-first manifest", () => {
    expect(parseImagePyramidManifest(manifest)).toEqual(manifest);
    expect(() =>
      parseImagePyramidManifest({
        ...manifest,
        levels: [{ ...manifest.levels[0], width: 1024 }],
      }),
    ).toThrow("inconsistent image pyramid level");
  });

  it("returns a clamped integer half-open visible rect", () => {
    expect(
      visibleImageRect(
        { width: 800, height: 600 },
        { scale: 2, tx: -101.25, ty: -50.5 },
        { width: 1025, height: 513 },
        8,
      ),
    ).toEqual({ x: 46, y: 21, width: 409, height: 309 });
    expect(
      visibleImageRect(
        { width: 100, height: 100 },
        { scale: 1, tx: 200, ty: 200 },
        { width: 10, height: 10 },
      ),
    ).toBeNull();
  });

  it("keeps LOD inside hysteresis and otherwise chooses the coarsest safe level", () => {
    expect(chooseImagePyramidLevel(manifest, 0.5, 2, 0)).toBe(0);
    expect(chooseImagePyramidLevel(manifest, 0.25, 1, null)).toBe(2);
    expect(chooseImagePyramidLevel(manifest, 0.31, 1, 2)).toBe(2);
    expect(chooseImagePyramidLevel(manifest, 2, 2, 2)).toBe(0);
  });

  it("maps overlap crop and edge coverage without floating accumulation", () => {
    const center = imageTileGeometry("source", manifest, { level: 0, x: 1, y: 0 });
    expect(center.world).toEqual({ x: 512, y: 0, width: 512, height: 512 });
    expect(center.crop).toEqual({ x: 1, y: 0, width: 512, height: 512 });
    expect([center.decodedWidth, center.decodedHeight]).toEqual([514, 513]);

    const edge = imageTileGeometry("source", manifest, { level: 0, x: 2, y: 1 });
    expect(edge.world).toEqual({ x: 1024, y: 512, width: 1, height: 1 });
    expect(edge.crop).toEqual({ x: 1, y: 1, width: 1, height: 1 });
    expect([edge.decodedWidth, edge.decodedHeight]).toEqual([2, 2]);
  });

  it("enumerates visible and overscan coordinates within the grid", () => {
    expect(imageTilesForRect(manifest, 0, { x: 500, y: 10, width: 30, height: 30 }, 0)).toEqual([
      { level: 0, x: 0, y: 0 },
      { level: 0, x: 1, y: 0 },
    ]);
    expect(imageTilesForRect(manifest, 0, { x: 1024, y: 512, width: 1, height: 1 }, 1)).toEqual([
      { level: 0, x: 1, y: 0 },
      { level: 0, x: 2, y: 0 },
      { level: 0, x: 1, y: 1 },
      { level: 0, x: 2, y: 1 },
    ]);
  });

  it("freezes low, standard, and high decoded-byte tiers", () => {
    expect(imageTileDeviceBudget(2)).toMatchObject({
      retainedBytes: 32 * 1024 * 1024,
      concurrency: 2,
    });
    expect(imageTileDeviceBudget(4)).toMatchObject({
      retainedBytes: 64 * 1024 * 1024,
      concurrency: 4,
    });
    expect(imageTileDeviceBudget(8)).toMatchObject({
      retainedBytes: 128 * 1024 * 1024,
      concurrency: 6,
    });
    expect(singleImageFitsDecodedBudget(4096, 4096, 64 * 1024 * 1024)).toBe(true);
    expect(singleImageFitsDecodedBudget(8192, 8192, 128 * 1024 * 1024)).toBe(false);
  });
});

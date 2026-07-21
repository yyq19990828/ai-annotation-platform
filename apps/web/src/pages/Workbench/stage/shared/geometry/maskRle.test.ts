import { describe, expect, it } from "vitest";

import fixture from "@/__fixtures__/rasterMaskRle.json";
import {
  decodeCocoRle,
  encodeCocoRle,
  prepareCocoRleGzipUpload,
  validateCocoRle,
} from "./maskRle";

interface ValidCase {
  name: string;
  width: number;
  height: number;
  pixels_row_major: number[];
  counts: number[];
}

interface InvalidCase {
  name: string;
  size: number[];
  counts: unknown[];
}

describe("COCO uncompressed RLE", () => {
  for (const testCase of fixture.valid as ValidCase[]) {
    it(`round-trips ${testCase.name} in column-major order`, () => {
      const rle = encodeCocoRle(testCase.pixels_row_major, testCase.width, testCase.height);
      expect(rle.counts).toEqual(testCase.counts);
      expect(Array.from(decodeCocoRle(rle), (value) => (value ? 1 : 0))).toEqual(
        testCase.pixels_row_major,
      );
    });
  }

  for (const testCase of fixture.invalid as InvalidCase[]) {
    it(`rejects ${testCase.name}`, () => {
      expect(() => validateCocoRle({
        encoding: "coco_rle",
        size: testCase.size,
        counts: testCase.counts,
      })).toThrow();
    });
  }

  it("prepares HTTP gzip with a separate storage preference", async () => {
    let captured: Uint8Array | undefined;
    const prepared = await prepareCocoRleGzipUpload(
      { encoding: "coco_rle", size: [2, 3], counts: [1, 2, 2, 1] },
      {
        minBytes: 1,
        compress: async (raw) => {
          captured = raw;
          return new Uint8Array(Math.ceil(raw.byteLength / 2)).fill(1);
        },
      },
    );
    expect(prepared).not.toBeNull();
    expect(JSON.parse(new TextDecoder().decode(captured))).toMatchObject({
      encoding: "coco_rle",
      storage_encoding: "gzip",
    });
    expect(prepared?.body.type).toBe("application/json");
  });

  it("falls back when gzip would exceed the shared expansion ratio", async () => {
    const prepared = await prepareCocoRleGzipUpload(
      { encoding: "coco_rle", size: [2, 3], counts: [1, 2, 2, 1] },
      { minBytes: 1, compress: async () => new Uint8Array([1]) },
    );
    expect(prepared).toBeNull();
  });

  it("falls back when browser gzip compression fails", async () => {
    const prepared = await prepareCocoRleGzipUpload(
      { encoding: "coco_rle", size: [2, 3], counts: [1, 2, 2, 1] },
      {
        minBytes: 1,
        compress: async () => {
          throw new Error("compression failed");
        },
      },
    );
    expect(prepared).toBeNull();
  });

  it("keeps small payloads on the backward-compatible JSON path", async () => {
    let called = false;
    const prepared = await prepareCocoRleGzipUpload(
      { encoding: "coco_rle", size: [2, 3], counts: [1, 2, 2, 1] },
      {
        compress: async () => {
          called = true;
          return new Uint8Array([1]);
        },
      },
    );
    expect(prepared).toBeNull();
    expect(called).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import fixture from "@/__fixtures__/rasterMaskRle.json";
import { decodeCocoRle, encodeCocoRle, validateCocoRle } from "./maskRle";

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
});

import { describe, expect, it } from "vitest";
import { applyMaskMorphology } from "./geometry/maskOperations";
import {
  estimateRasterMaskPackedCpuBytes,
  squareDilatePackedXorDirect,
  squareDilatePackedXorSeparable,
  type RasterMaskPackedSquareDilateOptions,
} from "./rasterMaskPackedMorphology";

function packAlpha(alpha: Uint8Array, width: number, height: number): Uint32Array {
  const wordsPerRow = Math.ceil(width / 32);
  const words = new Uint32Array(wordsPerRow * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] === 0) continue;
      words[y * wordsPerRow + (x >>> 5)] |= (1 << (x & 31)) >>> 0;
    }
  }
  return words;
}

function expectedXorWords(
  alpha: Uint8Array,
  options: Omit<RasterMaskPackedSquareDilateOptions, "sourceWords" | "sourceWordsPerRow">,
): Uint32Array {
  const after = applyMaskMorphology(alpha, options.inputWidth, options.inputHeight, {
    operation: "dilate",
    kernelShape: "square",
    radius: options.radius,
  }).alpha;
  const wordsPerRow = Math.ceil(options.coreWidth / 32);
  const expected = new Uint32Array(wordsPerRow * options.coreHeight);
  for (let localY = 0; localY < options.coreHeight; localY += 1) {
    for (let localX = 0; localX < options.coreWidth; localX += 1) {
      const x = options.coreOffsetX + localX;
      const y = options.coreOffsetY + localY;
      const index = y * options.inputWidth + x;
      if ((alpha[index] !== 0) === (after[index] !== 0)) continue;
      expected[localY * wordsPerRow + (localX >>> 5)] |= (1 << (localX & 31)) >>> 0;
    }
  }
  return expected;
}

function verifyCase(
  alpha: Uint8Array,
  options: Omit<RasterMaskPackedSquareDilateOptions, "sourceWords" | "sourceWordsPerRow">,
): void {
  const request = {
    ...options,
    sourceWords: packAlpha(alpha, options.inputWidth, options.inputHeight),
    sourceWordsPerRow: Math.ceil(options.inputWidth / 32),
  };
  const expected = expectedXorWords(alpha, options);
  const direct = squareDilatePackedXorDirect(request);
  const separable = squareDilatePackedXorSeparable(request);
  expect(direct.xorWords).toEqual(expected);
  expect(separable.xorWords).toEqual(expected);
  expect(separable.xorWords).toEqual(direct.xorWords);
  expect(separable.intermediateBytes).toBe(
    Math.ceil(options.coreWidth / 32) * options.inputHeight * 4,
  );
}

describe("packed square dilation XOR", () => {
  it("matches the dense oracle at image edges and 32-bit boundaries", () => {
    const width = 97;
    const height = 67;
    const alpha = new Uint8Array(width * height);
    for (const [x, y] of [
      [0, 0],
      [31, 1],
      [32, 2],
      [63, 33],
      [64, 34],
      [96, 66],
      [47, 21],
    ]) {
      alpha[y * width + x] = 255;
    }
    verifyCase(alpha, {
      inputWidth: width,
      inputHeight: height,
      coreOffsetX: 0,
      coreOffsetY: 0,
      coreWidth: width,
      coreHeight: height,
      radius: 31,
    });
  });

  it("matches the dense oracle for an unaligned clipped core", () => {
    const width = 111;
    const height = 83;
    const alpha = new Uint8Array(width * height);
    for (let y = 3; y < 77; y += 7) {
      for (let x = 5; x < 106; x += 11) alpha[y * width + x] = 255;
    }
    verifyCase(alpha, {
      inputWidth: width,
      inputHeight: height,
      coreOffsetX: 13,
      coreOffsetY: 9,
      coreWidth: 65,
      coreHeight: 57,
      radius: 8,
    });
  });

  it("passes randomized differential coverage for origin, width, radius, edge and tail", () => {
    let seed = 0x23_21_07_31;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const inputWidth = 1 + Math.floor(random() * 127);
      const inputHeight = 1 + Math.floor(random() * 95);
      const coreOffsetX = Math.floor(random() * inputWidth);
      const coreOffsetY = Math.floor(random() * inputHeight);
      const coreWidth = 1 + Math.floor(random() * (inputWidth - coreOffsetX));
      const coreHeight = 1 + Math.floor(random() * (inputHeight - coreOffsetY));
      const radius = 1 + Math.floor(random() * 31);
      const alpha = new Uint8Array(inputWidth * inputHeight);
      for (let index = 0; index < alpha.length; index += 1) {
        if (random() < 0.16) alpha[index] = 255;
      }
      verifyCase(alpha, {
        inputWidth,
        inputHeight,
        coreOffsetX,
        coreOffsetY,
        coreWidth,
        coreHeight,
        radius,
      });
    }
  });

  it("returns zero change for a full foreground plane", () => {
    const inputWidth = 33;
    const inputHeight = 5;
    const alpha = new Uint8Array(inputWidth * inputHeight).fill(255);
    verifyCase(alpha, {
      inputWidth,
      inputHeight,
      coreOffsetX: 0,
      coreOffsetY: 0,
      coreWidth: inputWidth,
      coreHeight: inputHeight,
      radius: 1,
    });
    const result = squareDilatePackedXorSeparable({
      sourceWords: packAlpha(alpha, inputWidth, inputHeight),
      sourceWordsPerRow: 2,
      inputWidth,
      inputHeight,
      coreOffsetX: 0,
      coreOffsetY: 0,
      coreWidth: inputWidth,
      coreHeight: inputHeight,
      radius: 1,
    });
    expect([...result.xorWords]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("accounts source, intermediate, XOR and worst-case patch bytes", () => {
    expect(
      estimateRasterMaskPackedCpuBytes({
        inputWidth: 65,
        inputHeight: 5,
        coreWidth: 33,
        coreHeight: 3,
        sourceChargeBytes: 128,
        baseCacheRetainedBytes: 256,
      }),
    ).toEqual({
      sourceChargeBytes: 128,
      baseCacheRetainedBytes: 256,
      horizontalIntermediateBytes: 40,
      xorOutputBytes: 24,
      patchUpperBoundBytes: 13,
      requiredBytes: 461,
    });
  });

  it("rejects malformed planes and out-of-range cores", () => {
    expect(() =>
      squareDilatePackedXorSeparable({
        sourceWords: new Uint32Array(1),
        sourceWordsPerRow: 1,
        inputWidth: 32,
        inputHeight: 1,
        coreOffsetX: 16,
        coreOffsetY: 0,
        coreWidth: 32,
        coreHeight: 1,
        radius: 1,
      }),
    ).toThrow(/outside the input plane/);
  });
});

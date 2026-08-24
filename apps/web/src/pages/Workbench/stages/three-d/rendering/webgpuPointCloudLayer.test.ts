import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createWebGpuPointCloudLayer } from "./webgpuPointCloudLayer";

describe("webgpuPointCloudLayer", () => {
  it("creates one sprite instance per point and keeps selection separate from color", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 2, 2, 2], 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 0, 1, 0, 0], 3),
    );
    const originalColors = Array.from(geometry.getAttribute("color").array);

    const layer = createWebGpuPointCloudLayer(geometry, {
      pointSize: 0.06,
      sizeAttenuation: true,
      selection: true,
    });
    expect((layer.object as THREE.Sprite).count).toBe(3);
    expect(geometry.getAttribute("position")).toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect(geometry.getAttribute("color")).toBeInstanceOf(THREE.InstancedBufferAttribute);

    layer.setSelection([2], 2);
    expect(Array.from(geometry.getAttribute("pointSelection").array)).toEqual([0, 1, 0]);
    expect(Array.from(geometry.getAttribute("color").array)).toEqual(originalColors);

    expect(
      layer.updatePointData(
        new Float32Array([3, 3, 3, 4, 4, 4]),
        new Float32Array([1, 1, 0, 0, 1, 1]),
      ),
    ).toBe(true);
    expect((layer.object as THREE.Sprite).count).toBe(2);
    expect(geometry.drawRange.count).toBe(2);
    expect(Array.from(geometry.getAttribute("position").array).slice(0, 6)).toEqual([
      3, 3, 3, 4, 4, 4,
    ]);
    layer.setPointCount(0);
    expect((layer.object as THREE.Sprite).count).toBe(0);

    const imageTexture = new THREE.DataTexture(
      new Uint8Array([255, 0, 0, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    const depthTexture = new THREE.DataTexture(
      new Float32Array([1]),
      1,
      1,
      THREE.RedFormat,
      THREE.FloatType,
    );
    const material = (layer.object as THREE.Sprite).material;
    const baseNode = (material as unknown as { colorNode: unknown }).colorNode;
    const materialVersion = material.version;
    layer.setCameraColorization([
      {
        texture: imageTexture,
        depthTexture,
        calibration: {
          extrinsic: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          intrinsic: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        },
        width: 1,
        height: 1,
      },
    ]);
    expect((material as unknown as { colorNode: unknown }).colorNode).toBe(baseNode);
    expect(material.version).toBe(materialVersion);
    expect(layer.updatePointData(new Float32Array(12), new Float32Array(12))).toBe(false);
    layer.setColorAdjust({ contrast: 1.1, brightness: 0.1, gamma: 1.2 });
    layer.setCameraColorization(null);

    layer.dispose();
    imageTexture.dispose();
    depthTexture.dispose();
    geometry.dispose();
  });
});

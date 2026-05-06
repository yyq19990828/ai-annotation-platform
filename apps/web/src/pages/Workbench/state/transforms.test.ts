/**
 * v0.8.3 · transforms 单测：bbox / polygon 几何转换 + AnnotationResponse / Prediction 映射。
 */
import { describe, it, expect } from "vitest";
import {
  bboxGeom,
  polygonGeom,
  polygonBounds,
  geometryToShape,
  annotationToBox,
  predictionsToBoxes,
} from "./transforms";

describe("bboxGeom / polygonGeom", () => {
  it("bboxGeom 包装", () => {
    const g = bboxGeom({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect(g).toEqual({ type: "bbox", x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });
  it("polygonGeom 包装", () => {
    const g = polygonGeom([
      [0, 0],
      [1, 0],
      [0.5, 1],
    ]);
    expect(g.type).toBe("polygon");
    expect(g.points).toHaveLength(3);
  });
});

describe("polygonBounds", () => {
  it("空数组 → 全 0", () => {
    expect(polygonBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
  it("三角形包围盒", () => {
    const b = polygonBounds([
      [0.1, 0.2],
      [0.9, 0.3],
      [0.5, 0.8],
    ]);
    expect(b.x).toBeCloseTo(0.1);
    expect(b.y).toBeCloseTo(0.2);
    expect(b.w).toBeCloseTo(0.8);
    expect(b.h).toBeCloseTo(0.6);
  });
});

describe("geometryToShape", () => {
  it("polygon → 含 polygon 字段 + bounds", () => {
    const s = geometryToShape({
      type: "polygon",
      points: [
        [0, 0],
        [1, 0],
        [0.5, 1],
      ],
    });
    expect(s.x).toBe(0);
    expect(s.w).toBe(1);
    expect(s.polygon).toHaveLength(3);
  });
  it("bbox → 不含 polygon 字段", () => {
    const s = geometryToShape({ type: "bbox", x: 0, y: 0, w: 1, h: 1 });
    expect(s).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect((s as { polygon?: unknown }).polygon).toBeUndefined();
  });
});

describe("annotationToBox", () => {
  it("映射常规字段", () => {
    const ann = {
      id: "a1",
      geometry: { type: "bbox", x: 0, y: 0, w: 0.5, h: 0.5 },
      class_name: "car",
      confidence: 0.9,
      source: "manual",
    } as any;
    const box = annotationToBox(ann);
    expect(box.id).toBe("a1");
    expect(box.cls).toBe("car");
    expect(box.conf).toBe(0.9);
    expect(box.w).toBe(0.5);
  });

  it("无 confidence → 默认 1", () => {
    const ann = {
      id: "a2",
      geometry: { type: "bbox", x: 0, y: 0, w: 1, h: 1 },
      class_name: "person",
      source: "manual",
    } as any;
    expect(annotationToBox(ann).conf).toBe(1);
  });
});

describe("predictionsToBoxes", () => {
  it("flatten predictions.result 到 AiBox 列表", () => {
    const preds = [
      {
        id: "p1",
        result: [
          {
            geometry: { type: "bbox", x: 0, y: 0, w: 1, h: 1 },
            class_name: "car",
            confidence: 0.8,
          },
          {
            geometry: { type: "bbox", x: 1, y: 1, w: 1, h: 1 },
            class_name: "person",
            confidence: 0.7,
          },
        ],
      },
    ] as any;
    const boxes = predictionsToBoxes(preds);
    expect(boxes).toHaveLength(2);
    expect(boxes[0].id).toBe("pred-p1-0");
    expect(boxes[0].predictionId).toBe("p1");
    expect(boxes[0].source).toBe("prediction_based");
  });
});

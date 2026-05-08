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

/**
 * v0.9.8 · predictionsToBoxes 黄金样本 — 锁定后端 to_internal_shape 写入 DB 后
 * 前端消费契约. 后端 PredictionService 负责 LabelStudio 标准 → 内部 shape 的
 * 转换 (apps/api/app/services/prediction.py to_internal_shape), 这里假设输入
 * 已是内部 shape, 覆盖空 / 多 / polygon / 缺字段 4 类边界.
 */
describe("predictionsToBoxes 黄金样本 (v0.9.8 schema 边界)", () => {
  it("空 result 数组 → 空 box 列表", () => {
    const preds = [{ id: "empty", result: [] }] as any;
    expect(predictionsToBoxes(preds)).toEqual([]);
  });

  it("多 prediction 行 + 多 shape, id 含 prediction id 与索引", () => {
    const preds = [
      {
        id: "p-a",
        result: [
          { geometry: { type: "bbox", x: 0, y: 0, w: 0.1, h: 0.1 }, class_name: "car", confidence: 0.9 },
          { geometry: { type: "bbox", x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, class_name: "person", confidence: 0.8 },
        ],
      },
      {
        id: "p-b",
        result: [
          { geometry: { type: "bbox", x: 0.3, y: 0.3, w: 0.1, h: 0.1 }, class_name: "dog", confidence: 0.7 },
        ],
      },
    ] as any;
    const boxes = predictionsToBoxes(preds);
    expect(boxes).toHaveLength(3);
    const ids = boxes.map((b) => b.id);
    expect(ids).toEqual(["pred-p-a-0", "pred-p-a-1", "pred-p-b-0"]);
    expect(boxes.every((b) => b.source === "prediction_based")).toBe(true);
  });

  it("polygon 几何 → polygon 字段保留, x/w 来自 bounds", () => {
    const preds = [
      {
        id: "p-poly",
        result: [
          {
            geometry: {
              type: "polygon",
              points: [
                [0.2, 0.2],
                [0.8, 0.3],
                [0.5, 0.9],
              ],
            },
            class_name: "leaf",
            confidence: 0.85,
          },
        ],
      },
    ] as any;
    const boxes = predictionsToBoxes(preds);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].polygon).toHaveLength(3);
    expect(boxes[0].x).toBeCloseTo(0.2);
    expect(boxes[0].w).toBeCloseTo(0.6);
  });

  it("confidence=0 不被视为缺失 (pass-through)", () => {
    const preds = [
      {
        id: "p-zero",
        result: [
          { geometry: { type: "bbox", x: 0, y: 0, w: 1, h: 1 }, class_name: "x", confidence: 0 },
        ],
      },
    ] as any;
    const [b] = predictionsToBoxes(preds);
    expect(b.conf).toBe(0);
  });

  it("class_name 空字符串 (alias 缺失场景) 不抛错, 落到 cls=''", () => {
    const preds = [
      {
        id: "p-empty-cls",
        result: [
          { geometry: { type: "bbox", x: 0, y: 0, w: 1, h: 1 }, class_name: "", confidence: 0.5 },
        ],
      },
    ] as any;
    const [b] = predictionsToBoxes(preds);
    expect(b.cls).toBe("");
  });
});

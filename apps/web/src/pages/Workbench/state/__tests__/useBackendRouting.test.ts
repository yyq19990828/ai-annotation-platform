/**
 * v0.14.18 · useBackendRouting 纯路由逻辑单测.
 * 覆盖: capIndex 构建 (多 model / 单 model / 文本能力 / tracker) · resolveInteractive 三情形 ·
 * 兜底链 (preferred → 项目默认 → 注册序) · reachable 降级 · pickDefaultPreferred。
 */
import { describe, it, expect } from "vitest";
import type { MLBackendCapability } from "@/api/ml-backends";
import {
  buildCapEntry,
  candidatesFor,
  resolveInteractive,
  pickDefaultPreferred,
  capFingerprint,
  type CapIndex,
} from "../useBackendRouting";

// gsam2 协议 2.1: 4 个 task model, 仅 interactive_seg 交互 (point/bbox); detection/seg 带 text。
const GSAM2: MLBackendCapability = {
  name: "grounded-sam2",
  supported_prompts: ["point", "bbox", "text"],
  models: [
    { id: "det", task: "detection", is_interactive: false, supported_prompts: ["text"] },
    { id: "seg", task: "segmentation", is_interactive: false, supported_prompts: ["text"] },
    {
      id: "iseg",
      task: "interactive_seg",
      is_interactive: true,
      supported_prompts: ["point", "bbox"],
    },
    {
      id: "trk",
      task: "tracker",
      is_interactive: true,
      supported_prompts: ["bbox"],
      supported_trackers: ["sam2_video"],
    },
  ],
};

// yolo: 闭集几何, 无 prompt, 非交互。
const YOLO: MLBackendCapability = {
  name: "yolo",
  supported_prompts: ["none"],
  models: [{ id: "y-det", task: "detection", is_interactive: false, supported_prompts: ["none"] }],
};

// sam3: 老式单 model 后端 (无 models[]), 顶层 bbox/text/exemplar 交互。
const SAM3: MLBackendCapability = {
  name: "sam3",
  is_interactive: true,
  supported_prompts: ["bbox", "text", "exemplar"],
};

describe("buildCapEntry", () => {
  it("gsam2: 交互 prompt 仅取 is_interactive model 的并集 (point/bbox), text 来自非交互 model", () => {
    const e = buildCapEntry(GSAM2);
    expect([...e.prompts].sort()).toEqual(["bbox", "point"]);
    expect(e.prompts.has("exemplar")).toBe(false);
    expect(e.textCapable).toBe(true);
    expect(e.isInteractive).toBe(true);
    expect(e.trackers).toEqual(["sam2_video"]);
    expect(e.reachable).toBe(true);
  });

  it("yolo: 无交互 prompt, 非交互, 无文本", () => {
    const e = buildCapEntry(YOLO);
    expect(e.prompts.size).toBe(0);
    expect(e.textCapable).toBe(false);
    expect(e.isInteractive).toBe(false);
  });

  it("sam3: 老式单 model 走顶层字段, 交互 prompt = bbox/exemplar (text 归批量)", () => {
    const e = buildCapEntry(SAM3);
    expect([...e.prompts].sort()).toEqual(["bbox", "exemplar"]);
    expect(e.textCapable).toBe(true);
    expect(e.isInteractive).toBe(true);
  });

  it("undefined (拉取失败): reachable=false, 全空", () => {
    const e = buildCapEntry(undefined);
    expect(e.reachable).toBe(false);
    expect(e.prompts.size).toBe(0);
    expect(e.isInteractive).toBe(false);
  });
});

function mkIndex(entries: Record<string, MLBackendCapability | undefined>): CapIndex {
  const idx: CapIndex = {};
  for (const [id, cap] of Object.entries(entries)) idx[id] = buildCapEntry(cap);
  return idx;
}

describe("candidatesFor", () => {
  it("按注册序返回 reachable 且支持该 prompt 的后端", () => {
    const idx = mkIndex({ yolo: YOLO, gsam2: GSAM2, sam3: SAM3 });
    const order = ["yolo", "gsam2", "sam3"];
    expect(candidatesFor(idx, order, "point")).toEqual(["gsam2"]);
    expect(candidatesFor(idx, order, "bbox")).toEqual(["gsam2", "sam3"]);
    expect(candidatesFor(idx, order, "exemplar")).toEqual(["sam3"]);
  });
});

describe("resolveInteractive — 三情形 + 兜底链", () => {
  it("情形1 只1个交互后端: 全部路由到它", () => {
    const idx = mkIndex({ yolo: YOLO, gsam2: GSAM2 });
    const order = ["yolo", "gsam2"];
    // 项目默认 = yolo (非交互), preferred 缺省
    expect(resolveInteractive(idx, order, "yolo", null, "point")).toBe("gsam2");
    expect(resolveInteractive(idx, order, "yolo", null, "bbox")).toBe("gsam2");
    // exemplar 无候选 → null (工具置灰)
    expect(resolveInteractive(idx, order, "yolo", null, "exemplar")).toBeNull();
  });

  it("情形2 两个都支持 bbox: preferred 优先, 缺省回落项目默认", () => {
    const idx = mkIndex({ gsam2: GSAM2, sam3: SAM3 });
    const order = ["gsam2", "sam3"];
    // 项目默认 = gsam2, 无 preferred → 默认优先
    expect(resolveInteractive(idx, order, "gsam2", null, "bbox")).toBe("gsam2");
    // 用户 preferred = sam3 → 覆盖默认 (关键: 默认本身交互时选择器仍生效)
    expect(resolveInteractive(idx, order, "gsam2", "sam3", "bbox")).toBe("sam3");
  });

  it("情形3 异构 A只point B只bbox: 自动分流", () => {
    const A: MLBackendCapability = {
      name: "A",
      supported_prompts: ["point"],
      models: [{ id: "a", is_interactive: true, supported_prompts: ["point"] }],
    };
    const B: MLBackendCapability = {
      name: "B",
      supported_prompts: ["bbox"],
      models: [{ id: "b", is_interactive: true, supported_prompts: ["bbox"] }],
    };
    const idx = mkIndex({ A, B });
    const order = ["A", "B"];
    // preferred=A 但 bbox 不被 A 支持 → 按兜底链落到 B
    expect(resolveInteractive(idx, order, null, "A", "point")).toBe("A");
    expect(resolveInteractive(idx, order, null, "A", "bbox")).toBe("B");
  });

  it("兜底链: preferred 不在候选 → 项目默认 → 注册序第一个", () => {
    const idx = mkIndex({ gsam2: GSAM2, sam3: SAM3 });
    const order = ["gsam2", "sam3"];
    // preferred=不存在的id, 默认=sam3 (候选) → 用默认
    expect(resolveInteractive(idx, order, "sam3", "ghost", "bbox")).toBe("sam3");
    // preferred 和默认都不在候选 → 注册序第一个 (gsam2)
    expect(resolveInteractive(idx, order, "ghost", "ghost2", "bbox")).toBe("gsam2");
  });

  it("reachable 降级: 候选后端 /setup 失败 → 从候选排除", () => {
    const idx = mkIndex({ gsam2: undefined, sam3: SAM3 }); // gsam2 拉取失败
    const order = ["gsam2", "sam3"];
    expect(candidatesFor(idx, order, "bbox")).toEqual(["sam3"]);
    expect(resolveInteractive(idx, order, "gsam2", "gsam2", "bbox")).toBe("sam3");
    // point 仅 gsam2 支持但已不可达 → null
    expect(resolveInteractive(idx, order, "gsam2", null, "point")).toBeNull();
  });
});

describe("pickDefaultPreferred", () => {
  it("项目默认是交互后端 → 取它", () => {
    const idx = mkIndex({ yolo: YOLO, gsam2: GSAM2 });
    expect(pickDefaultPreferred(idx, ["yolo", "gsam2"], "gsam2")).toBe("gsam2");
  });
  it("项目默认非交互 (yolo) → 取第一个交互后端", () => {
    const idx = mkIndex({ yolo: YOLO, gsam2: GSAM2 });
    expect(pickDefaultPreferred(idx, ["yolo", "gsam2"], "yolo")).toBe("gsam2");
  });
  it("无交互后端 → null", () => {
    const idx = mkIndex({ yolo: YOLO });
    expect(pickDefaultPreferred(idx, ["yolo"], "yolo")).toBeNull();
  });
});

describe("capFingerprint — capSignature 内容变化感知", () => {
  it("undefined → 空串", () => {
    expect(capFingerprint(undefined)).toBe("");
  });
  it("同内容稳定 (两次 ok 之间不变 → 不触发多余重建)", () => {
    expect(capFingerprint(GSAM2)).toBe(capFingerprint(GSAM2));
    expect(capFingerprint(SAM3)).toBe(capFingerprint(SAM3));
  });
  it("supported_prompts 变化 → 指纹变化 (动态宣称能力可被感知)", () => {
    const sam3NoExemplar: MLBackendCapability = {
      ...SAM3,
      supported_prompts: ["bbox", "text"],
    };
    expect(capFingerprint(sam3NoExemplar)).not.toBe(capFingerprint(SAM3));
  });
  it("多 model 后端某 model 的 prompt 变化 → 指纹变化", () => {
    const gsam2More: MLBackendCapability = {
      ...GSAM2,
      models: GSAM2.models!.map((m) =>
        m.id === "iseg" ? { ...m, supported_prompts: ["point", "bbox", "exemplar"] } : m,
      ),
    };
    expect(capFingerprint(gsam2More)).not.toBe(capFingerprint(GSAM2));
  });
  it("tracker 变化 → 指纹变化", () => {
    const sam3Trk: MLBackendCapability = { ...SAM3, supported_trackers: ["sam2_video"] };
    expect(capFingerprint(sam3Trk)).not.toBe(capFingerprint(SAM3));
  });
});

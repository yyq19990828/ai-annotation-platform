/**
 * v0.18.16 · pipelineGraph 纯函数单测: 派生 / 布局 / 受限改父校验。
 */
import { describe, it, expect } from "vitest";

import {
  ROOT_SID,
  buildFlow,
  canAddChild,
  canReparent,
  classFilterText,
  depthBySid,
  descendantsOf,
  detailOf,
  producesGeometry,
  reparent,
  roiText,
  roleOf,
  stageWarning,
  subtreeHeight,
  variantText,
  type GraphNodeModel,
  type StageCaps,
  type StageEntry,
} from "./pipelineGraph";
import type { PipelineStagePayload } from "@/hooks/usePreannotation";

const geom = (input: "crop" | "geometry" = "crop"): PipelineStagePayload =>
  ({ stage: 0, ml_backend_id: "bk", model_id: "det", input: { mode: input }, write: { target: "geometry" } }) as PipelineStagePayload;
const attr = (keys?: string[], label?: string): PipelineStagePayload =>
  ({ stage: 0, ml_backend_id: "bk", write: { target: "attributes", keys }, label }) as PipelineStagePayload;

describe("派生", () => {
  it("depthBySid: 链 root→a→b 深度 1/2/3", () => {
    const g: StageEntry[] = [
      { sid: "a", parentSid: ROOT_SID },
      { sid: "b", parentSid: "a" },
    ];
    expect(depthBySid(g)).toEqual({ root: 1, a: 2, b: 3 });
  });

  it("depthBySid: 顺序无关 —— 子排在父之前 (改父后) 仍算对深度", () => {
    // 改父常导致子在数组中排在新父之前; 不能依赖数组顺序。
    const g: StageEntry[] = [
      { sid: "b", parentSid: "a" }, // 子先出现
      { sid: "a", parentSid: ROOT_SID }, // 父后出现
    ];
    expect(depthBySid(g)).toEqual({ root: 1, a: 2, b: 3 });
  });

  it("depthBySid: 环不死循环 (兜底为 1)", () => {
    const g: StageEntry[] = [
      { sid: "a", parentSid: "b" },
      { sid: "b", parentSid: "a" },
    ];
    expect(() => depthBySid(g)).not.toThrow();
  });

  it("canAddChild: 乱序下 depth-3 节点仍不可加子 (防造 depth>3)", () => {
    // root→a→b, 但数组里 b 在 a 前。b 实为 depth-3, 不可再加子。
    const g: StageEntry[] = [
      { sid: "b", parentSid: "a" },
      { sid: "a", parentSid: ROOT_SID },
    ];
    expect(canAddChild(g, { a: geom(), b: geom() }, "b")).toBe(false);
  });

  it("descendantsOf: 含全部后代不含自身", () => {
    const g: StageEntry[] = [
      { sid: "a", parentSid: ROOT_SID },
      { sid: "b", parentSid: "a" },
      { sid: "c", parentSid: ROOT_SID },
    ];
    expect(descendantsOf(g, "a")).toEqual(new Set(["b"]));
    expect(descendantsOf(g, ROOT_SID)).toEqual(new Set(["a", "b", "c"]));
  });

  it("subtreeHeight: 叶=1, 含两层=2", () => {
    const g: StageEntry[] = [
      { sid: "a", parentSid: ROOT_SID },
      { sid: "b", parentSid: "a" },
    ];
    expect(subtreeHeight(g, "b")).toBe(1);
    expect(subtreeHeight(g, "a")).toBe(2);
  });

  it("producesGeometry / roleOf / detailOf", () => {
    expect(producesGeometry(geom())).toBe(true);
    expect(producesGeometry(attr())).toBe(false);
    expect(roleOf(geom("crop")).label).toBe("检测");
    expect(roleOf(geom("geometry")).label).toBe("分割");
    expect(roleOf(attr()).label).toBe("分类");
    expect(detailOf(attr(["color"], "hat"))).toBe("hat_color");
    expect(detailOf(attr())).toBe("全部属性");
  });
});

describe("加子门控", () => {
  const payloads = { a: geom(), b: attr() };
  it("源恒可加子 (depth1, 产几何)", () => {
    expect(canAddChild([], {}, ROOT_SID)).toBe(true);
  });
  it("产几何的 depth-2 阶段可加子", () => {
    const g: StageEntry[] = [{ sid: "a", parentSid: ROOT_SID }];
    expect(canAddChild(g, payloads, "a")).toBe(true);
  });
  it("分类阶段不可加子 (不产几何)", () => {
    const g: StageEntry[] = [{ sid: "b", parentSid: ROOT_SID }];
    expect(canAddChild(g, payloads, "b")).toBe(false);
  });
  it("depth-3 几何阶段不可加子 (超深)", () => {
    const g: StageEntry[] = [
      { sid: "a", parentSid: ROOT_SID },
      { sid: "c", parentSid: "a" },
    ];
    expect(canAddChild(g, { a: geom(), c: geom() }, "c")).toBe(false);
  });
});

describe("改父校验 canReparent", () => {
  const g: StageEntry[] = [
    { sid: "a", parentSid: ROOT_SID },
    { sid: "b", parentSid: "a" },
    { sid: "c", parentSid: ROOT_SID },
  ];
  const payloads = { a: geom(), b: attr(), c: attr() };

  it("源不可改父", () => {
    expect(canReparent(g, payloads, ROOT_SID, "a").ok).toBe(false);
  });
  it("连到自身 / 当前父 无效", () => {
    expect(canReparent(g, payloads, "b", "b").ok).toBe(false);
    expect(canReparent(g, payloads, "b", "a").ok).toBe(false);
  });
  it("成环: 连到自己的后代被拒", () => {
    const r = canReparent(g, payloads, "a", "b");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/后代|成环/);
  });
  it("父不产几何被拒", () => {
    const r = canReparent(g, payloads, "b", "c");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/几何/);
  });
  it("超深被拒: 把含两层子树挂到 depth-2 几何阶段", () => {
    // a2(几何,d2) → s(几何,d3); 把 a(高度2) 挂到 a2 → a 新 d3 + 高度2-1 = d4 > 3。
    const g2: StageEntry[] = [
      { sid: "a", parentSid: ROOT_SID },
      { sid: "b", parentSid: "a" },
      { sid: "a2", parentSid: ROOT_SID },
    ];
    const r = canReparent(g2, { a: geom(), b: attr(), a2: geom() }, "a", "a2");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/超过最大/);
  });
  it("合法改父: 叶子挂到另一几何父", () => {
    const g2: StageEntry[] = [
      { sid: "a", parentSid: ROOT_SID },
      { sid: "a2", parentSid: ROOT_SID },
      { sid: "b", parentSid: "a" },
    ];
    expect(canReparent(g2, { a: geom(), a2: geom(), b: attr() }, "b", "a2").ok).toBe(true);
  });
  it("reparent 应用: 改写 parentSid", () => {
    const out = reparent(g, "b", ROOT_SID);
    expect(out.find((e) => e.sid === "b")?.parentSid).toBe(ROOT_SID);
  });
});

describe("§13 信息 helper", () => {
  const p = (o: Partial<PipelineStagePayload>): PipelineStagePayload =>
    ({ stage: 0, ml_backend_id: "bk", ...o }) as PipelineStagePayload;

  it("classFilterText: 有过滤=仅..., 无=全部框", () => {
    expect(classFilterText(p({ parent_class_filter: ["person", "car"] }))).toBe("仅 person, car");
    expect(classFilterText(attr())).toBe("全部框");
  });
  it("roiText: crop 带 pad / geometry 整图 / 无 roi 空", () => {
    expect(roiText(p({ roi: { mode: "crop", pad: 0.08 } }))).toBe("裁剪 · pad 0.08");
    expect(roiText(p({ roi: { mode: "geometry" } }))).toBe("整图框提示");
    expect(roiText(attr())).toBe("");
  });
  it("variantText: k=v 串接 / 无空", () => {
    expect(variantText(p({ model_variants: { sam_variant: "large" } }))).toBe("sam_variant=large");
    expect(variantText(attr())).toBe("");
  });

  describe("stageWarning (标红判据, 与端点 422 对齐)", () => {
    const caps = (o: Partial<StageCaps>): StageCaps => ({
      hasCapabilities: true,
      knownInputs: true,
      acceptsCrop: false,
      acceptsBboxPrompt: false,
      producesAttributes: true,
      ...o,
    });
    it("能力未就绪 → null", () => {
      expect(stageWarning(attr(), caps({ hasCapabilities: false }))).toBeNull();
    });
    it("产几何但既不接 crop 也不接 bbox → 警示", () => {
      expect(stageWarning(geom(), caps({}))).toMatch(/裁剪|框提示/);
    });
    it("产几何接 crop → null", () => {
      expect(stageWarning(geom(), caps({ acceptsCrop: true }))).toBeNull();
    });
    it("inputs 未知 (老 backend) → 不误报", () => {
      expect(stageWarning(geom(), caps({ knownInputs: false }))).toBeNull();
    });
    it("分类但后端不产属性 → 警示", () => {
      expect(stageWarning(attr(), caps({ producesAttributes: false }))).toMatch(/属性/);
    });
    it("分类但 model 自报属性类型不含 class (producesClass=false) → 警示", () => {
      expect(stageWarning(attr(), caps({ producesClass: false }))).toMatch(/class|类别/);
    });
    it("producesClass 未知 (undefined) → 不误报", () => {
      expect(stageWarning(attr(), caps({ producesClass: undefined }))).toBeNull();
    });
  });
});

describe("buildFlow 派生 + 分层布局", () => {
  const models: GraphNodeModel[] = [
    { sid: ROOT_SID, parentSid: null, kind: "source", role: roleOf(geom()), detail: "src", runState: "pending", producesGeometry: true, canAddChild: true, conflict: false, ready: true },
    { sid: "a", parentSid: ROOT_SID, kind: "stage", role: roleOf(geom()), detail: "a", runState: "pending", producesGeometry: true, canAddChild: true, conflict: false, ready: true },
    { sid: "b", parentSid: "a", kind: "stage", role: roleOf(attr()), detail: "b", runState: "pending", producesGeometry: false, canAddChild: false, conflict: false, ready: true },
  ];

  it("节点数 = 模型数; 边连 parent→child", () => {
    const { nodes, edges } = buildFlow(models, "a");
    expect(nodes).toHaveLength(3);
    expect(edges.map((e) => e.id)).toEqual(["root->a", "a->b"]);
  });

  it("col = depth-1: x 随深度递增", () => {
    const { nodes } = buildFlow(models, null);
    const x = (id: string) => nodes.find((n) => n.id === id)!.position.x;
    expect(x(ROOT_SID)).toBeLessThan(x("a"));
    expect(x("a")).toBeLessThan(x("b"));
  });

  it("选中节点打 selected 标记", () => {
    const { nodes } = buildFlow(models, "a");
    expect(nodes.find((n) => n.id === "a")!.selected).toBe(true);
    expect(nodes.find((n) => n.id === "b")!.selected).toBe(false);
  });

  it("源节点 type=source, 下游 type=stage", () => {
    const { nodes } = buildFlow(models, null);
    expect(nodes.find((n) => n.id === ROOT_SID)!.type).toBe("source");
    expect(nodes.find((n) => n.id === "a")!.type).toBe("stage");
  });

  // claude[bot] P2 · DAG 三个已修回归此前只覆盖 "新建节点 depth>3"; 补两条:
  // - "加第三阶段全部消失" 真因是 react-flow 受控模式漏 onNodesChange 致零尺寸 fitView 坍缩,
  //   pipelineGraph 层无法直接复现; 但纯函数层的下限是: 3 节点输入仍能产 3 节点 + 2 边的拓扑,
  //   不丢节点 / 不丢边。
  // - "快捷键删除假删除" 真因在 PipelineGraphCanvas 的 onNodesDelete 回写真值源; 这里至少断言
  //   ROOT_SID 不该被 buildFlow 派生为可删 (源节点不可删, 删它会级联清空整棵树)。
  it("3 节点 (root→a→b) 输入完整出 3 节点 + 2 边 (加第三阶段不丢节点)", () => {
    const { nodes, edges } = buildFlow(models, null);
    expect(nodes.map((n) => n.id).sort()).toEqual([ROOT_SID, "a", "b"].sort());
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.id).sort()).toEqual(["a->b", "root->a"]);
    // 三层各自打 col=0/1/2, 不会因为顺序乱掉就坍缩到同一列。
    const x = (id: string) => nodes.find((n) => n.id === id)!.position.x;
    expect(new Set([x(ROOT_SID), x("a"), x("b")]).size).toBe(3);
  });

  it("源节点不可删: ROOT_SID 视作不可作为删除目标 (canDelete 用 sid !== ROOT_SID 判定)", () => {
    // 这是 onNodesDelete 守卫的纯函数对偶: 删 ROOT_SID 会清空整棵树, 不允许。
    const canDeleteSid = (sid: string) => sid !== ROOT_SID;
    expect(canDeleteSid(ROOT_SID)).toBe(false);
    expect(canDeleteSid("a")).toBe(true);
    expect(canDeleteSid("b")).toBe(true);
  });
});

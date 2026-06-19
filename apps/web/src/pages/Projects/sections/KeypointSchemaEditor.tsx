/**
 * v0.10.28 · KeypointSchemaEditor
 *
 * keypoint 工具单位的骨骼模板编辑器：
 *   - 节点列表：增 / 删 / 重命名 / 选色 / 上下移排序；
 *   - 连线编辑：选两个节点索引成一条边、删边。
 *
 * 受控组件，由 ClassesSection 持有 value/onChange。后端 ToolBinding.keypoint_schema
 * 就位后即可端到端持久化（当前 PATCH 会被后端忽略，详见提交说明）。
 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { KeypointSchema } from "@/types";
import { keypointColorByIndex } from "@/pages/Workbench/stage/ImageStageShapes";

// UA-safe 表单/按钮基线 + token 化(无全局 preflight)。
const ICON_BTN_CLASS =
  "inline-flex size-7 shrink-0 cursor-pointer appearance-none items-center justify-center rounded border border-border bg-transparent p-0 text-muted-foreground enabled:hover:bg-card enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
const FIELD_CLASS =
  "h-7 min-w-0 flex-1 appearance-none rounded border border-border bg-card px-2 text-[13px] text-foreground outline-none";

const EMPTY: KeypointSchema = { nodes: [], edges: [] };

export function KeypointSchemaEditor({
  value,
  onChange,
}: {
  value: KeypointSchema | null | undefined;
  onChange: (next: KeypointSchema) => void;
}) {
  const schema = value ?? EMPTY;
  const { nodes, edges } = schema;
  const [edgeA, setEdgeA] = useState(0);
  const [edgeB, setEdgeB] = useState(1);

  const setNodes = (next: KeypointSchema["nodes"]) => {
    // 删节点后, 越界的边丢弃 / 索引重映射在 removeNode 内处理; 此处只直接替换。
    onChange({ nodes: next, edges });
  };

  const addNode = () => {
    onChange({
      nodes: [...nodes, { name: `node_${nodes.length + 1}`, color: keypointColorByIndex(nodes.length) }],
      edges,
    });
  };

  const removeNode = (idx: number) => {
    const nextNodes = nodes.filter((_, i) => i !== idx);
    // 重映射边索引：删掉含该节点的边，其余 index > idx 的减 1。
    const nextEdges = edges
      .filter(([i, j]) => i !== idx && j !== idx)
      .map(([i, j]) => [i > idx ? i - 1 : i, j > idx ? j - 1 : j] as [number, number]);
    onChange({ nodes: nextNodes, edges: nextEdges });
  };

  const renameNode = (idx: number, name: string) => {
    setNodes(nodes.map((n, i) => (i === idx ? { ...n, name } : n)));
  };

  const recolorNode = (idx: number, color: string) => {
    setNodes(nodes.map((n, i) => (i === idx ? { ...n, color } : n)));
  };

  const moveNode = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= nodes.length) return;
    const nextNodes = nodes.slice();
    [nextNodes[idx], nextNodes[j]] = [nextNodes[j], nextNodes[idx]];
    // 边索引随之交换 idx ↔ j。
    const swap = (k: number) => (k === idx ? j : k === j ? idx : k);
    const nextEdges = edges.map(([i, k]) => [swap(i), swap(k)] as [number, number]);
    onChange({ nodes: nextNodes, edges: nextEdges });
  };

  const addEdge = () => {
    if (edgeA === edgeB) return;
    if (edgeA >= nodes.length || edgeB >= nodes.length) return;
    const exists = edges.some(
      ([i, j]) => (i === edgeA && j === edgeB) || (i === edgeB && j === edgeA),
    );
    if (exists) return;
    onChange({ nodes, edges: [...edges, [edgeA, edgeB]] });
  };

  const removeEdge = (idx: number) => {
    onChange({ nodes, edges: edges.filter((_, i) => i !== idx) });
  };

  return (
    <div className="mt-3 flex flex-col gap-5">
      {/* 节点列表 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-foreground">关键点节点 ({nodes.length})</span>
          <Button variant="ghost" size="sm" onClick={addNode}>
            <Icon name="plus" size={14} /> 新增节点
          </Button>
        </div>
        {nodes.length === 0 ? (
          <p className="m-0 text-xs text-muted-foreground">尚无节点。点击「新增节点」开始定义骨骼。</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {nodes.map((n, i) => (
              <li key={i} className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1.5">
                <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>
                <input
                  type="color"
                  value={n.color ?? keypointColorByIndex(i)}
                  onChange={(e) => recolorNode(i, e.target.value)}
                  className="h-6 w-7 shrink-0 cursor-pointer rounded border border-border bg-card p-0"
                  aria-label={`节点 ${i + 1} 颜色`}
                />
                <input
                  type="text"
                  value={n.name}
                  onChange={(e) => renameNode(i, e.target.value)}
                  className={FIELD_CLASS}
                  placeholder="节点名"
                />
                <button
                  type="button"
                  className={ICON_BTN_CLASS}
                  onClick={() => moveNode(i, -1)}
                  disabled={i === 0}
                  title="上移"
                >
                  <Icon name="chevUp" size={14} />
                </button>
                <button
                  type="button"
                  className={ICON_BTN_CLASS}
                  onClick={() => moveNode(i, 1)}
                  disabled={i === nodes.length - 1}
                  title="下移"
                >
                  <Icon name="chevDown" size={14} />
                </button>
                <button
                  type="button"
                  className={ICON_BTN_CLASS}
                  onClick={() => removeNode(i)}
                  title="删除节点"
                >
                  <Icon name="trash" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 连线编辑 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-foreground">骨骼连线 ({edges.length})</span>
        </div>
        {nodes.length < 2 ? (
          <p className="m-0 text-xs text-muted-foreground">至少需要 2 个节点才能添加连线。</p>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={edgeA}
              onChange={(e) => setEdgeA(Number(e.target.value))}
              className={`${FIELD_CLASS} cursor-pointer`}
            >
              {nodes.map((n, i) => (
                <option key={i} value={i}>{`${i + 1} · ${n.name}`}</option>
              ))}
            </select>
            <Icon name="arrowRight" size={14} />
            <select
              value={edgeB}
              onChange={(e) => setEdgeB(Number(e.target.value))}
              className={`${FIELD_CLASS} cursor-pointer`}
            >
              {nodes.map((n, i) => (
                <option key={i} value={i}>{`${i + 1} · ${n.name}`}</option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={addEdge} disabled={edgeA === edgeB}>
              添加连线
            </Button>
          </div>
        )}
        {edges.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {edges.map(([i, j], idx) => (
              <li key={idx} className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted px-2 py-1.5 text-[13px] text-foreground">
                <span>
                  {nodes[i]?.name ?? `#${i + 1}`} — {nodes[j]?.name ?? `#${j + 1}`}
                </span>
                <button
                  type="button"
                  className={ICON_BTN_CLASS}
                  onClick={() => removeEdge(idx)}
                  title="删除连线"
                >
                  <Icon name="trash" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * v0.18.16 · 受限树形流水线 DAG 画布 (react-flow v12).
 *
 * 左列编排画布: 把 stagesGraph 派生的 GraphNodeModel[] 渲染成分层 DAG, 支持点选节点 (右列出参数)、
 * 节点上 +/🗑 增删、拖边改父 (re-parent)。所有真值仍在容器的 stagesGraph; 本组件无状态, nodes/edges
 * 全 useMemo 派生, nodesDraggable=false 防位置漂移。受限校验 (无环/深度/父产几何) 经 canReparentConn
 * 回调下沉到纯函数层 (pipelineGraph.ts)。经 React.lazy 加载, react-flow chunk 不进主包。
 */

import { createContext, memo, useContext, useEffect, useMemo, useCallback } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useNodesInitialized,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type IsValidConnection,
  type OnConnectEnd,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { ROOT_SID, buildFlow, type GraphNodeModel, type StageNodeData } from "../utils/pipelineGraph";
import styles from "./PipelineGraphCanvas.module.css";

interface CanvasCallbacks {
  onSelect: (sid: string) => void;
  onAddChild: (parentSid: string) => void;
  onRemove: (sid: string) => void;
}
const CanvasCtx = createContext<CanvasCallbacks>({
  onSelect: () => {},
  onAddChild: () => {},
  onRemove: () => {},
});

function cx(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

const DOT_CLASS: Record<string, string> = {
  pending: styles.dotPending,
  running: styles.dotRunning,
  done: styles.dotDone,
};

/** 节点公共内容 (角色徽标 + 名称 + 详情 + 运行态 + 计数 + 增删)。 */
function NodeBody({ data }: { data: StageNodeData }) {
  const { onSelect, onAddChild, onRemove } = useContext(CanvasCtx);
  const isSource = data.kind === "source";
  return (
    <div
      className={cx(styles.node, data.selected && styles.nodeSelected, data.conflict && styles.nodeConflict)}
      onClick={() => onSelect(data.sid)}
    >
      <div className={styles.nodeHeader}>
        <Icon name={data.role.icon} size={12} className={styles.nodeIcon} />
        <Badge variant={isSource ? "outline" : data.role.variant}>
          {isSource ? "源" : data.role.label}
        </Badge>
        {/* 源额外标「检测」(徽标只写「源」); 下游徽标已含角色名, 不重复。 */}
        <span className={styles.nodeName}>{isSource ? "检测" : ""}</span>
        <span className={cx(styles.dot, DOT_CLASS[data.runState])} title={data.runState} />
      </div>
      <span className={styles.nodeDetail} title={data.detail}>
        {data.detail}
      </span>
      <div className={styles.nodeFooter}>
        <span className={styles.nodeCounts}>
          {isSource
            ? data.ok != null && <span>检出 {data.ok}</span>
            : data.targeted != null && (
                <>
                  <span>目标 {data.targeted}</span>
                  <span>成功 {data.ok ?? 0}</span>
                </>
              )}
        </span>
        <span className={styles.nodeActions}>
          {data.canAddChild && (
            <button
              type="button"
              className={styles.nodeBtn}
              title="加子阶段（对该阶段产出的每个框继续跑）"
              onClick={(e) => {
                e.stopPropagation();
                onAddChild(data.sid);
              }}
            >
              <Icon name="plus" size={12} />
            </button>
          )}
          {!isSource && (
            <button
              type="button"
              className={styles.nodeBtn}
              title="移除该阶段"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(data.sid);
              }}
            >
              <Icon name="trash" size={12} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

const SourceNode = memo(({ data }: NodeProps<Node<StageNodeData>>) => (
  <>
    <NodeBody data={data} />
    {data.canAddChild && <Handle type="source" position={Position.Right} />}
  </>
));
SourceNode.displayName = "SourceNode";

const StageNode = memo(({ data }: NodeProps<Node<StageNodeData>>) => (
  <>
    <Handle type="target" position={Position.Left} />
    <NodeBody data={data} />
    {/* 产几何且未达深度上限才有出 handle —— 物理上把「叶子不可有子」编码进 UI。 */}
    {data.canAddChild && <Handle type="source" position={Position.Right} />}
  </>
));
StageNode.displayName = "StageNode";

const nodeTypes = { source: SourceNode, stage: StageNode };

interface Props {
  models: GraphNodeModel[];
  selectedSid: string | null;
  onSelect: (sid: string) => void;
  onAddChild: (parentSid: string) => void;
  onRemove: (sid: string) => void;
  /** 改父: child 挂到 newParent。 */
  onReparent: (childSid: string, newParentSid: string) => void;
  /** 改父合法性 (纯函数层判): 连线 source=新父, target=子。 */
  canReparentConn: (childSid: string, newParentSid: string) => boolean;
}

function Flow({
  models,
  selectedSid,
  onSelect,
  onAddChild,
  onRemove,
  onReparent,
  canReparentConn,
}: Props) {
  // 派生 nodes/edges 由 stagesGraph (经 models) 单向决定; 但 react-flow 需用 stateful 节点 +
  // onNodesChange 回填测量尺寸 (否则节点 width/height 恒 0, fitView 坍缩 → 节点全部不可见)。
  // 故: useNodesState 持内部态, graph 结构变 (flow.nodes 标识变) 时整体重置, 重置后由 react-flow
  // 重新测量; 测量完成 (nodesInitialized) 或节点数变化时重新 fitView。
  const flow = useMemo(() => buildFlow(models, selectedSid), [models, selectedSid]);
  const [nodes, setNodes, onNodesChange] = useNodesState(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flow.edges);
  useEffect(() => setNodes(flow.nodes), [flow.nodes, setNodes]);
  useEffect(() => setEdges(flow.edges), [flow.edges, setEdges]);

  const rf = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const nodeCount = flow.nodes.length;
  useEffect(() => {
    if (nodesInitialized) rf.fitView({ padding: 0.2, maxZoom: 1 });
  }, [nodesInitialized, nodeCount, rf]);

  // 连线: source=拖出的父出 handle, target=落到的子入 handle → child 改挂到 source。
  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target) onReparent(c.target, c.source);
    },
    [onReparent],
  );
  const onReconnect = useCallback(
    (_old: Edge, c: Connection) => {
      if (c.source && c.target) onReparent(c.target, c.source);
    },
    [onReparent],
  );
  const isValidConnection = useCallback<IsValidConnection>(
    (c) => !!c.source && !!c.target && canReparentConn(c.target, c.source),
    [canReparentConn],
  );
  // 拖出 handle 落到空白 → 新建子阶段 (源恒有 +子 能力即出 handle 存在的前提)。
  const onConnectEnd = useCallback<OnConnectEnd>(
    (_event, conn) => {
      if (conn.fromNode && !conn.toNode) onAddChild(conn.fromNode.id);
    },
    [onAddChild],
  );
  // Delete/Backspace 删选中节点: react-flow 默认只删其内部态 (假删除), 须回写真值源 stagesGraph。
  // 源节点不可删 (删它会级联清空整棵树)。
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      deleted.forEach((n) => {
        if (n.id !== ROOT_SID) onRemove(n.id);
      });
    },
    [onRemove],
  );

  const callbacks = useMemo(() => ({ onSelect, onAddChild, onRemove }), [onSelect, onAddChild, onRemove]);

  return (
    <div className={styles.canvas}>
      <CanvasCtx.Provider value={callbacks}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onConnectEnd={onConnectEnd}
          onNodesDelete={onNodesDelete}
          isValidConnection={isValidConnection}
          onNodeClick={(_e, n) => onSelect(n.id)}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </CanvasCtx.Provider>
    </div>
  );
}

export default function PipelineGraphCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}

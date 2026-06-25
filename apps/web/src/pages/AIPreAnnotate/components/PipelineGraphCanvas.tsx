/**
 * v0.18.16 · 受限树形流水线 DAG 画布 (react-flow v12).
 *
 * 左列编排画布: 把 stagesGraph 派生的 GraphNodeModel[] 渲染成分层 DAG, 支持点选节点 (右列出参数)、
 * 节点上 +/🗑 增删、拖边改父 (re-parent)。所有真值仍在容器的 stagesGraph; nodes/edges 由 models
 * 派生 (react-flow 用 stateful 节点回填测量尺寸)。受限校验 (无环/深度/父产几何) 经 canReparentConn
 * 回调下沉到纯函数层。经 React.lazy 加载, react-flow chunk 不进主包。
 *
 * §13 信息增强: 节点显 backend / 就绪态 / 父框过滤 / 运行进度 / 可达性警示; hover 浮层显全量;
 * 拖拽时合法落点高亮; 方向键在节点间移动选中; 大扇出出 MiniMap; 空态 ghost CTA。
 */

import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
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
  type OnConnectStart,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Tooltip } from "@/components/ui/Tooltip";
import { ROOT_SID, buildFlow, type GraphNodeModel, type StageNodeData } from "../utils/pipelineGraph";
import styles from "./PipelineGraphCanvas.module.css";

interface CanvasCallbacks {
  onSelect: (sid: string) => void;
  onAddChild: (parentSid: string) => void;
  onRemove: (sid: string) => void;
  /** 拖拽中: 从哪个节点的出 handle 拉线 (用于合法落点高亮); null=未拖拽。 */
  connectingFrom: string | null;
  canReparentConn: (childSid: string, newParentSid: string) => boolean;
}
const CanvasCtx = createContext<CanvasCallbacks>({
  onSelect: () => {},
  onAddChild: () => {},
  onRemove: () => {},
  connectingFrom: null,
  canReparentConn: () => false,
});

function cx(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

const DOT_CLASS: Record<string, string> = {
  pending: styles.dotPending,
  running: styles.dotRunning,
  done: styles.dotDone,
};

/** hover 浮层全量信息 (节点只显主信息, 全量走浮层)。 */
function tooltipDesc(data: StageNodeData, isSource: boolean) {
  return (
    <div className={styles.tipBody}>
      {data.backendName && <div>后端：{data.backendName}</div>}
      {data.modelId && <div>模型：{data.modelId}</div>}
      {data.taskType && <div>任务：{data.taskType}</div>}
      {!isSource && <div>父框：{data.classFilter ?? "全部框"}</div>}
      {data.roiInfo && <div>投递：{data.roiInfo}</div>}
      {data.variantInfo && <div>变体：{data.variantInfo}</div>}
      <div>产物：{data.detail}</div>
      {data.warning && <div className={styles.tipWarn}>⚠ {data.warning}</div>}
    </div>
  );
}

/** 节点公共内容 (角色徽标 + backend + 就绪/警示 + 详情 + 父框 + 进度 + 计数 + 增删)。 */
function NodeBody({ data }: { data: StageNodeData }) {
  const { onSelect, onAddChild, onRemove, connectingFrom, canReparentConn } = useContext(CanvasCtx);
  const isSource = data.kind === "source";

  // 拖拽中: 本节点是否合法落点 (连线 source=connectingFrom 父, target=本节点 子)。
  const drop =
    connectingFrom && connectingFrom !== data.sid
      ? canReparentConn(data.sid, connectingFrom)
        ? "ok"
        : "bad"
      : null;
  const okPct = data.targeted && data.targeted > 0 ? ((data.ok ?? 0) / data.targeted) * 100 : 0;

  return (
    <Tooltip name={isSource ? "检测（源）" : data.role.label} desc={tooltipDesc(data, isSource)} side="top">
      <div
        className={cx(
          styles.node,
          data.selected && styles.nodeSelected,
          data.conflict && styles.nodeConflict,
          !data.ready && styles.nodeUnconfigured,
          drop === "ok" && styles.nodeDropOk,
          drop === "bad" && styles.nodeDropBad,
        )}
        onClick={() => onSelect(data.sid)}
      >
        <div className={styles.nodeHeader}>
          <Icon name={data.role.icon} size={12} className={styles.nodeIcon} />
          <Badge variant={isSource ? "outline" : data.role.variant}>
            {isSource ? "源" : data.role.label}
          </Badge>
          <span className={styles.nodeName}>{isSource ? "检测" : ""}</span>
          {data.warning && <Icon name="warning" size={12} className={styles.nodeWarn} />}
          <span className={cx(styles.dot, DOT_CLASS[data.runState])} title={data.runState} />
        </div>

        {/* 副标题: backend 名 + 待配置徽标。 */}
        <div className={styles.nodeSubtitle}>
          <span className={styles.nodeBackend}>{data.backendName ?? "—"}</span>
          {!data.ready && <Badge variant="outline">待配置</Badge>}
        </div>

        <span className={styles.nodeDetail} title={data.detail}>
          {data.detail}
        </span>

        {/* 父框过滤芯片 (仅下游)。 */}
        {!isSource && data.classFilter && (
          <span className={styles.nodeChip}>{data.classFilter}</span>
        )}

        {/* 运行进度条 (运行中且有目标)。 */}
        {!isSource && data.runState === "running" && data.targeted ? (
          <ProgressBar value={okPct} />
        ) : null}

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
    </Tooltip>
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
  // 派生 nodes/edges 由 stagesGraph (经 models) 单向决定; react-flow 用 stateful 节点 + onNodesChange
  // 回填测量尺寸 (否则节点 width/height 恒 0, fitView 坍缩 → 节点全不可见)。graph 变时整体重置 + 重新测量。
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

  // 拖拽中起点 (合法落点高亮)。仅从「出 handle」(source) 拉线才记。
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const onConnectStart = useCallback<OnConnectStart>((_e, params) => {
    if (params.handleType === "source") setConnectingFrom(params.nodeId ?? null);
  }, []);

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
  // 拖出 handle 落到空白 → 新建子阶段; 无论落到哪都清掉高亮态。
  const onConnectEnd = useCallback<OnConnectEnd>(
    (_event, conn) => {
      if (conn.fromNode && !conn.toNode) onAddChild(conn.fromNode.id);
      setConnectingFrom(null);
    },
    [onAddChild],
  );
  // Delete/Backspace 删选中节点: react-flow 默认只删其内部态 (假删除), 须回写真值源 stagesGraph。
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      deleted.forEach((n) => {
        if (n.id !== ROOT_SID) onRemove(n.id);
      });
    },
    [onRemove],
  );

  // 方向键在节点间移动选中 (左=父, 右=首子, 上/下=兄弟)。Enter 由选中即出右栏天然覆盖。
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!selectedSid) return;
      const cur = models.find((m) => m.sid === selectedSid);
      if (!cur) return;
      let next: string | undefined;
      if (e.key === "ArrowLeft") next = cur.parentSid ?? undefined;
      else if (e.key === "ArrowRight") next = models.find((m) => m.parentSid === selectedSid)?.sid;
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const sibs = models.filter((m) => m.parentSid === cur.parentSid);
        const idx = sibs.findIndex((m) => m.sid === selectedSid);
        next = sibs[idx + (e.key === "ArrowUp" ? -1 : 1)]?.sid;
      } else return;
      if (next) {
        e.preventDefault();
        onSelect(next);
      }
    },
    [models, selectedSid, onSelect],
  );

  const callbacks = useMemo<CanvasCallbacks>(
    () => ({ onSelect, onAddChild, onRemove, connectingFrom, canReparentConn }),
    [onSelect, onAddChild, onRemove, connectingFrom, canReparentConn],
  );

  return (
    <div className={styles.canvas} tabIndex={0} onKeyDown={onKeyDown}>
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
          onConnectStart={onConnectStart}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onConnectEnd={onConnectEnd}
          onNodesDelete={onNodesDelete}
          isValidConnection={isValidConnection}
          onNodeClick={(_e, n) => onSelect(n.id)}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
          {nodeCount > 4 && <MiniMap pannable zoomable />}
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

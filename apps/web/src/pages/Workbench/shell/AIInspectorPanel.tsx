import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { TabRow } from "@/components/ui/TabRow";
import type { Annotation, AnnotationResponse } from "@/types";
import type { AnnotationCommentAnchor } from "@/api/comments";
import type { AttributeSchema } from "@/api/projects";
import type { AiBox } from "../state/transforms";
import { BoxListItem } from "../stage/BoxListItem";
import { resolveTrackAtFrame } from "../stage/videoStageGeometry";
import { AttributeForm } from "./AttributeForm";
import { CommentsPanel } from "./CommentsPanel";
import { ResizeHandle } from "./ResizeHandle";
import type { TextOutputMode } from "../state/useInteractiveAI";
import { resolveInitialOutputMode, writeStoredOutputMode } from "../state/samTextOutput";
import { useProject } from "@/hooks/useProjects";
import styles from "./AIInspectorPanel.module.css";

interface AIInspectorPanelProps {
  open: boolean;
  /** 受控宽度（仅 open=true 生效）。 */
  width: number;
  onResize: (w: number) => void;
  aiBoxes: AiBox[];
  userBoxes: Annotation[];
  selectedId: string | null;
  selectedIds?: string[];
  /** 与 user 框 IoU > 0.7 的同类 AI 框 id（视觉淡化）。 */
  dimmedAiIds?: Set<string>;
  imageWidth: number | null;
  imageHeight: number | null;
  /** 项目级属性 schema（v0.5.4）。空时不渲染表单。 */
  attributeSchema?: AttributeSchema;
  /** 选中的 AnnotationResponse（含 attributes / class_name），用于属性表单数据源。 */
  selectedAnnotation?: AnnotationResponse | null;
  /** 属性表单提交回调（防抖后触发）。 */
  onUpdateAttributes?: (annotationId: string, next: Record<string, unknown>) => void;
  /** 当前用户 id（驱动评论作者操作权限）。 */
  currentUserId?: string;
  /** 当前题图 URL：作为评论画布批注的预览背景。 */
  taskFileUrl?: string | null;
  /** v0.6.4：默认 true，annotator + reviewer 双向都能画布批注（之前仅 reviewer）。
   *  设 false 仅在确实只读的场景（例如审计预览页）才需要。*/
  enableCommentCanvasDrawing?: boolean;
  /** v0.6.4：在题图上直接绘制的桥接（CommentInput → ImageStage CanvasDrawingLayer）。*/
  liveCommentCanvas?: {
    active: boolean;
    result: import("@/api/comments").CommentCanvasDrawing | null;
    onStart: (initial?: import("@/api/comments").CommentCanvasDrawing | null) => void;
    onConsume: () => void;
  };
  hasMorePredictions?: boolean;
  isFetchingMorePredictions?: boolean;
  onFetchMorePredictions?: () => void;
  currentFrameIndex?: number;
  onSeekFrame?: (frameIndex: number) => void;
  commentAnchor?: AnnotationCommentAnchor | null;
  onToggle: () => void;
  /** Shift+click 进入多选；普通 click 单选。 */
  onSelect: (id: string, opts?: { shift?: boolean }) => void;
  onAcceptPrediction: (b: AiBox) => void;
  onRejectPrediction?: (b: AiBox) => void;
  /** v0.10.8 · I11 · polygon 候选行展示「精修」按钮 → 启动 Mask 编辑器。 */
  onRefinePrediction?: (b: AiBox) => void;
  /** v0.10.9 · 已落库 user polygon 行展示「精修」按钮 → 启动 Mask 编辑器（update mutation）。 */
  onRefineUserPolygon?: (annotationId: string) => void;
  onClearSelection: () => void;
  onDeleteUserBox: (id: string) => void;
  onChangeUserBoxClass?: (id: string) => void;
  /** v0.10.5 M4-β · I15 切换 shape 状态位（lock/hidden/occluded）。 */
  onToggleUserBoxFlag?: (id: string, flag: "is_locked" | "is_hidden" | "is_occluded") => void;
  /** v0.6.5 · 任务已锁定（review/completed），属性表单只读。 */
  readOnly?: boolean;
  videoTrackPanel?: React.ReactNode;
}

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function AIInspectorPanel({
  open, width, onResize,
  aiBoxes,
  userBoxes, selectedId, selectedIds,
  dimmedAiIds,
  imageWidth, imageHeight,
  attributeSchema, selectedAnnotation, onUpdateAttributes, currentUserId,
  taskFileUrl, enableCommentCanvasDrawing = true, liveCommentCanvas,
  hasMorePredictions, isFetchingMorePredictions, onFetchMorePredictions,
  currentFrameIndex, onSeekFrame, commentAnchor,
  onToggle,
  onSelect, onAcceptPrediction, onRejectPrediction, onRefinePrediction, onRefineUserPolygon,
  onClearSelection, onDeleteUserBox, onChangeUserBoxClass,
  onToggleUserBoxFlag,
  readOnly = false,
  videoTrackPanel,
}: AIInspectorPanelProps) {
  const selSet = selectedIds && selectedIds.length > 0
    ? new Set(selectedIds)
    : selectedId ? new Set([selectedId]) : new Set<string>();
  const multiCount = selSet.size > 1 ? selSet.size : 0;
  if (!open) {
    return (
      <div className={styles.collapsedShell}>
        <button onClick={onToggle} title="展开标注详情" className={styles.collapsedButton}>
          <Icon name="panelRight" size={16} />
          <span className={styles.collapsedLabel}>标注详情</span>
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <ResizeHandle side="left" width={width} onResize={onResize} min={220} max={600} />
      <div className={styles.panelHeader}>
        <div className={styles.panelHeaderRow}>
          <b className={styles.panelTitle}>标注详情</b>
          <Button variant="ghost" size="sm" onClick={onToggle} title="收起标注详情" className={styles.compactIconButton}>
            <Icon name="panelRight" size={14} />
          </Button>
        </div>
      </div>

      {multiCount > 0 && (
        <div className={styles.multiSelectionBar}>
          <span>已选 <b>{multiCount}</b> 个 user 框</span>
          <button onClick={onClearSelection} className={styles.clearSelectionButton}>清除</button>
        </div>
      )}

      {selectedAnnotation && attributeSchema && onUpdateAttributes && (
        <AttributeForm
          schema={attributeSchema}
          className={selectedAnnotation.class_name}
          attributes={selectedAnnotation.attributes ?? {}}
          onChange={(next) => onUpdateAttributes(selectedAnnotation.id, next)}
          readOnly={readOnly}
        />
      )}

      {selectedAnnotation && (
        <CommentsPanel
          annotationId={selectedAnnotation.id}
          projectId={selectedAnnotation.project_id}
          currentUserId={currentUserId}
          backgroundUrl={taskFileUrl}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          enableCanvasDrawing={enableCommentCanvasDrawing}
          liveCanvas={liveCommentCanvas}
          commentAnchor={commentAnchor}
          onSeekFrame={onSeekFrame}
        />
      )}

      <BoxesList
        aiBoxes={aiBoxes}
        userBoxes={userBoxes}
        selSet={selSet}
        dimmedAiIds={dimmedAiIds}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        hasMore={hasMorePredictions}
        isFetchingMore={isFetchingMorePredictions}
        onFetchMore={onFetchMorePredictions}
        currentFrameIndex={currentFrameIndex}
        onSeekFrame={onSeekFrame}
        onSelect={onSelect}
        onAcceptPrediction={onAcceptPrediction}
        onRejectPrediction={onRejectPrediction}
        onRefinePrediction={onRefinePrediction}
        onRefineUserPolygon={onRefineUserPolygon}
        onClearSelection={onClearSelection}
        onDeleteUserBox={onDeleteUserBox}
        onChangeUserBoxClass={onChangeUserBoxClass}
        onToggleUserBoxFlag={onToggleUserBoxFlag}
        videoTrackPanel={videoTrackPanel}
      />
    </div>
  );
}

interface AIPredictionPopoverProps {
  open: boolean;
  rightOffset: number;
  position: { left: number; top: number } | null;
  onPositionChange: (position: { left: number; top: number }) => void;
  aiModel: string;
  aiRunning: boolean;
  aiBoxCount: number;
  confThreshold: number;
  aiTakeoverRate: number;
  onClose: () => void;
  onRunAi: () => void;
  onAcceptAll: () => void;
  onSetConfThreshold: (v: number) => void;
  // v0.10.2 · Tool union 扩展; SamTextPanel 现在仅在 tool === "text-prompt" 时显示.
  // v0.10.8 · 加 "mask".
  tool?: "box" | "hand" | "polygon" | "canvas" | "mask" | "smart-point" | "smart-box" | "text-prompt" | "exemplar";
  onRunSamText?: (text: string, outputMode: TextOutputMode) => void;
  samRunning?: boolean;
  samCandidateCount?: number;
  projectId?: string;
  projectTypeKey?: string | null;
  samTextFocusKey?: number;
  taskAiCost?: number;
  taskAiAvgMs?: number | null;
  taskAiPredictionCount?: number;
}

export function AIPredictionPopover({
  open,
  rightOffset,
  position,
  onPositionChange,
  aiModel,
  aiRunning,
  aiBoxCount,
  confThreshold,
  aiTakeoverRate,
  onClose,
  onRunAi,
  onAcceptAll,
  onSetConfThreshold,
  tool,
  onRunSamText,
  samRunning = false,
  samCandidateCount = 0,
  projectId,
  projectTypeKey,
  samTextFocusKey,
  taskAiCost,
  taskAiAvgMs,
  taskAiPredictionCount,
}: AIPredictionPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  const handleDragStart = (evt: React.PointerEvent<HTMLDivElement>) => {
    if ((evt.target as HTMLElement).closest("button")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffsetRef.current = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    evt.preventDefault();
  };

  const handleDragMove = (evt: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffsetRef.current) return;
    const rect = panelRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 360;
    const height = rect?.height ?? 260;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    onPositionChange({
      left: Math.min(maxLeft, Math.max(8, evt.clientX - dragOffsetRef.current.x)),
      top: Math.min(maxTop, Math.max(8, evt.clientY - dragOffsetRef.current.y)),
    });
  };

  const handleDragEnd = () => {
    dragOffsetRef.current = null;
  };

  useEffect(() => {
    const node = panelRef.current;
    if (!node || !open) return;
    if (position) {
      node.style.setProperty("--ai-inspector-popover-left", `${position.left}px`);
      node.style.setProperty("--ai-inspector-popover-top", `${position.top}px`);
      node.style.removeProperty("--ai-inspector-popover-right");
      return;
    }
    node.style.setProperty("--ai-inspector-popover-top", "58px");
    node.style.setProperty("--ai-inspector-popover-right", `${rightOffset}px`);
    node.style.removeProperty("--ai-inspector-popover-left");
  }, [open, position, rightOffset]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      data-testid="ai-prediction-popover"
      className={cn(styles.aiPopover, position ? styles.aiPopoverPositioned : styles.aiPopoverDocked)}
    >
      <div
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        className={styles.aiPopoverHeader}
        title="拖动 AI 面板"
      >
        <div className={styles.aiHeaderTopRow}>
          <div className={styles.aiHeaderTitleGroup}>
            <span className={styles.aiHeaderIcon}>
              <Icon name="bot" size={14} />
            </span>
            <b className={styles.panelTitle}>AI</b>
            <Icon name="move" size={12} className={styles.subtleIcon} />
          </div>
          <div className={styles.aiHeaderActions}>
            <span className={styles.compactBadge}>
              <Badge variant="ai" dot={!aiRunning}>
                {aiRunning && <Icon name="loader2" size={10} className="spin" />}
                {aiRunning ? "推理中" : "就绪"}
              </Badge>
            </span>
            <Button variant="ghost" size="sm" onClick={onClose} title="关闭 AI" className={styles.compactIconButton}>
              <Icon name="x" size={12} />
            </Button>
          </div>
        </div>
        <div className={styles.aiModelRow}>
          <span>模型: <span className={styles.emphasisText}>{aiModel}</span></span>
          <span className="mono">{aiBoxCount} 待审</span>
        </div>
        <div className={styles.aiActionRow}>
          <Button variant="ai" size="sm" onClick={onRunAi} disabled={aiRunning} className={styles.flexButton}>
            {aiRunning
              ? <Icon name="loader2" size={11} className="spin" />
              : <Icon name="wandSparkles" size={11} />}
            {aiRunning ? "推理中..." : "开始预标"}
          </Button>
          <Button size="sm" onClick={onAcceptAll} disabled={aiBoxCount === 0} className={styles.flexButton}>
            <Icon name="check" size={11} />全部采纳
          </Button>
        </div>
        <div>
          <div className={styles.thresholdHeader}>
            <span
              className={styles.mutedText}
              title="只显示置信度 >= 该阈值的 AI 框；低于阈值的框被隐藏，全部采纳也不会采纳它们。"
            >
              置信度阈值
            </span>
            <span className={cn("mono", styles.thresholdValue)}>{(confThreshold * 100).toFixed(0)}%</span>
          </div>
          <div
            className={styles.thresholdDisplay}
            onWheel={(e) => {
              e.preventDefault();
              const step = e.shiftKey ? 0.1 : 0.05;
              const next = Math.min(1, Math.max(0, confThreshold + (e.deltaY < 0 ? step : -step)));
              onSetConfThreshold(Number(next.toFixed(2)));
            }}
            data-testid="ai-threshold-display"
          >
            在工具栏使用 <kbd>[</kbd> / <kbd>]</kbd> 调整
          </div>
        </div>
      </div>

      {tool === "text-prompt" && onRunSamText && (
        <SamTextPanel
          onRun={onRunSamText}
          running={samRunning}
          candidateCount={samCandidateCount}
          projectId={projectId}
          projectTypeKey={projectTypeKey}
          focusKey={samTextFocusKey}
        />
      )}

      <div className={styles.aiStats}>
        <div className={styles.aiStatsLabel}>本次效率</div>
        <div className={styles.aiStatsRow}>
          <span>AI 接管率</span>
          <span className={cn("mono", styles.aiRateValue)}>{aiTakeoverRate}%</span>
        </div>
        <ProgressBar value={aiTakeoverRate} color="var(--color-ai)" />
        {taskAiPredictionCount && taskAiPredictionCount > 0 && (
          <div
            data-testid="task-ai-cost"
            className={styles.taskAiCost}
          >
            <span>本题</span>
            <span className={cn("mono", styles.taskAiCostValue)}>
              {taskAiCost != null && taskAiCost > 0 ? `¥${taskAiCost.toFixed(4)}` : "¥0"}
              {taskAiAvgMs != null && (
                <>
                  <span className={styles.inlineSeparator}>·</span>
                  {taskAiAvgMs}ms
                </>
              )}
              <span className={styles.predictionCount}>
                ({taskAiPredictionCount} 次)
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── SAM 文本提示面板（v0.9.2 引入，v0.10.2 由 tool === "text-prompt" 时显） ─────────────────────────
interface SamTextPanelProps {
  /** v0.9.4 phase 2 · onRun 接 outputMode (box / mask / both) 参数 */
  onRun: (text: string, outputMode: TextOutputMode) => void;
  running: boolean;
  candidateCount: number;
  /** v0.9.4 phase 2 · sessionStorage 持久化 key + 智能默认按 type_key */
  projectId?: string;
  projectTypeKey?: string | null;
  /** v0.9.4 phase 2 · 切到 sam-text 子工具时父级自增此值, panel 拿到后自动 focus input. */
  focusKey?: number;
}

// v0.9.4 phase 2 · 中文标签 ↔ TextOutputMode 双向映射 (TabRow 直接显示标签字符串).
const OUTPUT_MODE_LABELS: Record<TextOutputMode, string> = {
  box: "□ 框",
  mask: "○ 掩膜",
  both: "⊕ 全部",
};
const OUTPUT_MODE_BY_LABEL: Record<string, TextOutputMode> = {
  "□ 框": "box",
  "○ 掩膜": "mask",
  "⊕ 全部": "both",
};
const OUTPUT_MODE_TABS = Object.values(OUTPUT_MODE_LABELS);

function SamTextPanel({
  onRun,
  running,
  candidateCount,
  projectId,
  projectTypeKey,
  focusKey,
}: SamTextPanelProps) {
  const [text, setText] = useState("");
  // v0.9.5 · 类别 alias 快速填入; 必须先于使用其 data 的 useState 初始化器声明, 避免 TDZ.
  const projectQ = useProject(projectId ?? "");
  const [outputMode, setOutputMode] = useState<TextOutputMode>(() =>
    resolveInitialOutputMode(projectId, projectTypeKey, projectQ.data?.text_output_default),
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const aliases = useMemo(() => {
    const cfg = projectQ.data?.classes_config ?? {};
    return Object.entries(cfg)
      .map(([name, entry]) => ({ name, alias: entry?.alias ?? null }))
      .filter((e): e is { name: string; alias: string } => !!e.alias);
  }, [projectQ.data?.classes_config]);
  // 切项目重新计算默认 (跨 project 不串扰); v0.9.5 项目级 default 拉到后再应用一次.
  useEffect(() => {
    setOutputMode(resolveInitialOutputMode(projectId, projectTypeKey, projectQ.data?.text_output_default));
  }, [projectId, projectTypeKey, projectQ.data?.text_output_default]);
  // v0.9.4 phase 2 · S 键循环到 sam-text 子工具时父级 bumpSamTextFocus → focusKey 变 → 抓焦.
  useEffect(() => {
    if (focusKey === undefined || focusKey === 0) return;
    inputRef.current?.focus();
  }, [focusKey]);
  const handleModeChange = (label: string) => {
    const mode = OUTPUT_MODE_BY_LABEL[label];
    if (!mode) return;
    setOutputMode(mode);
    if (projectId) writeStoredOutputMode(projectId, mode);
  };
  const trimmed = text.trim();
  return (
    <div
      data-testid="sam-text-panel"
      className={styles.samTextPanel}
    >
      <div className={styles.samTextHeader}>
        <span className={styles.samTextTitle}>
          <Icon name="messageSquareText" size={11} /> SAM 文本提示
        </span>
        {candidateCount > 0 && (
          <span className={styles.compactBadge}>
            <Badge variant="ai">
              {candidateCount} 候选 · Tab 切换 · Enter 接受
            </Badge>
          </span>
        )}
      </div>
      {/* v0.9.4 phase 2 · 输出形态三选一 (智能默认按 type_key, 用户切换写 sessionStorage) */}
      <div className={styles.samTextOutputMode} data-testid="sam-text-output-mode">
        <TabRow
          tabs={OUTPUT_MODE_TABS}
          active={OUTPUT_MODE_LABELS[outputMode]}
          onChange={handleModeChange}
        />
      </div>
      {aliases.length > 0 && (
        <div
          data-testid="sam-text-aliases"
          className={styles.samTextAliases}
        >
          {aliases.map((a) => (
            <button
              key={a.name}
              type="button"
              onClick={() => setText(a.alias)}
              title={`使用类别「${a.name}」alias`}
              className={styles.samAliasButton}
            >
              {a.alias}
            </button>
          ))}
        </div>
      )}
      <div className={styles.samInputRow}>
        <input
          data-testid="sam-text-input"
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmed && !running) {
              e.preventDefault();
              onRun(trimmed, outputMode);
            }
          }}
          placeholder="e.g. person / car / ripe apple"
          disabled={running}
          className={styles.samTextInput}
        />
        <Button
          variant="ai"
          size="sm"
          disabled={!trimmed || running}
          onClick={() => onRun(trimmed, outputMode)}
          className={styles.inlineIconButton}
        >
          {running && <Icon name="loader2" size={11} className="spin" />}
          {running ? "推理中…" : "找全图"}
        </Button>
      </div>
      <div className={styles.samHint}>
        {outputMode === "box" && "仅 DINO 出框,跳过 SAM mask, 速度最快; "}
        {outputMode === "mask" && "DINO + SAM mask → polygon, 默认行为; "}
        {outputMode === "both" && "同实例配对返回框 + 掩膜, Tab 切换活跃形态; "}
        英文 prompt 召回最佳;DINO 阈值由项目设置控制。
      </div>
    </div>
  );
}

// ── 虚拟化合并列表 ─────────────────────────────────────────────────────────
type Row =
  | { kind: "ai"; box: AiBox; key: string }
  | {
    kind: "header";
    count: number;
    totalCount: number;
    key: string;
    label: string;
    filter: FrameFilter;
    onFilterChange: (filter: FrameFilter) => void;
    showFrameFilter: boolean;
  }
  | { kind: "videoTracks"; key: string }
  | { kind: "user"; box: Annotation; key: string };

type FrameFilter = "all" | "current";

function boxIsOnFrame(box: Annotation | AiBox, frameIndex: number) {
  const geometry = box.geometry;
  if (!geometry) return true;
  if (geometry.type === "video_bbox") return geometry.frame_index === frameIndex;
  if (geometry.type === "video_track") return resolveTrackAtFrame(geometry, frameIndex) !== null;
  return true;
}

function firstTrackFrame(box: Annotation | AiBox): number | null {
  const geometry = box.geometry;
  if (!geometry) return null;
  if (geometry.type === "video_bbox") return geometry.frame_index;
  if (geometry.type !== "video_track" || geometry.keyframes.length === 0) return null;
  const visible = geometry.keyframes.filter((kf) => !kf.absent);
  const frames = (visible.length > 0 ? visible : geometry.keyframes).map((kf) => kf.frame_index);
  return Math.min(...frames);
}

function filterBoxesByFrame<T extends Annotation | AiBox>(
  boxes: T[],
  frameIndex: number | undefined,
  filter: FrameFilter,
) {
  if (filter !== "current" || typeof frameIndex !== "number") return boxes;
  return boxes.filter((box) => boxIsOnFrame(box, frameIndex));
}

function FrameFilterTabs({ value, onChange }: { value: FrameFilter; onChange: (filter: FrameFilter) => void }) {
  const options: Array<{ value: FrameFilter; label: string }> = [
    { value: "all", label: "全部" },
    { value: "current", label: "当前帧" },
  ];
  return (
    <div
      aria-label="帧过滤"
      className={styles.frameFilterTabs}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              styles.frameFilterButton,
              option.value === "current" && styles.frameFilterButtonWithDivider,
              active && styles.frameFilterButtonActive,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface BoxesListProps {
  aiBoxes: AiBox[];
  userBoxes: Annotation[];
  selSet: Set<string>;
  dimmedAiIds?: Set<string>;
  imageWidth: number | null;
  imageHeight: number | null;
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onFetchMore?: () => void;
  currentFrameIndex?: number;
  onSelect: (id: string, opts?: { shift?: boolean }) => void;
  onAcceptPrediction: (b: AiBox) => void;
  onRejectPrediction?: (b: AiBox) => void;
  /** v0.10.8 · I11 · 仅 polygon 候选会展示「精修」按钮，由 WorkbenchShell 注入 handleRefinePrediction。 */
  onRefinePrediction?: (b: AiBox) => void;
  /** v0.10.9 · 已落库 user polygon 行的「精修」按钮，update mutation 替换 geometry。 */
  onRefineUserPolygon?: (annotationId: string) => void;
  onClearSelection: () => void;
  onDeleteUserBox: (id: string) => void;
  onChangeUserBoxClass?: (id: string) => void;
  /** v0.10.5 M4-β · I15 切换 shape 状态位（lock/hidden/occluded）。 */
  onToggleUserBoxFlag?: (id: string, flag: "is_locked" | "is_hidden" | "is_occluded") => void;
  onSeekFrame?: (frameIndex: number) => void;
  videoTrackPanel?: React.ReactNode;
}

function BoxesList({
  aiBoxes, userBoxes, selSet, dimmedAiIds, imageWidth, imageHeight,
  hasMore, isFetchingMore, onFetchMore,
  currentFrameIndex,
  onSeekFrame,
  onSelect, onAcceptPrediction, onRejectPrediction, onRefinePrediction, onRefineUserPolygon,
  onClearSelection, onDeleteUserBox, onChangeUserBoxClass,
  onToggleUserBoxFlag,
  videoTrackPanel,
}: BoxesListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [aiFrameFilter, setAiFrameFilter] = useState<FrameFilter>("all");
  const [userFrameFilter, setUserFrameFilter] = useState<FrameFilter>("all");
  const showFrameFilter = typeof currentFrameIndex === "number";

  const filteredAiBoxes = useMemo(
    () => filterBoxesByFrame(aiBoxes, currentFrameIndex, aiFrameFilter),
    [aiBoxes, currentFrameIndex, aiFrameFilter],
  );
  const filteredUserBoxes = useMemo(
    () => filterBoxesByFrame(userBoxes, currentFrameIndex, userFrameFilter),
    [userBoxes, currentFrameIndex, userFrameFilter],
  );

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    out.push({
      kind: "header",
      label: "AI 待审",
      count: filteredAiBoxes.length,
      totalCount: aiBoxes.length,
      key: "ai-header",
      filter: aiFrameFilter,
      onFilterChange: setAiFrameFilter,
      showFrameFilter,
    });
    filteredAiBoxes.forEach((b) => out.push({ kind: "ai", box: b, key: `ai-${b.id}` }));
    out.push({
      kind: "header",
      label: "人工",
      count: filteredUserBoxes.length,
      totalCount: userBoxes.length,
      key: "user-header",
      filter: userFrameFilter,
      onFilterChange: setUserFrameFilter,
      showFrameFilter,
    });
    filteredUserBoxes.forEach((b) => out.push({ kind: "user", box: b, key: `user-${b.id}` }));
    if (videoTrackPanel) out.push({ kind: "videoTracks", key: "video-track-panel" });
    return out;
  }, [aiBoxes.length, aiFrameFilter, filteredAiBoxes, filteredUserBoxes, showFrameFilter, userBoxes.length, userFrameFilter, videoTrackPanel]);

  const selectBox = (box: Annotation | AiBox, shift: boolean | undefined) => {
    if (!shift) {
      const frame = firstTrackFrame(box);
      if (frame !== null) onSeekFrame?.(frame);
    }
    onSelect(box.id, { shift: !!shift });
  };

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      const row = rows[i];
      if (row?.kind === "header") return row.showFrameFilter ? 62 : 36;
      if (row?.kind === "videoTracks") return 420;
      return 68;
    },
    overscan: 8,
  });

  // 滚到接近末尾时自动加载下一页（仅 AI 段尚有未加载）
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    if (!items.length || !hasMore || isFetchingMore || !onFetchMore) return;
    const aiEndIndex = aiBoxes.length;
    const visibleAiNearEnd = aiBoxes.length > 0 && items.some(
      (item) => item.index <= aiEndIndex && item.index >= Math.max(1, aiBoxes.length - 4),
    );
    if (visibleAiNearEnd) onFetchMore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hasMore, isFetchingMore, aiBoxes.length]);
  return (
    <div ref={parentRef} className={styles.boxesScroller}>
      <div
        className={styles.virtualList}
        ref={(node) => {
          node?.style.setProperty("--ai-inspector-list-height", `${virtualizer.getTotalSize()}px`);
        }}
      >
        {items.map((vItem) => {
          const r = rows[vItem.index];
          if (!r) return null;
          return (
            <div
              key={r.key}
              data-index={vItem.index}
              ref={(node) => {
                virtualizer.measureElement(node);
                node?.style.setProperty("--ai-inspector-row-y", `${vItem.start}px`);
              }}
              className={styles.virtualRow}
            >
              {r.kind === "ai" && (
                <BoxListItem
                  b={r.box} isAi
                  selected={selSet.has(r.box.id)}
                  dimmed={dimmedAiIds?.has(r.box.id) ?? false}
                  imageWidth={imageWidth} imageHeight={imageHeight}
                  onSelect={(e) => selectBox(r.box, e?.shiftKey)}
                  onAccept={() => onAcceptPrediction(r.box)}
                  onReject={() => {
                    onRejectPrediction?.(r.box);
                    onClearSelection();
                  }}
                  onRefine={onRefinePrediction && r.box.geometry?.type === "polygon"
                    ? () => onRefinePrediction(r.box)
                    : undefined}
                />
              )}
              {r.kind === "header" && (
                <div className={styles.listHeaderCard}>
                  <div className={styles.listHeaderRow}>
                    <span className={styles.listHeaderLabel}>{r.label}</span>
                    <span className={cn("mono", styles.listHeaderCount)}>
                      {r.showFrameFilter && r.filter === "current" ? `${r.count}/${r.totalCount}` : r.count}
                    </span>
                  </div>
                  {r.showFrameFilter && (
                    <FrameFilterTabs value={r.filter} onChange={r.onFilterChange} />
                  )}
                </div>
              )}
              {r.kind === "videoTracks" && (
                <div data-testid="video-track-panel-row">
                  {videoTrackPanel}
                </div>
              )}
              {r.kind === "user" && (
                <BoxListItem
                  b={r.box}
                  selected={selSet.has(r.box.id)}
                  imageWidth={imageWidth} imageHeight={imageHeight}
                  onSelect={(e) => selectBox(r.box, e?.shiftKey)}
                  onDelete={() => onDeleteUserBox(r.box.id)}
                  onChangeClass={onChangeUserBoxClass ? () => onChangeUserBoxClass(r.box.id) : undefined}
                  onToggleFlag={onToggleUserBoxFlag ? (flag) => onToggleUserBoxFlag(r.box.id, flag) : undefined}
                  onRefine={onRefineUserPolygon && r.box.geometry?.type === "polygon"
                    ? () => onRefineUserPolygon(r.box.id)
                    : undefined}
                />
              )}
            </div>
          );
        })}
      </div>
      {(hasMore || isFetchingMore) && (
        <div className={styles.loadMoreFooter}>
          {isFetchingMore ? "加载更多预测..." : (
            <button
              onClick={onFetchMore}
              className={styles.loadMoreButton}
            >加载更多</button>
          )}
        </div>
      )}
    </div>
  );
}

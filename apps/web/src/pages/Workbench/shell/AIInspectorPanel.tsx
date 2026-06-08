import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { VariantSelector } from "@/components/ml/VariantSelector";
import type { MLBackendSupportedVariantGroup } from "@/api/ml-backends";
import type { Annotation, AnnotationResponse } from "@/types";
import type { AttributeSchema } from "@/api/projects";
import type { CapabilityWarning } from "../state/useCapabilityValidation";
import {
  PREDICTION_SOURCE_FILTERS,
  predictionSourceLabel,
  type AiBox,
  type PredictionSourceCounts,
  type PredictionSourceFilter,
  type PredictionSourceVisibility,
} from "../state/transforms";
import { BoxListItem } from "../stage/BoxListItem";
import { groupOutlineColor } from "../stage/ImageStageShapes";
import { resolveTrackAtFrame } from "../stage/videoStageGeometry";
import { isFrameOutside } from "../stage/videoTrackOutside";
import { displayClassName } from "../stage/colors";
import { AttributeForm, getMissingRequired } from "./AttributeForm";
import { SchemaForm, VARIANT_FIELD_KEYS, type JsonSchemaObject } from "../components/SchemaForm";
import styles from "./AIInspectorPanel.module.css";

interface AIInspectorPanelProps {
  open: boolean;
  /** 受控宽度（仅 open=true 生效）。 */
  width: number;
  onResize: (w: number) => void;
  aiBoxes: AiBox[];
  predictionSourceFilter?: PredictionSourceFilterState;
  userBoxes: Annotation[];
  orphanUserBoxIds?: Set<string>;
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
  /**
   * v0.10.20 · I12 多选批量编辑回调; 多选时 AttributeForm.onChange 改走此路径调用 useAnnotationBulkUpdate.
   * 不传时多选只显示 batch banner, 但 onChange 仍按单条 PATCH 走 (退化兼容).
   */
  onBulkUpdateAttributes?: (
    ids: string[],
    patch: { attributes?: Record<string, unknown> },
  ) => void;
  /** v0.10.20 · I12 BoxList group card 头部单击 → 整组选中 (replaceSelected). */
  onSelectGroup?: (memberIds: string[]) => void;
  hasMorePredictions?: boolean;
  isFetchingMorePredictions?: boolean;
  onFetchMorePredictions?: () => void;
  currentFrameIndex?: number;
  onSeekFrame?: (frameIndex: number) => void;
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
  /** v0.10.5 M4-β · I15 切换 shape 状态位（lock/hidden）。 */
  onToggleUserBoxFlag?: (id: string, flag: "is_locked" | "is_hidden") => void;
  /** v0.6.5 · 任务已锁定（review/completed），属性表单只读。 */
  readOnly?: boolean;
  videoTrackPanel?: React.ReactNode | ((frameFilter: FrameFilter) => React.ReactNode);
  /** v0.13.10 · 分离为同窗口浮窗，由 WorkbenchLayout 负责实际渲染分支。 */
  onDetach?: () => void;
  floating?: boolean;
  /** v0.14.9 · active model 与项目配置的兼容性警告 (非阻断)；空时不渲染。 */
  capabilityWarnings?: CapabilityWarning[];
}

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

interface PredictionSourceFilterState {
  visibility: PredictionSourceVisibility;
  counts: PredictionSourceCounts;
  totalCount: number;
  onToggle: (source: PredictionSourceFilter, visible: boolean) => void;
}

export function AIInspectorPanel({
  // v0.11.5+ · width/onResize 仍在 props 接口里，但列宽拖拽 handle 已上移到
  // WorkbenchLayout 的 .rightSplit（全高），故此处不再渲染/解构它们。
  open,
  aiBoxes,
  predictionSourceFilter,
  userBoxes, orphanUserBoxIds, selectedId, selectedIds,
  dimmedAiIds,
  imageWidth, imageHeight,
  attributeSchema, selectedAnnotation, onUpdateAttributes,
  onBulkUpdateAttributes, onSelectGroup,
  hasMorePredictions, isFetchingMorePredictions, onFetchMorePredictions,
  currentFrameIndex, onSeekFrame,
  onSelect, onAcceptPrediction, onRejectPrediction, onRefinePrediction, onRefineUserPolygon,
  onClearSelection, onDeleteUserBox, onChangeUserBoxClass,
  onToggleUserBoxFlag,
  readOnly = false,
  videoTrackPanel,
  onDetach,
  floating = false,
  capabilityWarnings,
}: AIInspectorPanelProps) {
  const selSet = selectedIds && selectedIds.length > 0
    ? new Set(selectedIds)
    : selectedId ? new Set([selectedId]) : new Set<string>();
  const multiCount = selSet.size > 1 ? selSet.size : 0;
  // 底部属性区折叠态（v0.11.28 上下分栏：属性区固定在列表下方，可折叠让出列表空间）。
  const [attrCollapsed, setAttrCollapsed] = useState(false);
  const attrMissing = selectedAnnotation && attributeSchema
    ? getMissingRequired(attributeSchema, selectedAnnotation.class_name, selectedAnnotation.attributes ?? {})
    : [];
  if (!open) {
    return null;
  }

  return (
    <div className={floating ? `${styles.panel} ${styles.panelFloating}` : styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelHeaderRow}>
          <b className={styles.panelTitle}>标注详情</b>
          {onDetach && (
            <button
              type="button"
              className={styles.detachButton}
              onClick={onDetach}
              aria-label="分离为浮窗"
              title="分离为浮窗"
            >
              <Icon name="pictureInPicture2" size={14} />
            </button>
          )}
        </div>
      </div>

      {capabilityWarnings && capabilityWarnings.length > 0 && (
        <div className={styles.capabilityWarnings} data-testid="ai-inspector-capability-warnings">
          {capabilityWarnings.map((w) => (
            <div key={w.key} className={styles.capabilityWarningItem}>
              <Icon name="warning" size={11} />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {multiCount > 0 && (
        <div className={styles.multiSelectionBar}>
          <span>已选 <b>{multiCount}</b> 个 user 框</span>
          <button onClick={onClearSelection} className={styles.clearSelectionButton}>清除</button>
        </div>
      )}

      <BoxesList
        aiBoxes={aiBoxes}
        predictionSourceFilter={predictionSourceFilter}
        userBoxes={userBoxes}
        orphanUserBoxIds={orphanUserBoxIds}
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
        onSelectGroup={onSelectGroup}
        videoTrackPanel={videoTrackPanel}
      />
      {/* 视频任务的属性由 VideoTrackPanel 内的两层 VideoAttributesEditor 承载，此处仅图片任务渲染。 */}
      {!videoTrackPanel && selectedAnnotation && attributeSchema && onUpdateAttributes && (
        <div className={styles.attrDock}>
          <button
            type="button"
            className={styles.attrDockHeader}
            onClick={() => setAttrCollapsed((v) => !v)}
            aria-expanded={!attrCollapsed}
            title={attrCollapsed ? "展开属性" : "折叠属性"}
          >
            <Icon name={attrCollapsed ? "chevRight" : "chevDown"} size={13} />
            <span>属性</span>
            {attrMissing.length > 0 && (
              <span className={styles.attrDockMissing}>· {attrMissing.length} 项必填未填</span>
            )}
            <span className={styles.attrDockClass}>{displayClassName(selectedAnnotation.class_name)}</span>
          </button>
          {!attrCollapsed && (
            <div className={styles.attrDockBody}>
              <AttributeForm
                schema={attributeSchema}
                className={selectedAnnotation.class_name}
                attributes={selectedAnnotation.attributes ?? {}}
                // v0.10.20 · I12 多选批量: 有 onBulkUpdateAttributes 且选中 >1 时 fan-out, 否则单条 PATCH.
                onChange={(next) => {
                  if (multiCount > 1 && onBulkUpdateAttributes) {
                    onBulkUpdateAttributes(Array.from(selSet), { attributes: next });
                  } else {
                    onUpdateAttributes(selectedAnnotation.id, next);
                  }
                }}
                batchCount={multiCount > 1 ? multiCount : undefined}
                readOnly={readOnly}
                hideHeading
              />
            </div>
          )}
        </div>
      )}
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
  // v0.10.23 · 设计 B · 文本输入段下沉到 AIToolDrawer; popover 不再承载 SAM 文本提示控件.
  taskAiCost?: number;
  taskAiAvgMs?: number | null;
  taskAiPredictionCount?: number;
  // v0.10.23 · 会话级模型变体选择 (设计 A): 选项来自 /setup.params 的 sam_variant/dino_variant enum.
  paramsSchema?: JsonSchemaObject;
  supportedVariants?: MLBackendSupportedVariantGroup[];
  // v0.14.12 · 多轴非笛卡尔积时声明合法组合 (yolo series/size); 缺省时按笛卡尔积渲染.
  variantCombinations?: string[][];
  // v0.14.13 · backend / 项目级合并后的默认 variant 组合, 传给 VariantSelector 作初值.
  variantDefaults?: Record<string, string>;
  aiVariant?: Record<string, unknown>;
  onSetAiVariant?: (next: Record<string, unknown>) => void;
  // 后端级推理参数 (阈值等非变体字段): SchemaForm 渲染。值/回调即 workbench 的 aiToolParams。
  params?: Record<string, unknown>;
  onSetParams?: (next: Record<string, unknown>) => void;
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
  taskAiCost,
  taskAiAvgMs,
  taskAiPredictionCount,
  paramsSchema,
  supportedVariants,
  variantCombinations,
  variantDefaults,
  aiVariant,
  onSetAiVariant,
  params,
  onSetParams,
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

  const hasVariantSelector =
    (supportedVariants ?? []).some((group) => (group.variants ?? []).length > 0) ||
    Object.keys(paramsSchema?.properties ?? {}).some(
      (k) => VARIANT_FIELD_KEYS.includes(k as (typeof VARIANT_FIELD_KEYS)[number]),
    );

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
            <span className={styles.mutedText}>置信度阈值</span>
            <span className={cn("mono", styles.thresholdValue)}>{(confThreshold * 100).toFixed(0)}%</span>
          </div>
          <div className={styles.thresholdHint}>
            过滤批量预标注结果：仅显示并采纳置信度 ≥ 此值的 AI 框，低于的隐藏且「全部采纳」也不纳入。
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

      {/* v0.10.23 · 设计 A · 会话级模型变体选择 (切工具不丢); /setup.params 无变体字段时整段隐藏. */}
      {onSetAiVariant && hasVariantSelector && (
        <div className={styles.variantSelector}>
          <VariantSelector
            schema={paramsSchema}
            supportedVariants={supportedVariants}
            variantCombinations={variantCombinations}
            defaults={variantDefaults}
            value={aiVariant ?? {}}
            onChange={onSetAiVariant}
          />
        </div>
      )}

      {/* 后端级推理参数 (阈值等非变体字段)。SchemaForm 内部已排除 variant 字段, 不与上方变体选择器重复;
          无非变体可调字段时整段隐藏 (避免空白容器)。 */}
      {onSetParams &&
        paramsSchema &&
        Object.keys(paramsSchema.properties ?? {}).some(
          (k) => !VARIANT_FIELD_KEYS.includes(k as (typeof VARIANT_FIELD_KEYS)[number]),
        ) && (
          <div className={styles.aiParamsForm}>
            <SchemaForm schema={paramsSchema} value={params ?? {}} onChange={onSetParams} />
          </div>
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

// ── I12 · Object Group 折叠卡片 ────────────────────────────────────────────
interface GroupCardProps {
  groupId: number;
  memberCount: number;
  expanded: boolean;
  onToggle: () => void;
  onSelectGroup?: () => void;
}

function GroupCard({ groupId, memberCount, expanded, onToggle, onSelectGroup }: GroupCardProps) {
  const color = groupOutlineColor(groupId);
  return (
    <div
      className={styles.groupCard}
      data-testid={`box-list-group-card-${groupId}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className={styles.groupCardToggle}
        title={expanded ? "折叠组" : "展开组"}
      >
        <Icon name={expanded ? "chevDown" : "chevRight"} size={14} />
      </button>
      <button
        type="button"
        onClick={onSelectGroup}
        disabled={!onSelectGroup}
        className={styles.groupCardHeader}
        title="选中整组"
      >
        <span
          className={styles.groupCardDot}
          ref={(node) => node?.style.setProperty("--group-color", color)}
        />
        <span>组 #{groupId}</span>
        <span className={styles.groupCardCount}>· {memberCount} 个标注</span>
      </button>
    </div>
  );
}

// ── 虚拟化合并列表 ─────────────────────────────────────────────────────────
type Row =
  | { kind: "ai"; box: AiBox; key: string }
  | { kind: "frameFilter"; filter: FrameFilter; key: string; onFilterChange: (filter: FrameFilter) => void }
  | { kind: "sourceFilter"; filter: PredictionSourceFilterState; key: string }
  | {
    kind: "header";
    count: number;
    totalCount: number;
    key: string;
    label: string;
  }
  | { kind: "videoTracks"; key: string }
  /** v0.10.20 · I12 同 group_id 折叠卡片头部. 单击 → 整组选中. 展开 → 下方插入 user 行. */
  | {
    kind: "userGroup";
    groupId: number;
    memberIds: string[];
    expanded: boolean;
    onToggle: () => void;
    key: string;
  }
  | { kind: "user"; box: Annotation; key: string };

type FrameFilter = "all" | "current";

function boxIsOnFrame(box: Annotation | AiBox, frameIndex: number) {
  const geometry = box.geometry;
  if (!geometry) return true;
  if (geometry.type === "video_bbox") return geometry.frame_index === frameIndex;
  if (geometry.type === "video_track_bbox") return resolveTrackAtFrame(geometry, frameIndex) !== null;
  return true;
}

function firstTrackFrame(box: Annotation | AiBox): number | null {
  const geometry = box.geometry;
  if (!geometry) return null;
  if (geometry.type === "video_bbox") return geometry.frame_index;
  if (geometry.type !== "video_track_bbox" || geometry.keyframes.length === 0) return null;
  const visible = geometry.keyframes.filter((kf) => !isFrameOutside(geometry, kf.frame_index));
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

function PredictionSourceFilterCard({ filter }: { filter: PredictionSourceFilterState }) {
  return (
    <div className={styles.sourceFilterCard} aria-label="预测来源筛选">
      <span className={styles.sourceFilterLabel}>
        <Icon name="filter" size={12} />来源
      </span>
      <div className={styles.sourceFilterControls}>
        {PREDICTION_SOURCE_FILTERS.map((source) => {
          const checked = filter.visibility[source];
          const count = filter.counts[source];
          const label = predictionSourceLabel(source);
          return (
            <label
              key={source}
              className={cn(
                styles.sourceFilterOption,
                checked && styles.sourceFilterOptionActive,
                source === "external_import" && styles.sourceFilterOptionImport,
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={count === 0}
                onChange={(e) => filter.onToggle(source, e.currentTarget.checked)}
                className={styles.sourceFilterCheckbox}
              />
              <Icon name={source === "ml_backend" ? "sparkle" : "upload"} size={11} />
              <span>{label}</span>
              <span className={cn("mono", styles.sourceFilterCount)}>{count}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

interface BoxesListProps {
  aiBoxes: AiBox[];
  predictionSourceFilter?: PredictionSourceFilterState;
  userBoxes: Annotation[];
  orphanUserBoxIds?: Set<string>;
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
  /** v0.10.5 M4-β · I15 切换 shape 状态位（lock/hidden）。 */
  onToggleUserBoxFlag?: (id: string, flag: "is_locked" | "is_hidden") => void;
  onSeekFrame?: (frameIndex: number) => void;
  onSelectGroup?: (memberIds: string[]) => void;
  videoTrackPanel?: React.ReactNode | ((frameFilter: FrameFilter) => React.ReactNode);
}

function BoxesList({
  aiBoxes, predictionSourceFilter, userBoxes, orphanUserBoxIds, selSet, dimmedAiIds, imageWidth, imageHeight,
  hasMore, isFetchingMore, onFetchMore,
  currentFrameIndex,
  onSeekFrame,
  onSelect, onAcceptPrediction, onRejectPrediction, onRefinePrediction, onRefineUserPolygon,
  onClearSelection, onDeleteUserBox, onChangeUserBoxClass,
  onToggleUserBoxFlag,
  onSelectGroup,
  videoTrackPanel,
}: BoxesListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [frameFilter, setFrameFilter] = useState<FrameFilter>("all");
  const showFrameFilter = typeof currentFrameIndex === "number";
  // v0.10.20 · I12 group 折叠态. v0.10.21 反转语义: 默认展开 (B-44 反馈 "不能展开"
  // 实为 chevron icon 名写错导致按钮看不到); 用 collapsedGroups 记 *显式收起* 的组,
  // 默认空集 = 所有组都展开 + 成员可见.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());
  const toggleGroup = (groupId: number) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  const resolvedVideoTrackPanel = useMemo(
    () => typeof videoTrackPanel === "function" ? videoTrackPanel(frameFilter) : videoTrackPanel,
    [frameFilter, videoTrackPanel],
  );

  const filteredAiBoxes = useMemo(
    () => filterBoxesByFrame(aiBoxes, currentFrameIndex, frameFilter),
    [aiBoxes, currentFrameIndex, frameFilter],
  );
  const filteredUserBoxes = useMemo(
    () => filterBoxesByFrame(userBoxes, currentFrameIndex, frameFilter),
    [userBoxes, currentFrameIndex, frameFilter],
  );

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const aiTotalCount = predictionSourceFilter?.totalCount ?? aiBoxes.length;
    if (showFrameFilter && (aiTotalCount > 0 || userBoxes.length > 0 || resolvedVideoTrackPanel)) {
      out.push({ kind: "frameFilter", key: "frame-filter", filter: frameFilter, onFilterChange: setFrameFilter });
    }
    if (aiTotalCount > 0) {
      const hasKnownPredictionSources = predictionSourceFilter
        ? PREDICTION_SOURCE_FILTERS.some((source) => predictionSourceFilter.counts[source] > 0)
        : false;
      out.push({
        kind: "header",
        label: "AI 待审",
        count: filteredAiBoxes.length,
        totalCount: aiTotalCount,
        key: "ai-header",
      });
      if (predictionSourceFilter && hasKnownPredictionSources) {
        out.push({ kind: "sourceFilter", key: "prediction-source-filter", filter: predictionSourceFilter });
      }
      filteredAiBoxes.forEach((b) => out.push({ kind: "ai", box: b, key: `ai-${b.id}` }));
    }
    if (userBoxes.length > 0) {
      out.push({
        kind: "header",
        label: "人工",
        count: filteredUserBoxes.length,
        totalCount: userBoxes.length,
        key: "user-header",
      });
    }
    // v0.10.20 · I12 按 group_id 分桶: 同 group_id (≥2 个成员) → group 卡片头, 展开时下方插入 user 行;
    // group_id null 或单成员 group → 平铺. 保持 filteredUserBoxes 原顺序内的相对位置.
    const bucketed: { groupId: number | null; boxes: Annotation[] }[] = [];
    const groupBuckets = new Map<number, Annotation[]>();
    for (const b of filteredUserBoxes) {
      if (typeof b.group_id === "number") {
        if (!groupBuckets.has(b.group_id)) {
          groupBuckets.set(b.group_id, []);
          bucketed.push({ groupId: b.group_id, boxes: groupBuckets.get(b.group_id)! });
        }
        groupBuckets.get(b.group_id)!.push(b);
      } else {
        bucketed.push({ groupId: null, boxes: [b] });
      }
    }
    for (const bucket of bucketed) {
      if (bucket.groupId != null && bucket.boxes.length >= 2) {
        const gid = bucket.groupId;
        const expanded = !collapsedGroups.has(gid);
        out.push({
          kind: "userGroup",
          groupId: gid,
          memberIds: bucket.boxes.map((b) => b.id),
          expanded,
          onToggle: () => toggleGroup(gid),
          key: `user-group-${gid}`,
        });
        if (expanded) {
          bucket.boxes.forEach((b) => out.push({ kind: "user", box: b, key: `user-${b.id}` }));
        }
      } else {
        bucket.boxes.forEach((b) => out.push({ kind: "user", box: b, key: `user-${b.id}` }));
      }
    }
    if (resolvedVideoTrackPanel) out.push({ kind: "videoTracks", key: "video-track-panel" });
    return out;
  }, [aiBoxes.length, filteredAiBoxes, filteredUserBoxes, frameFilter, predictionSourceFilter, showFrameFilter, userBoxes.length, resolvedVideoTrackPanel, collapsedGroups]);

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
      if (row?.kind === "frameFilter") return 38;
      if (row?.kind === "sourceFilter") return 48;
      if (row?.kind === "header") return 36;
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
                      {showFrameFilter && frameFilter === "current" ? `${r.count}/${r.totalCount}` : r.count}
                    </span>
                  </div>
                </div>
              )}
              {r.kind === "frameFilter" && (
                <div className={styles.frameFilterCard}>
                  <span className={styles.frameFilterLabel}>显示范围</span>
                  <FrameFilterTabs value={r.filter} onChange={r.onFilterChange} />
                </div>
              )}
              {r.kind === "sourceFilter" && (
                <PredictionSourceFilterCard filter={r.filter} />
              )}
              {r.kind === "videoTracks" && (
                <div data-testid="video-track-panel-row">
                  {resolvedVideoTrackPanel}
                </div>
              )}
              {r.kind === "userGroup" && (
                <GroupCard
                  groupId={r.groupId}
                  memberCount={r.memberIds.length}
                  expanded={r.expanded}
                  onToggle={r.onToggle}
                  onSelectGroup={onSelectGroup ? () => onSelectGroup(r.memberIds) : undefined}
                />
              )}
              {r.kind === "user" && (
                <BoxListItem
                  b={r.box}
                  orphan={orphanUserBoxIds?.has(r.box.id) ?? false}
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

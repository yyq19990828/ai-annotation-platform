import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { Annotation, AnnotationResponse } from "@/types";
import { filterBoxesByFrame, firstTrackFrame, type FrameFilter } from "./annotationFrameScope";
import type { AttributeField, AttributeSchema } from "@/api/projects";
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
import type { RasterMaskRecordStatus } from "../stage/shared/useRasterMaskRecords";
import { displayClassName } from "../stage/colors";
import { AttributeForm, getMissingRequired } from "./AttributeForm";
import { PreannotateConfigForm } from "@/pages/AIPreAnnotate/components/PreannotateConfigForm";
import { type PreannotateConfig } from "@/pages/AIPreAnnotate/components/usePreannotateConfig";
import { SIDE_FLOATING_PANEL_MIN_SIZE, SIDE_FLOATING_PANEL_MAX_SIZE } from "./floatingPanelSizing";
import {
  AI_PANEL_HEADER_CLASS,
  AI_PANEL_ICON_CLASS,
  AI_PANEL_SECTION_CLASS,
  AI_PANEL_SURFACE_CLASS,
} from "./workbenchAiPanelChrome";

// 卡片化分组头（AI 待审 / 人工 等列表分段头）与筛选卡共用的容器外观。
const SECTION_CARD_CLASS =
  "mb-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-foreground";

interface AIInspectorPanelProps {
  open: boolean;
  /** 受控宽度（仅 open=true 生效；列宽 handle 实际由 WorkbenchLayout 渲染）。 */
  width: number;
  onResize: (w: number) => void;
  /** v0.20.19 · 属性区折叠态 (受控, 走 workbench.layout 持久); 缺省回落组件内会话态。 */
  attrCollapsed?: boolean;
  onToggleAttrCollapsed?: () => void;
  /** v0.20.22 · AI 待审 / 人工两大分组的折叠态 (受控, 走 workbench.layout 持久)。
   *  与 BoxesList 内部的 `collapsedGroups` (人工段内的子组/GroupCard 折叠) 命名区分:
   *  这里控制的是"两大分组头"整体折叠。缺省 = 展开。 */
  aiSectionCollapsed?: boolean;
  onToggleAiSection?: () => void;
  manualSectionCollapsed?: boolean;
  onToggleManualSection?: () => void;
  /** 列宽 handle 的像素边界与双击重置值(由 WorkbenchLayout 的 ResizeHandle 消费;随窗口宽度动态)。 */
  widthMin?: number;
  widthMax?: number;
  widthResetTo?: number;
  aiBoxes: AiBox[];
  predictionSourceFilter?: PredictionSourceFilterState;
  userBoxes: Annotation[];
  rasterMaskStatusById?: ReadonlyMap<string, RasterMaskRecordStatus>;
  onRetryRasterMask?: (id: string) => void;
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
  onBulkUpdateAttributes?: (ids: string[], patch: { attributes?: Record<string, unknown> }) => void;
  hasMorePredictions?: boolean;
  isFetchingMorePredictions?: boolean;
  onFetchMorePredictions?: () => void;
  currentFrameIndex?: number;
  onSeekFrame?: (frameIndex: number) => void;
  /** Shift+click 进入多选；普通 click 单选。 */
  onSelect: (id: string, opts?: { shift?: boolean }) => void;
  onAcceptPrediction: (b: AiBox, attributeOverrides?: Record<string, unknown>) => void;
  onRejectPrediction?: (b: AiBox) => void;
  /** v0.10.8 · I11 · polygon 候选行展示「精修」按钮 → 启动 Mask 编辑器。 */
  onRefinePrediction?: (b: AiBox) => void;
  /** v0.10.9 · 已落库 user polygon 行展示「精修」按钮 → 启动 Mask 编辑器（update mutation）。 */
  onRefineUserPolygon?: (annotationId: string) => void;
  onEditRasterMask?: (annotationId: string) => void;
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
  /**
   * v0.20.2 · 「采纳后该属性将丢失」警告的一键补全回调: 把 model 自报字段补进项目所有启用工具单位。
   * 仅 warning.fillable 存在时渲染 CTA; 缺省 = 不渲染补全按钮。
   */
  onFillAttribute?: (field: AttributeField) => void;
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
  userBoxes,
  orphanUserBoxIds,
  rasterMaskStatusById,
  onRetryRasterMask,
  selectedId,
  selectedIds,
  dimmedAiIds,
  imageWidth,
  imageHeight,
  attributeSchema,
  selectedAnnotation,
  onUpdateAttributes,
  onBulkUpdateAttributes,
  hasMorePredictions,
  isFetchingMorePredictions,
  onFetchMorePredictions,
  currentFrameIndex,
  onSeekFrame,
  onSelect,
  onAcceptPrediction,
  onRejectPrediction,
  onRefinePrediction,
  onRefineUserPolygon,
  onEditRasterMask,
  onClearSelection,
  onDeleteUserBox,
  onChangeUserBoxClass,
  onToggleUserBoxFlag,
  readOnly = false,
  videoTrackPanel,
  onDetach,
  floating = false,
  capabilityWarnings,
  onFillAttribute,
  attrCollapsed: attrCollapsedProp,
  onToggleAttrCollapsed,
  aiSectionCollapsed = false,
  onToggleAiSection,
  manualSectionCollapsed = false,
  onToggleManualSection,
}: AIInspectorPanelProps) {
  const selSet =
    selectedIds && selectedIds.length > 0
      ? new Set(selectedIds)
      : selectedId
        ? new Set([selectedId])
        : new Set<string>();
  const multiCount = selSet.size > 1 ? selSet.size : 0;
  // 底部属性区折叠态（v0.11.28 上下分栏：属性区固定在列表下方，可折叠让出列表空间）。
  // v0.20.19 · 受控优先(走 workbench.layout 持久), 缺省回落组件内会话态(测试/独立使用)。
  const [attrCollapsedLocal, setAttrCollapsedLocal] = useState(false);
  const attrCollapsed = attrCollapsedProp ?? attrCollapsedLocal;
  const toggleAttrCollapsed = onToggleAttrCollapsed ?? (() => setAttrCollapsedLocal((v) => !v));
  const attrMissing =
    selectedAnnotation && attributeSchema
      ? getMissingRequired(
          attributeSchema,
          selectedAnnotation.class_name,
          selectedAnnotation.attributes ?? {},
        )
      : [];
  // v0.18.0 · 采纳前预览: 选中单个 AI 候选 (未落库, selectedAnnotation 为空) 且其携带属性时,
  // 在底部用 AttributeForm 展示二阶段 backend 写入的 attributes (经 schema options 解析为中文)。
  const selectedAiBox =
    !selectedAnnotation && selSet.size === 1
      ? (aiBoxes.find((b) => selSet.has(b.id)) ?? null)
      : null;
  // v0.18.3 · 候选属性审阅 + 分步采纳: 预览改为可编辑, 改动存本地 state (按 box id 重置),
  // 采纳时经 onAcceptPrediction 的 attributeOverrides 把改后值原子落库 (而非一步全采纳原值)。
  const [editedAiBoxAttrs, setEditedAiBoxAttrs] = useState<Record<string, unknown> | null>(null);
  const editedBoxIdRef = useRef<string | null>(null);
  if (selectedAiBox?.id !== editedBoxIdRef.current) {
    editedBoxIdRef.current = selectedAiBox?.id ?? null;
    // 选中的候选框变化 → 丢弃上一个的草稿改动 (渲染期同步重置, 无需 effect)。
    if (editedAiBoxAttrs !== null) setEditedAiBoxAttrs(null);
  }
  const aiBoxAttrs =
    selectedAiBox?.attributes && Object.keys(selectedAiBox.attributes).length > 0
      ? { ...selectedAiBox.attributes, ...(editedAiBoxAttrs ?? {}) }
      : null;

  // v0.20.22 · 属性审阅"采纳"按钮退役 (与列表行采纳入口重复); 表单保持可编辑,
  // 行内采纳时自动带上审阅改动。仅当被采纳候选 === 当前审阅中的候选且 editedAiBoxAttrs 非空
  // 时附带; 未编辑时保持传 undefined, 避免多发一次空 dict 让下游/接口日志产生噪音。
  // 画布贴框采纳 (SelectionOverlay/BoxRenderer 走 ImageStage.onAcceptPrediction 1-arg 版本)
  // 拿不到该本地 state, 维持采纳原值 (计划内不上提 state)。
  const acceptWithReviewEdits = (box: AiBox, overrides?: Record<string, unknown>) => {
    const shouldAttachReviewEdits =
      box.id === selectedAiBox?.id &&
      editedAiBoxAttrs !== null &&
      Object.keys(editedAiBoxAttrs).length > 0;
    if (shouldAttachReviewEdits) {
      onAcceptPrediction(box, { ...editedAiBoxAttrs, ...(overrides ?? {}) });
    } else {
      onAcceptPrediction(box, overrides);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden bg-card",
        floating ? "border-l-0" : "border-l border-border",
      )}
    >
      <div className="border-b border-border bg-card px-3.5 py-3">
        <div className="flex items-center justify-between">
          <b className="text-sm">标注详情</b>
          {onDetach && (
            <button
              type="button"
              className="inline-flex size-6 cursor-pointer appearance-none items-center justify-center rounded-sm border border-border bg-background p-0 text-muted-foreground hover:border-brand hover:text-brand"
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
        <div
          className="flex flex-col gap-1 border-b border-border bg-status-caution-soft px-3 py-2"
          data-testid="ai-inspector-capability-warnings"
        >
          {capabilityWarnings.map((w) => (
            <div
              key={w.key}
              className="flex items-start gap-1.5 text-xs leading-[1.4] text-status-caution"
            >
              <Icon name="warning" size={11} />
              <span>{w.message}</span>
              {w.fillable && onFillAttribute && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onFillAttribute(w.fillable!)}
                  title="把该属性字段补进项目所有启用工具单位"
                >
                  一键补全
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {multiCount > 0 && (
        <div className="flex items-center justify-between border-b border-border bg-brand/10 px-3.5 py-1.5 text-xs text-brand">
          <span>
            已选 <b>{multiCount}</b> 个 user 框
          </span>
          <button
            onClick={onClearSelection}
            className="cursor-pointer appearance-none rounded-[3px] border border-border bg-transparent px-1.5 py-px text-2xs text-muted-foreground"
          >
            清除
          </button>
        </div>
      )}

      <BoxesList
        aiBoxes={aiBoxes}
        predictionSourceFilter={predictionSourceFilter}
        userBoxes={userBoxes}
        orphanUserBoxIds={orphanUserBoxIds}
        rasterMaskStatusById={rasterMaskStatusById}
        onRetryRasterMask={onRetryRasterMask}
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
        onAcceptPrediction={acceptWithReviewEdits}
        onRejectPrediction={onRejectPrediction}
        onRefinePrediction={onRefinePrediction}
        onRefineUserPolygon={onRefineUserPolygon}
        onEditRasterMask={onEditRasterMask}
        readOnly={readOnly}
        onClearSelection={onClearSelection}
        onDeleteUserBox={onDeleteUserBox}
        onChangeUserBoxClass={onChangeUserBoxClass}
        onToggleUserBoxFlag={onToggleUserBoxFlag}
        videoTrackPanel={videoTrackPanel}
        aiSectionCollapsed={aiSectionCollapsed}
        onToggleAiSection={onToggleAiSection}
        manualSectionCollapsed={manualSectionCollapsed}
        onToggleManualSection={onToggleManualSection}
      />
      {/* 视频任务的属性由 VideoTrackPanel 内的两层 VideoAttributesEditor 承载，此处仅图片任务渲染。 */}
      {!videoTrackPanel && selectedAnnotation && attributeSchema && onUpdateAttributes && (
        <div className="flex max-h-[45%] flex-[0_0_auto] flex-col border-t border-border bg-card">
          <button
            type="button"
            className="flex w-full cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent px-3.5 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted"
            onClick={toggleAttrCollapsed}
            aria-expanded={!attrCollapsed}
            title={attrCollapsed ? "展开属性" : "折叠属性"}
          >
            <Icon name={attrCollapsed ? "chevRight" : "chevDown"} size={13} />
            <span>属性</span>
            {attrMissing.length > 0 && (
              <span className="text-xs font-normal text-status-caution">
                · {attrMissing.length} 项必填未填
              </span>
            )}
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {displayClassName(selectedAnnotation.class_name)}
            </span>
          </button>
          {!attrCollapsed && (
            <div className="overflow-y-auto pb-1">
              <AttributeForm
                schema={attributeSchema}
                className={selectedAnnotation.class_name}
                attributes={selectedAnnotation.attributes ?? {}}
                attributesMeta={selectedAnnotation.attributes_meta}
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

      {/* v0.18.0 · 候选属性预览; v0.18.3 · 可编辑 + 分步采纳: 审阅多阶段预标产出的属性, 改后再采纳。 */}
      {!videoTrackPanel && aiBoxAttrs && selectedAiBox && attributeSchema && (
        <div className="flex max-h-[45%] flex-[0_0_auto] flex-col border-t border-border bg-card">
          <button
            type="button"
            className="flex w-full cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent px-3.5 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted"
            onClick={toggleAttrCollapsed}
            aria-expanded={!attrCollapsed}
            title={attrCollapsed ? "展开属性审阅" : "折叠属性审阅"}
          >
            <Icon name={attrCollapsed ? "chevRight" : "chevDown"} size={13} />
            <span>属性审阅</span>
            <span className="text-xs font-normal text-status-info">· 候选</span>
            {editedAiBoxAttrs && Object.keys(editedAiBoxAttrs).length > 0 && (
              <span className="text-xs font-normal text-status-caution">· 已改动</span>
            )}
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {displayClassName(selectedAiBox.cls)}
            </span>
          </button>
          {!attrCollapsed && (
            <div className="overflow-y-auto pb-1">
              <AttributeForm
                schema={attributeSchema}
                className={selectedAiBox.cls}
                attributes={aiBoxAttrs}
                onChange={(next) => setEditedAiBoxAttrs(next)}
                readOnly={readOnly}
                hideHeading
              />
              {/* v0.20.22 · 采纳按钮退役 (与列表行/画布采纳入口重复);
                  行内/画布点采纳时 wrapper 自动带上此处改动 (仅列表行, 画布保持原值)。 */}
              {!readOnly && (
                <div className="px-3.5 pb-2 pt-1 text-2xs leading-normal text-muted-foreground">
                  改动将随采纳一并落库。
                </div>
              )}
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
  // v0.14.18 · 可缩放 (与浮出边栏一致): null = CSS 默认尺寸; 拖右下角后为显式 w/h.
  size?: { w: number; h: number } | null;
  onSizeChange?: (size: { w: number; h: number }) => void;
  aiModel: string;
  aiRunning: boolean;
  aiBoxCount: number;
  // v0.21.10 · 视频任务时面板做单帧检测 (方案 a); 留一句指引告诉找整段追踪的用户去哪跑。
  isVideoTask?: boolean;
  confThreshold: number;
  aiTakeoverRate: number;
  onClose: () => void;
  onRunAi: () => void;
  // v0.18.28 · 项目存了编排 (v0.18.27) 时多出「运行当前题（按项目编排）」入口。
  // popover 仍是执行器、非编排编辑器: 编排在 /ai-pre 定义, 这里只把它跑当前一图。
  hasProjectPipeline?: boolean;
  projectPipelineStageCount?: number;
  // claude[bot] P1 #5 · 编排可执行 (引用的 backend 都还在); false 时按钮禁用 + 提示。
  projectPipelineRunnable?: boolean;
  pipelineMissingBackendCount?: number;
  onRunPipeline?: () => void;
  onAcceptAll: () => void;
  onSetConfThreshold: (v: number) => void;
  // v0.10.23 · 设计 B · 文本输入段下沉到 InteractiveToolBar; popover 不再承载 SAM 文本提示控件.
  taskAiCost?: number;
  taskAiAvgMs?: number | null;
  taskAiPredictionCount?: number;
  // 配置区共享状态 (任务类型 / 模型任务 / 类别白名单 / variant / 参数 / prompt); 与批量页同一 hook.
  cfg: PreannotateConfig;
  // 当前选中 variant 是否已 warm (源自 isVariantHot: 单一 hot map, 持久化到 sessionStorage).
  // false → 按钮显示"加载模型中…"给用户冷启动心理预期.
  isVariantWarm?: boolean;
  // 多 backend: 项目绑了 >1 个后端时, 配置区顶部出 backend 选择器 (≤1 项时自动隐藏).
  backends?: Array<{ id: string; name: string }>;
  selectedBackendId?: string | null;
  onSelectBackend?: (id: string | null) => void;
  projectMlBackendId?: string | null;
}

export function AIPredictionPopover({
  open,
  rightOffset,
  position,
  onPositionChange,
  size,
  onSizeChange,
  aiModel,
  aiRunning,
  aiBoxCount,
  isVideoTask,
  confThreshold,
  aiTakeoverRate,
  onClose,
  onRunAi,
  hasProjectPipeline,
  projectPipelineStageCount,
  projectPipelineRunnable = true,
  pipelineMissingBackendCount = 0,
  onRunPipeline,
  onAcceptAll,
  onSetConfThreshold,
  taskAiCost,
  taskAiAvgMs,
  taskAiPredictionCount,
  cfg,
  isVariantWarm: isVariantWarmProp,
  backends,
  selectedBackendId,
  onSelectBackend,
  projectMlBackendId,
}: AIPredictionPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  // 冷启动动态计时: variant 未 warm 且推理中 → 模型正载入显存。模型加载无原生进度
  // 信号(真·逐%拿不到), 故只给"已等 Xs"实时计时 + 静态经验区间, 不做误导性百分比。
  const coldStarting = aiRunning && isVariantWarmProp === false;
  const [coldElapsedSec, setColdElapsedSec] = useState(0);
  useEffect(() => {
    if (!coldStarting) {
      setColdElapsedSec(0);
      return;
    }
    const t0 = Date.now();
    const id = window.setInterval(() => {
      setColdElapsedSec(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [coldStarting]);

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

  // v0.14.18 · 右下角缩放 (与 FloatingPanelShell 同款 UX). 尺寸范围与浮出边栏一致
  // (SIDE_FLOATING_PANEL_MIN/MAX_SIZE), 再按视口可用空间收窄上限.
  const resizeStartRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const handleResizeStart = (evt: React.PointerEvent<HTMLButtonElement>) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    // 默认右侧停靠在开始缩放时转成显式左上坐标，让右下角手柄跟随指针，位置也进入偏好记忆。
    if (!position) onPositionChange({ left: Math.round(rect.left), top: Math.round(rect.top) });
    resizeStartRef.current = { x: evt.clientX, y: evt.clientY, w: rect.width, h: rect.height };
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    evt.preventDefault();
    evt.stopPropagation();
  };
  const handleResizeMove = (evt: React.PointerEvent<HTMLButtonElement>) => {
    const s = resizeStartRef.current;
    if (!s || !onSizeChange) return;
    const rect = panelRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    const minW = SIDE_FLOATING_PANEL_MIN_SIZE.w;
    const minH = SIDE_FLOATING_PANEL_MIN_SIZE.h;
    const maxW = Math.max(
      minW,
      Math.min(SIDE_FLOATING_PANEL_MAX_SIZE.w, window.innerWidth - left - 8),
    );
    const maxH = Math.max(
      minH,
      Math.min(SIDE_FLOATING_PANEL_MAX_SIZE.h, window.innerHeight - top - 8),
    );
    onSizeChange({
      w: Math.round(Math.min(maxW, Math.max(minW, s.w + evt.clientX - s.x))),
      h: Math.round(Math.min(maxH, Math.max(minH, s.h + evt.clientY - s.y))),
    });
  };
  const handleResizeEnd = () => {
    resizeStartRef.current = null;
  };

  useEffect(() => {
    const node = panelRef.current;
    if (!node || !open) return;
    const applyFrame = () => {
      if (position) {
        node.style.removeProperty("--ai-inspector-popover-right");
      } else {
        node.style.setProperty("--ai-inspector-popover-top", "58px");
        node.style.setProperty("--ai-inspector-popover-right", `${rightOffset}px`);
        node.style.removeProperty("--ai-inspector-popover-left");
      }

      const maxAvailableW = Math.max(1, window.innerWidth - 16);
      const maxAvailableH = Math.max(1, window.innerHeight - 16);
      const minW = Math.min(SIDE_FLOATING_PANEL_MIN_SIZE.w, maxAvailableW);
      const minH = Math.min(SIDE_FLOATING_PANEL_MIN_SIZE.h, maxAvailableH);
      const nextSize = size
        ? {
            w: Math.round(
              Math.max(minW, Math.min(size.w, SIDE_FLOATING_PANEL_MAX_SIZE.w, maxAvailableW)),
            ),
            h: Math.round(
              Math.max(minH, Math.min(size.h, SIDE_FLOATING_PANEL_MAX_SIZE.h, maxAvailableH)),
            ),
          }
        : null;

      if (nextSize) {
        node.style.setProperty("--ai-inspector-popover-w", `${nextSize.w}px`);
        node.style.setProperty("--ai-inspector-popover-h", `${nextSize.h}px`);
        if ((nextSize.w !== size?.w || nextSize.h !== size?.h) && onSizeChange) {
          onSizeChange(nextSize);
        }
      } else {
        node.style.removeProperty("--ai-inspector-popover-w");
        node.style.removeProperty("--ai-inspector-popover-h");
      }

      if (position) {
        const rect = node.getBoundingClientRect();
        const nextPosition = {
          left: Math.round(
            Math.max(8, Math.min(position.left, window.innerWidth - rect.width - 8)),
          ),
          top: Math.round(
            Math.max(8, Math.min(position.top, window.innerHeight - rect.height - 8)),
          ),
        };
        node.style.setProperty("--ai-inspector-popover-left", `${nextPosition.left}px`);
        node.style.setProperty("--ai-inspector-popover-top", `${nextPosition.top}px`);
        if (nextPosition.left !== position.left || nextPosition.top !== position.top) {
          onPositionChange(nextPosition);
        }
      }
    };

    applyFrame();
    window.addEventListener("resize", applyFrame);
    return () => window.removeEventListener("resize", applyFrame);
  }, [onPositionChange, onSizeChange, open, position, rightOffset, size]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      data-testid="ai-prediction-popover"
      className={cn(
        AI_PANEL_SURFACE_CLASS,
        "fixed z-popover flex flex-col",
        "h-[var(--ai-inspector-popover-h,auto)] w-[var(--ai-inspector-popover-w,min(360px,calc(100vw-32px)))]",
        "max-h-[calc(100vh-92px)] max-w-[calc(100vw-32px)]",
        position
          ? "top-[var(--ai-inspector-popover-top)] left-[var(--ai-inspector-popover-left)]"
          : "top-[var(--ai-inspector-popover-top)] right-[var(--ai-inspector-popover-right)]",
      )}
    >
      <div
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        className={cn(AI_PANEL_HEADER_CLASS, "cursor-move touch-none")}
        title="拖动 AI 面板"
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={AI_PANEL_ICON_CLASS}>
              <Icon name="bot" size={14} />
            </span>
            <b className="text-sm">当前题 AI</b>
            <Icon name="move" size={12} className="text-muted-foreground" />
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="ai" dot={!aiRunning} className="gap-1 text-2xs">
              {aiRunning && <Icon name="loader2" size={10} className="spin" />}
              {aiRunning ? "推理中" : "就绪"}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              title="关闭当前题 AI"
              className="px-1.5 py-0.5"
            >
              <Icon name="x" size={12} />
            </Button>
          </div>
        </div>
        <div className="mb-2 flex justify-between gap-3 text-xs text-muted-foreground">
          <span>
            本次模型: <span className="font-medium text-foreground">{aiModel}</span>
          </span>
          <span className="mono">{aiBoxCount} 待审</span>
        </div>
        <div className="mb-2.5 flex gap-1.5">
          <Button variant="ai" size="sm" onClick={onRunAi} disabled={aiRunning} className="flex-1">
            {aiRunning ? (
              <Icon name="loader2" size={11} className="spin" />
            ) : (
              <Icon name="wandSparkles" size={11} />
            )}
            {aiRunning
              ? isVariantWarmProp === false
                ? `加载中… 已等 ${coldElapsedSec}s（首次约 5-15s）`
                : "推理中..."
              : "运行当前题"}
          </Button>
          <Button
            size="sm"
            onClick={onAcceptAll}
            disabled={aiBoxCount === 0}
            className="flex-1"
            title="采纳当前题可见候选"
          >
            <Icon name="check" size={11} />
            采纳当前候选
          </Button>
        </div>
        {/* v0.18.28 · 项目存了编排时单独一行: 把项目编排只跑当前一图 (执行器, 非编排编辑器)。 */}
        {/* claude[bot] P1 #5 · 引用的 backend 被删/停 → 按钮禁用 + 标注原因, 避免默默 422。 */}
        {/* v0.21.10 · 视频任务隐藏此按钮: batch 预标不接受 frame_index (payload 无该字段),
            对视频会跑整段而非"当前题"; 单帧路径 /predict-frame 又是单模型、跑不了多阶段编排。
            视频单帧检测走上面的主「运行当前题」(方案 a), 整段/多阶段编排到「AI 预标」批量页。 */}
        {!isVideoTask && hasProjectPipeline && onRunPipeline && (
          <Button
            variant="ai"
            size="sm"
            onClick={onRunPipeline}
            disabled={aiRunning || !projectPipelineRunnable}
            className="mb-2.5 w-full"
            title={
              projectPipelineRunnable
                ? "按项目已保存的多阶段编排, 对当前题跑完整流水线"
                : `编排引用的 ${pipelineMissingBackendCount} 个后端不可用, 请到「AI 预标」修编排或重新注册`
            }
          >
            <Icon name="layers" size={11} />
            {projectPipelineRunnable
              ? `运行当前题（按项目编排 · ${projectPipelineStageCount} 阶段）`
              : `编排引用 ${pipelineMissingBackendCount} 个后端不可用`}
          </Button>
        )}
        {isVideoTask && (
          <p className="mb-1 text-2xs leading-snug text-muted-foreground">
            仅对<span className="text-foreground">当前帧</span>做单帧检测。要追踪整段目标：用 Ctrl+B
            种子追踪，或到「AI 预标」批量页按整段序列跑。
          </p>
        )}
      </div>

      {/* v0.14.18 · header 以下整体可滚 (拖动头固定), 修面板内容超高时底部 (输出形态/效率) 被截断. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* v0.14.18 · 置信度阈值移出拖动头 → body 顶部: 拖面板 (头部) 与拖滑块互不抢手势. */}
        <div className={AI_PANEL_SECTION_CLASS}>
          <div className="mb-1.5 text-xs font-semibold text-foreground">候选筛选</div>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">置信度阈值</span>
            <span className="mono rounded-sm bg-violet-500/[0.12] px-1.5 text-xs font-semibold text-status-info">
              {(confThreshold * 100).toFixed(0)}%
            </span>
          </div>
          <div className="mb-1.5 text-2xs leading-[1.4] text-muted-foreground">
            仅显示并采纳当前题中置信度 ≥ 此值的 AI
            候选；低于阈值的候选会隐藏，且不纳入一键采纳。可拖动滑块调整，或用工具栏 <kbd>[</kbd> /{" "}
            <kbd>]</kbd>（滚轮 5%、Shift 10%）。
          </div>
          {/* 可拖动滑块 (step 1%); 仍支持滚轮 (5%/Shift 10%) 与工具栏 [ / ]. */}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={confThreshold}
            onChange={(e) => onSetConfThreshold(Number(parseFloat(e.target.value).toFixed(2)))}
            onWheel={(e) => {
              e.preventDefault();
              const step = e.shiftKey ? 0.1 : 0.05;
              const next = Math.min(1, Math.max(0, confThreshold + (e.deltaY < 0 ? step : -step)));
              onSetConfThreshold(Number(next.toFixed(2)));
            }}
            className="my-0.5 w-full cursor-pointer accent-violet-500"
            aria-label="置信度阈值"
            data-testid="ai-threshold-display"
          />
        </div>

        {/* 共享配置区: 任务类型 / 模型任务 (检测/分割…) / 类别白名单 / variant / 后端参数 / prompt.
            与批量页 ProjectDetailPanel 同一组件 (单一事实源). */}
        <div className={AI_PANEL_SECTION_CLASS}>
          <div className="mb-2 text-xs font-semibold text-foreground">本次运行</div>
          <PreannotateConfigForm
            cfg={cfg}
            backends={backends}
            selectedBackendId={selectedBackendId}
            onSelectBackend={onSelectBackend}
            projectMlBackendId={projectMlBackendId}
            backendSelectorLabel="本次 backend"
          />
        </div>

        <div className={AI_PANEL_SECTION_CLASS}>
          <div className="mb-1.5 text-xs text-muted-foreground">本次效率</div>
          <div className="mb-1 flex justify-between text-xs">
            <span>AI 接管率</span>
            <span className="mono font-semibold text-status-info">{aiTakeoverRate}%</span>
          </div>
          <ProgressBar value={aiTakeoverRate} color="var(--sc-chart-4)" />
          {taskAiPredictionCount && taskAiPredictionCount > 0 && (
            <div
              data-testid="task-ai-cost"
              className="mt-1.5 flex justify-between gap-2.5 text-xs text-muted-foreground"
            >
              <span>本题</span>
              <span className="mono text-foreground">
                {taskAiCost != null && taskAiCost > 0 ? `¥${taskAiCost.toFixed(4)}` : "¥0"}
                {taskAiAvgMs != null && (
                  <>
                    <span className="mx-1 text-muted-foreground">·</span>
                    {taskAiAvgMs}ms
                  </>
                )}
                <span className="ml-1 text-muted-foreground">({taskAiPredictionCount} 次)</span>
              </span>
            </div>
          )}
        </div>
      </div>
      {/* v0.14.18 · 右下角缩放手柄 (与 FloatingPanelShell 同款). */}
      {onSizeChange && (
        <button
          type="button"
          className="absolute bottom-0 right-0 z-local-1 size-[18px] cursor-nwse-resize touch-none appearance-none border-0 bg-transparent p-0 text-muted-foreground hover:text-status-info"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          aria-label="调整 AI 面板尺寸"
          title="拖拽调整尺寸"
        >
          <span className="pointer-events-none absolute bottom-1 right-1 h-px w-[9px] origin-right rotate-[-45deg] bg-current" />
          <span className="pointer-events-none absolute bottom-2 right-1 h-px w-[5px] origin-right rotate-[-45deg] bg-current" />
        </button>
      )}
    </div>
  );
}

// ── 虚拟化合并列表 ─────────────────────────────────────────────────────────
type Row =
  | { kind: "ai"; box: AiBox; key: string }
  | {
      kind: "frameFilter";
      filter: FrameFilter;
      key: string;
      onFilterChange: (filter: FrameFilter) => void;
    }
  | { kind: "sourceFilter"; filter: PredictionSourceFilterState; key: string }
  | {
      kind: "header";
      count: number;
      totalCount: number;
      key: string;
      label: string;
      /** v0.20.22 · header 带上分组身份 + 折叠态 + 点击回调, 存在 onToggle 时 header 渲染为可点 button。 */
      sectionKey?: "ai" | "manual";
      collapsed?: boolean;
      onToggle?: () => void;
    }
  | { kind: "videoTracks"; key: string }
  /** v0.20.9 · 父子标注: depth=1 的行是子框, 在其父框行下方缩进渲染。 */
  | { kind: "user"; box: Annotation; key: string; depth?: number };

function FrameFilterTabs({
  value,
  onChange,
}: {
  value: FrameFilter;
  onChange: (filter: FrameFilter) => void;
}) {
  const options: Array<{ value: FrameFilter; label: string }> = [
    { value: "all", label: "全部" },
    { value: "current", label: "当前帧" },
  ];
  return (
    <div
      aria-label="帧过滤"
      className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-background"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "h-6 cursor-pointer appearance-none border-0 bg-transparent text-xs font-medium text-muted-foreground",
              option.value === "current" && "border-l border-border",
              active && "bg-brand/10 font-semibold text-brand",
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
    <div
      className="mb-1.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5"
      aria-label="预测来源筛选"
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon name="filter" size={12} />
        来源
      </span>
      <div className="flex min-w-0 items-center justify-end gap-1.5">
        {PREDICTION_SOURCE_FILTERS.map((source) => {
          const checked = filter.visibility[source];
          const count = filter.counts[source];
          const label = predictionSourceLabel(source);
          const isImport = source === "external_import";
          return (
            <label
              key={source}
              className={cn(
                "flex min-w-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground",
                checked && !isImport && "border-violet-500/45 bg-status-info-soft text-status-info",
                checked &&
                  isImport &&
                  "border-amber-500/45 bg-status-caution-soft text-status-caution",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={count === 0}
                onChange={(e) => filter.onToggle(source, e.currentTarget.checked)}
                className="size-3 accent-brand"
              />
              <Icon name={source === "ml_backend" ? "sparkle" : "upload"} size={11} />
              <span>{label}</span>
              <span className="mono text-2xs text-inherit">{count}</span>
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
  rasterMaskStatusById?: ReadonlyMap<string, RasterMaskRecordStatus>;
  onRetryRasterMask?: (id: string) => void;
  selSet: Set<string>;
  dimmedAiIds?: Set<string>;
  imageWidth: number | null;
  imageHeight: number | null;
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onFetchMore?: () => void;
  currentFrameIndex?: number;
  onSelect: (id: string, opts?: { shift?: boolean }) => void;
  onAcceptPrediction: (b: AiBox, attributeOverrides?: Record<string, unknown>) => void;
  onRejectPrediction?: (b: AiBox) => void;
  /** v0.10.8 · I11 · 仅 polygon 候选会展示「精修」按钮，由 WorkbenchShell 注入 handleRefinePrediction。 */
  onRefinePrediction?: (b: AiBox) => void;
  /** v0.10.9 · 已落库 user polygon 行的「精修」按钮，update mutation 替换 geometry。 */
  onRefineUserPolygon?: (annotationId: string) => void;
  onEditRasterMask?: (annotationId: string) => void;
  readOnly?: boolean;
  onClearSelection: () => void;
  onDeleteUserBox: (id: string) => void;
  onChangeUserBoxClass?: (id: string) => void;
  /** v0.10.5 M4-β · I15 切换 shape 状态位（lock/hidden）。 */
  onToggleUserBoxFlag?: (id: string, flag: "is_locked" | "is_hidden") => void;
  onSeekFrame?: (frameIndex: number) => void;
  videoTrackPanel?: React.ReactNode | ((frameFilter: FrameFilter) => React.ReactNode);
  /** v0.20.22 · AI 待审 / 人工两大分组头折叠 (透传自 AIInspectorPanel;
   *  与内部 `collapsedGroups` 子组折叠区分, 独立跨设备持久)。 */
  aiSectionCollapsed?: boolean;
  onToggleAiSection?: () => void;
  manualSectionCollapsed?: boolean;
  onToggleManualSection?: () => void;
}

function BoxesList({
  aiBoxes,
  predictionSourceFilter,
  userBoxes,
  orphanUserBoxIds,
  rasterMaskStatusById,
  onRetryRasterMask,
  selSet,
  dimmedAiIds,
  imageWidth,
  imageHeight,
  hasMore,
  isFetchingMore,
  onFetchMore,
  currentFrameIndex,
  onSeekFrame,
  onSelect,
  onAcceptPrediction,
  onRejectPrediction,
  onRefinePrediction,
  onRefineUserPolygon,
  onEditRasterMask,
  readOnly = false,
  onClearSelection,
  onDeleteUserBox,
  onChangeUserBoxClass,
  onToggleUserBoxFlag,
  videoTrackPanel,
  aiSectionCollapsed = false,
  onToggleAiSection,
  manualSectionCollapsed = false,
  onToggleManualSection,
}: BoxesListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  // 视频默认聚焦「当前帧」,避免一上来在「全部」视图里跨帧误操作;图片端 frameFilter 不显示
  // 且 filterBoxesByFrame 在 currentFrameIndex 为 undefined 时回落全部,故对图片无影响。
  const [frameFilter, setFrameFilter] = useState<FrameFilter>("current");
  const showFrameFilter = typeof currentFrameIndex === "number";
  const resolvedVideoTrackPanel = useMemo(
    () => (typeof videoTrackPanel === "function" ? videoTrackPanel(frameFilter) : videoTrackPanel),
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
      out.push({
        kind: "frameFilter",
        key: "frame-filter",
        filter: frameFilter,
        onFilterChange: setFrameFilter,
      });
    }
    const hasKnownPredictionSources = predictionSourceFilter
      ? PREDICTION_SOURCE_FILTERS.some((source) => predictionSourceFilter.counts[source] > 0)
      : false;
    out.push({
      kind: "header",
      label: "AI 待审",
      count: filteredAiBoxes.length,
      totalCount: aiTotalCount,
      key: "ai-header",
      sectionKey: "ai",
      collapsed: aiSectionCollapsed,
      onToggle: onToggleAiSection,
    });
    // 分组标题常驻；空分组仍显示 0，成员行与来源筛选只在有数据且展开时渲染。
    if (!aiSectionCollapsed && aiTotalCount > 0) {
      if (predictionSourceFilter && hasKnownPredictionSources) {
        out.push({
          kind: "sourceFilter",
          key: "prediction-source-filter",
          filter: predictionSourceFilter,
        });
      }
      filteredAiBoxes.forEach((b) => out.push({ kind: "ai", box: b, key: `ai-${b.id}` }));
    }
    out.push({
      kind: "header",
      label: "人工",
      count: filteredUserBoxes.length,
      totalCount: userBoxes.length,
      key: "user-header",
      sectionKey: "manual",
      collapsed: manualSectionCollapsed,
      onToggle: onToggleManualSection,
    });
    // v0.20.22 · 人工分组整体收起时跳过所有成员行 (含 GroupCard/子组), 头 + 计数仍显示。
    if (!manualSectionCollapsed) {
      // v0.20.9 · 父子标注: 建 parent → children 映射。子框从顶层迭代中剔除, 改在父框行下方
      // 缩进渲染 (depth=1)。parent 缩进是唯一主结构 (v0.21.3 已移除 group 分桶 legacy)。
      const userIdSet = new Set(filteredUserBoxes.map((b) => b.id));
      const childrenByParent = new Map<string, Annotation[]>();
      for (const b of filteredUserBoxes) {
        const pid = b.parent_annotation_id;
        if (pid && userIdSet.has(pid)) {
          if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
          childrenByParent.get(pid)!.push(b);
        }
      }
      // 顶层框: 无 parent, 或 parent 不在当前过滤集内 (跨帧过滤等 → 回落顶层展示, 不隐藏)。
      const topLevelBoxes = filteredUserBoxes.filter(
        (b) => !(b.parent_annotation_id && userIdSet.has(b.parent_annotation_id)),
      );
      const emitBoxWithChildren = (b: Annotation) => {
        out.push({ kind: "user", box: b, key: `user-${b.id}` });
        const kids = childrenByParent.get(b.id);
        if (kids)
          kids.forEach((c) => out.push({ kind: "user", box: c, key: `user-${c.id}`, depth: 1 }));
      };

      // v0.21.3 · 标注编组已删除: 顶层框平铺 (parent 缩进保留)。
      topLevelBoxes.forEach(emitBoxWithChildren);
    }
    if (resolvedVideoTrackPanel) out.push({ kind: "videoTracks", key: "video-track-panel" });
    return out;
  }, [
    aiBoxes.length,
    filteredAiBoxes,
    filteredUserBoxes,
    frameFilter,
    predictionSourceFilter,
    showFrameFilter,
    userBoxes.length,
    resolvedVideoTrackPanel,
    aiSectionCollapsed,
    manualSectionCollapsed,
    onToggleAiSection,
    onToggleManualSection,
  ]);

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
    const visibleAiNearEnd =
      aiBoxes.length > 0 &&
      items.some(
        (item) => item.index <= aiEndIndex && item.index >= Math.max(1, aiBoxes.length - 4),
      );
    if (visibleAiNearEnd) onFetchMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hasMore, isFetchingMore, aiBoxes.length]);
  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto px-2 py-1">
      <div
        className="relative h-[var(--ai-inspector-list-height)]"
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
              className="absolute left-0 top-0 w-full translate-y-[var(--ai-inspector-row-y)]"
            >
              {r.kind === "ai" && (
                <BoxListItem
                  b={r.box}
                  isAi
                  selected={selSet.has(r.box.id)}
                  dimmed={dimmedAiIds?.has(r.box.id) ?? false}
                  imageWidth={imageWidth}
                  imageHeight={imageHeight}
                  onSelect={(e) => selectBox(r.box, e?.shiftKey)}
                  onAccept={() => onAcceptPrediction(r.box)}
                  onReject={() => {
                    onRejectPrediction?.(r.box);
                    onClearSelection();
                  }}
                  onRefine={
                    onRefinePrediction && r.box.geometry?.type === "polygon"
                      ? () => onRefinePrediction(r.box)
                      : undefined
                  }
                />
              )}
              {r.kind === "header" &&
                (r.onToggle ? (
                  // v0.20.22 · 分组头可点折叠 (AI 待审 / 人工)。计数常驻显示; 收起时下方成员行整体跳过。
                  <button
                    type="button"
                    onClick={r.onToggle}
                    aria-expanded={!r.collapsed}
                    title={r.collapsed ? `展开${r.label}` : `折叠${r.label}`}
                    data-testid={`section-header-${r.sectionKey ?? "unknown"}`}
                    className={cn(
                      SECTION_CARD_CLASS,
                      "flex w-full cursor-pointer appearance-none items-center justify-between gap-2 text-left hover:bg-muted",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <Icon name={r.collapsed ? "chevRight" : "chevDown"} size={13} />
                      {r.label}
                    </span>
                    <span className="mono text-xs font-medium text-muted-foreground">
                      {showFrameFilter && frameFilter === "current"
                        ? `${r.count}/${r.totalCount}`
                        : r.count}
                    </span>
                  </button>
                ) : (
                  <div className={SECTION_CARD_CLASS}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{r.label}</span>
                      <span className="mono text-xs font-medium text-muted-foreground">
                        {showFrameFilter && frameFilter === "current"
                          ? `${r.count}/${r.totalCount}`
                          : r.count}
                      </span>
                    </div>
                  </div>
                ))}
              {r.kind === "frameFilter" && (
                <div className="mb-1.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">显示范围</span>
                  <FrameFilterTabs value={r.filter} onChange={r.onFilterChange} />
                </div>
              )}
              {r.kind === "sourceFilter" && <PredictionSourceFilterCard filter={r.filter} />}
              {r.kind === "videoTracks" && (
                <div data-testid="video-track-panel-row">{resolvedVideoTrackPanel}</div>
              )}
              {r.kind === "user" && (
                <div className={r.depth ? "ml-3 border-l-2 border-border pl-2" : undefined}>
                  <BoxListItem
                    b={r.box}
                    rasterMaskStatus={rasterMaskStatusById?.get(r.box.id)}
                    onRetryRasterMask={
                      onRetryRasterMask ? () => onRetryRasterMask(r.box.id) : undefined
                    }
                    orphan={orphanUserBoxIds?.has(r.box.id) ?? false}
                    selected={selSet.has(r.box.id)}
                    imageWidth={imageWidth}
                    imageHeight={imageHeight}
                    onSelect={(e) => selectBox(r.box, e?.shiftKey)}
                    onDelete={
                      !readOnly && !r.box.is_locked ? () => onDeleteUserBox(r.box.id) : undefined
                    }
                    onChangeClass={
                      !readOnly && !r.box.is_locked && onChangeUserBoxClass
                        ? () => onChangeUserBoxClass(r.box.id)
                        : undefined
                    }
                    onToggleFlag={
                      onToggleUserBoxFlag
                        ? (flag) => onToggleUserBoxFlag(r.box.id, flag)
                        : undefined
                    }
                    onRefine={
                      r.box.geometry?.type === "raster_mask"
                        ? !readOnly && !r.box.is_locked && onEditRasterMask
                          ? () => onEditRasterMask(r.box.id)
                          : undefined
                        : onRefineUserPolygon && r.box.geometry?.type === "polygon"
                          ? () => onRefineUserPolygon(r.box.id)
                          : undefined
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {(hasMore || isFetchingMore) && (
        <div className="px-2 py-1.5 text-center text-xs text-muted-foreground">
          {isFetchingMore ? (
            "加载更多预测..."
          ) : (
            <button
              onClick={onFetchMore}
              className="cursor-pointer appearance-none rounded border border-border bg-transparent px-3 py-1 text-xs text-muted-foreground"
            >
              加载更多
            </button>
          )}
        </div>
      )}
    </div>
  );
}

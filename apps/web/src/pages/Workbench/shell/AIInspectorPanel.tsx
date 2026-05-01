import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { Annotation, AnnotationResponse } from "@/types";
import type { AttributeSchema } from "@/api/projects";
import type { AiBox } from "../state/transforms";
import { BoxListItem } from "../stage/BoxListItem";
import { AttributeForm } from "./AttributeForm";
import { CommentsPanel } from "./CommentsPanel";

interface AIInspectorPanelProps {
  open: boolean;
  aiModel: string;
  aiRunning: boolean;
  aiBoxes: AiBox[];
  userBoxes: Annotation[];
  selectedId: string | null;
  selectedIds?: string[];
  /** 与 user 框 IoU > 0.7 的同类 AI 框 id（视觉淡化）。 */
  dimmedAiIds?: Set<string>;
  confThreshold: number;
  aiTakeoverRate: number;
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
  /** 是否启用画布批注按钮（默认仅 reviewer 端开启；annotator 仅查看）。 */
  enableCommentCanvasDrawing?: boolean;
  hasMorePredictions?: boolean;
  isFetchingMorePredictions?: boolean;
  onFetchMorePredictions?: () => void;
  onToggle: () => void;
  onRunAi: () => void;
  onAcceptAll: () => void;
  onSetConfThreshold: (v: number) => void;
  /** Shift+click 进入多选；普通 click 单选。 */
  onSelect: (id: string, opts?: { shift?: boolean }) => void;
  onAcceptPrediction: (b: AiBox) => void;
  onClearSelection: () => void;
  onDeleteUserBox: (id: string) => void;
  onChangeUserBoxClass?: (id: string) => void;
}

const stripStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  height: "100%", gap: 8, cursor: "pointer", userSelect: "none",
  background: "var(--color-bg-elev)", border: "none", width: "100%", padding: 0,
  color: "var(--color-fg-muted)",
};

export function AIInspectorPanel({
  open, aiModel, aiRunning, aiBoxes, userBoxes, selectedId, selectedIds, dimmedAiIds,
  confThreshold, aiTakeoverRate,
  imageWidth, imageHeight,
  attributeSchema, selectedAnnotation, onUpdateAttributes, currentUserId,
  taskFileUrl, enableCommentCanvasDrawing,
  hasMorePredictions, isFetchingMorePredictions, onFetchMorePredictions,
  onToggle, onRunAi, onAcceptAll, onSetConfThreshold,
  onSelect, onAcceptPrediction, onClearSelection, onDeleteUserBox, onChangeUserBoxClass,
}: AIInspectorPanelProps) {
  const selSet = selectedIds && selectedIds.length > 0
    ? new Set(selectedIds)
    : selectedId ? new Set([selectedId]) : new Set<string>();
  const multiCount = selSet.size > 1 ? selSet.size : 0;
  if (!open) {
    return (
      <div style={{ borderLeft: "1px solid var(--color-border)", overflow: "hidden" }}>
        <button onClick={onToggle} title="展开 AI 助手" style={stripStyle}>
          <Icon name="chevLeft" size={13} />
          <span style={{ fontSize: 10, writingMode: "vertical-rl", letterSpacing: 1, opacity: 0.6 }}>AI 助手</span>
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--color-bg-elev)", borderLeft: "1px solid var(--color-border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--color-border)", background: "linear-gradient(180deg, var(--color-ai-soft), transparent)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="sparkles" size={14} style={{ color: "var(--color-ai)" }} />
            <b style={{ fontSize: 13 }}>AI 助手</b>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Badge variant="ai" dot style={{ fontSize: 10 }}>{aiRunning ? "推理中" : "在线"}</Badge>
            <Button variant="ghost" size="sm" onClick={onToggle} title="收起 AI 助手" style={{ padding: "2px 6px" }}>
              <Icon name="chevRight" size={11} />
            </Button>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)", marginBottom: 8 }}>
          模型: <span style={{ color: "var(--color-fg)", fontWeight: 500 }}>{aiModel}</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <Button variant="ai" size="sm" onClick={onRunAi} disabled={aiRunning} style={{ flex: 1 }}>
            <Icon name="sparkles" size={11} />一键预标
          </Button>
          <Button size="sm" onClick={onAcceptAll} disabled={aiBoxes.length === 0} style={{ flex: 1 }}>
            <Icon name="check" size={11} />全部采纳
          </Button>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: "var(--color-fg-muted)" }}>置信度阈值</span>
            <span className="mono" style={{ fontWeight: 500 }}>{(confThreshold * 100).toFixed(0)}%</span>
          </div>
          <input
            type="range" min="0" max="1" step="0.05" value={confThreshold}
            onChange={(e) => onSetConfThreshold(+e.target.value)}
            style={{ width: "100%", accentColor: "var(--color-ai)" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-fg-subtle)", marginTop: -2 }}>
            <span>显示更多</span><span>更精准</span>
          </div>
        </div>
      </div>

      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>AI 待审</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{aiBoxes.length} 项</span>
        </div>
        {aiBoxes.length === 0 && (
          <div style={{ fontSize: 11.5, color: "var(--color-fg-subtle)", padding: "4px 0" }}>暂无,点击"一键预标"开始</div>
        )}
      </div>

      {multiCount > 0 && (
        <div
          style={{
            padding: "6px 14px",
            background: "var(--color-accent-soft)",
            borderBottom: "1px solid var(--color-border)",
            fontSize: 11.5, color: "var(--color-accent-fg)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}
        >
          <span>已选 <b>{multiCount}</b> 个 user 框</span>
          <button
            onClick={onClearSelection}
            style={{
              fontSize: 10.5, padding: "1px 6px", borderRadius: 3,
              background: "transparent", border: "1px solid var(--color-border)",
              color: "var(--color-fg-muted)", cursor: "pointer",
            }}
          >清除</button>
        </div>
      )}

      {selectedAnnotation && attributeSchema && onUpdateAttributes && (
        <AttributeForm
          schema={attributeSchema}
          className={selectedAnnotation.class_name}
          attributes={selectedAnnotation.attributes ?? {}}
          onChange={(next) => onUpdateAttributes(selectedAnnotation.id, next)}
        />
      )}

      {selectedAnnotation && (
        <CommentsPanel
          annotationId={selectedAnnotation.id}
          projectId={selectedAnnotation.project_id}
          currentUserId={currentUserId}
          backgroundUrl={taskFileUrl}
          enableCanvasDrawing={enableCommentCanvasDrawing}
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
        onSelect={onSelect}
        onAcceptPrediction={onAcceptPrediction}
        onClearSelection={onClearSelection}
        onDeleteUserBox={onDeleteUserBox}
        onChangeUserBoxClass={onChangeUserBoxClass}
      />

      <div style={{ borderTop: "1px solid var(--color-border)", padding: "10px 14px", background: "var(--color-bg-sunken)" }}>
        <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginBottom: 6 }}>本次效率</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span>AI 接管率</span>
          <span className="mono" style={{ fontWeight: 600, color: "var(--color-ai)" }}>{aiTakeoverRate}%</span>
        </div>
        <ProgressBar value={aiTakeoverRate} color="var(--color-ai)" />
      </div>
    </div>
  );
}

// ── 虚拟化合并列表 ─────────────────────────────────────────────────────────
type Row =
  | { kind: "ai"; box: AiBox; key: string }
  | { kind: "header"; count: number; key: string }
  | { kind: "user"; box: Annotation; key: string };

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
  onSelect: (id: string, opts?: { shift?: boolean }) => void;
  onAcceptPrediction: (b: AiBox) => void;
  onClearSelection: () => void;
  onDeleteUserBox: (id: string) => void;
  onChangeUserBoxClass?: (id: string) => void;
}

function BoxesList({
  aiBoxes, userBoxes, selSet, dimmedAiIds, imageWidth, imageHeight,
  hasMore, isFetchingMore, onFetchMore,
  onSelect, onAcceptPrediction, onClearSelection, onDeleteUserBox, onChangeUserBoxClass,
}: BoxesListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    aiBoxes.forEach((b) => out.push({ kind: "ai", box: b, key: `ai-${b.id}` }));
    if (userBoxes.length > 0) out.push({ kind: "header", count: userBoxes.length, key: "user-header" });
    userBoxes.forEach((b) => out.push({ kind: "user", box: b, key: `user-${b.id}` }));
    return out;
  }, [aiBoxes, userBoxes]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]?.kind === "header" ? 28 : 56),
    overscan: 8,
  });

  // 滚到接近末尾时自动加载下一页（仅 AI 段尚有未加载）
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    if (!items.length || !hasMore || isFetchingMore || !onFetchMore) return;
    const last = items[items.length - 1];
    // last 在 AI 区段（aiBoxes 区间）内，且距末尾 5 行内
    if (last.index >= aiBoxes.length - 5) onFetchMore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hasMore, isFetchingMore, aiBoxes.length]);

  return (
    <div ref={parentRef} style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((vItem) => {
          const r = rows[vItem.index];
          if (!r) return null;
          return (
            <div
              key={r.key}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute", top: 0, left: 0, width: "100%",
                transform: `translateY(${vItem.start}px)`,
              }}
            >
              {r.kind === "ai" && (
                <BoxListItem
                  b={r.box} isAi
                  selected={selSet.has(r.box.id)}
                  dimmed={dimmedAiIds?.has(r.box.id) ?? false}
                  imageWidth={imageWidth} imageHeight={imageHeight}
                  onSelect={(e) => onSelect(r.box.id, { shift: !!e?.shiftKey })}
                  onAccept={() => onAcceptPrediction(r.box)}
                  onReject={onClearSelection}
                />
              )}
              {r.kind === "header" && (
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-fg-muted)", padding: "10px 6px 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  已确认 ({r.count})
                </div>
              )}
              {r.kind === "user" && (
                <BoxListItem
                  b={r.box}
                  selected={selSet.has(r.box.id)}
                  imageWidth={imageWidth} imageHeight={imageHeight}
                  onSelect={(e) => onSelect(r.box.id, { shift: !!e?.shiftKey })}
                  onDelete={() => onDeleteUserBox(r.box.id)}
                  onChangeClass={onChangeUserBoxClass ? () => onChangeUserBoxClass(r.box.id) : undefined}
                />
              )}
            </div>
          );
        })}
      </div>
      {(hasMore || isFetchingMore) && (
        <div style={{ padding: "6px 8px", fontSize: 11, color: "var(--color-fg-subtle)", textAlign: "center" }}>
          {isFetchingMore ? "加载更多预测..." : (
            <button
              onClick={onFetchMore}
              style={{
                background: "transparent", border: "1px solid var(--color-border)",
                borderRadius: 4, padding: "4px 12px", fontSize: 11,
                color: "var(--color-fg-muted)", cursor: "pointer",
              }}
            >加载更多</button>
          )}
        </div>
      )}
    </div>
  );
}

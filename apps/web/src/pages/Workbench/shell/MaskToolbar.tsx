import { useState } from "react";
import {
  Brush,
  Check,
  ChevronDown,
  Eraser,
  Lasso,
  Redo2,
  Undo2,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/shadcn/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/shadcn/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/shadcn/ui/field";
import { Input } from "@/components/shadcn/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/shadcn/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  MASK_BRUSH_MAX_PX,
  MASK_BRUSH_MIN_PX,
  type MaskEditorTool,
  type MaskOperationStatus,
  type MaskOperationPreview,
  type MaskInstanceOperationPreview,
} from "../state/useMaskEditor";
import type { MaskBrushShape } from "../stage/shared/geometry/maskBuffer";
import type {
  MaskConnectivity,
  MaskKernelShape,
  MaskOperationSpec,
} from "../stage/shared/geometry/maskOperations";
import type { MaskInstanceOperationSpec } from "../stage/shared/geometry/maskInstanceOperations";
import type { MaskEditBlockReason, MaskEditorPhase } from "../state/canEditMask";

interface MaskToolbarProps {
  active: boolean;
  tool: MaskEditorTool;
  brushShape: MaskBrushShape;
  connectivity: MaskConnectivity;
  radius: number;
  dirty: boolean;
  phase: MaskEditorPhase;
  canUndo: boolean;
  canRedo: boolean;
  canEdit: boolean;
  editBlockReason?: MaskEditBlockReason | null;
  operationPreview: MaskOperationPreview | null;
  instanceOperationPreview: MaskInstanceOperationPreview | null;
  operationStatus: MaskOperationStatus;
  operationError?: unknown;
  onSetTool: (tool: MaskEditorTool) => void;
  onSetBrushShape: (shape: MaskBrushShape) => void;
  onSetConnectivity: (connectivity: MaskConnectivity) => void;
  onSetRadius: (radius: number) => void;
  onConfirmOperation: () => void;
  onCancelOperation: () => void;
  onRunOperation: (name: string, operation: MaskOperationSpec) => Promise<boolean>;
  onRunInstanceOperation: (name: string, operation: MaskInstanceOperationSpec) => Promise<boolean>;
  onCommitInstanceOperation?: () => void;
  onPrepareJoin?: (mode: "replace_sources" | "preserve_sources") => void;
  onPrepareOverlap?: (policy: "erase_same_class" | "erase_all") => void;
  onRefreshInstanceOperation?: () => void;
  canPrepareJoin?: boolean;
  joinSupportsReplace?: boolean;
  instanceCommitting?: boolean;
  instanceRefreshing?: boolean;
  instanceCommitError?: string | null;
  instanceCanRetry?: boolean;
  instanceCanRefresh?: boolean;
  instancePreviewDetail?: string | null;
  instancePreviewRows?: Array<{
    annotationId: string;
    version: number | null;
    changedPixels: number | null;
    status: "update" | "delete" | "source" | "unresolved";
  }>;
  instanceCommitBlocked?: boolean;
  onCommit: () => void;
  onCommitAndPropagate?: () => void;
  onOpenConversion?: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRetry?: () => void;
}

const phaseLabel: Record<MaskEditorPhase, string> = {
  idle: "未激活",
  loading: "加载中",
  ready: "就绪",
  dirty: "未保存",
  saving: "保存中",
  error: "操作失败",
};

const operationLabel: Record<string, string> = {
  lasso_add: "套索添加",
  lasso_subtract: "套索扣除",
  fill_add: "区域填充",
  fill_subtract: "区域擦除",
  component_keep: "保留命中组件",
  component_delete: "删除命中组件",
  hole_fill: "填充命中孔洞",
  dilate: "膨胀",
  erode: "腐蚀",
  open: "开运算",
  close: "闭运算",
  smooth: "边界平滑",
  deburr: "去除小组件",
  fill_holes_all: "填充全部孔洞",
  fill_holes_small: "填充小孔洞",
  component_copy: "复制命中组件",
  split_components: "拆分组件",
};

const editBlockReasonLabel: Record<MaskEditBlockReason, string> = {
  task_read_only: "任务只读或原生 Mask 写能力未开启",
  annotation_locked: "当前标注已锁定",
  track_locked: "当前 Mask 轨迹已锁定",
  segment_locked: "当前视频分段锁冲突",
  editor_idle: "请先进入 Mask 编辑",
  editor_loading: "正在加载 Mask",
  editor_saving: "正在保存 Mask",
  editor_error: "请先恢复失败的编辑会话",
};

export function MaskToolbar({
  active,
  tool,
  brushShape,
  connectivity,
  radius,
  dirty,
  phase,
  canUndo,
  canRedo,
  canEdit,
  editBlockReason,
  operationPreview,
  instanceOperationPreview,
  operationStatus,
  operationError,
  onSetTool,
  onSetBrushShape,
  onSetConnectivity,
  onSetRadius,
  onConfirmOperation,
  onCancelOperation,
  onRunOperation,
  onRunInstanceOperation,
  onCommitInstanceOperation,
  onPrepareJoin,
  onPrepareOverlap,
  onRefreshInstanceOperation,
  canPrepareJoin = false,
  joinSupportsReplace = true,
  instanceCommitting = false,
  instanceRefreshing = false,
  instanceCommitError,
  instanceCanRetry = false,
  instanceCanRefresh = false,
  instancePreviewDetail,
  instancePreviewRows = [],
  instanceCommitBlocked = false,
  onCommit,
  onCommitAndPropagate,
  onOpenConversion,
  onCancel,
  onUndo,
  onRedo,
  onRetry,
}: MaskToolbarProps) {
  const instanceBusy = instanceCommitting || instanceRefreshing;
  const [componentThreshold, setComponentThreshold] = useState(16);
  const [morphologyRadius, setMorphologyRadius] = useState(1);
  const [kernelShape, setKernelShape] = useState<MaskKernelShape>("disk");
  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  const runMorphology = (operation: "dilate" | "erode" | "open" | "close") => {
    void onRunOperation(operation, {
      type: "morphology",
      operation,
      kernelShape,
      radius: morphologyRadius,
    });
  };
  return (
    <div
      data-testid="mask-toolbar"
      className="absolute left-1/2 top-3 z-local-5 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-md"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span className="px-1 text-xs font-semibold text-foreground">Mask 编辑</span>
      <ToggleGroup
        type="single"
        value={tool}
        variant="outline"
        size="sm"
        disabled={!canEdit}
        aria-label="Mask pointer 工具"
        onValueChange={(value) => value && onSetTool(value as MaskEditorTool)}
      >
        <ToggleGroupItem value="brush" title="笔刷 (B)" aria-label="笔刷">
          <Brush />
          笔刷
        </ToggleGroupItem>
        <ToggleGroupItem value="erase" title="橡皮 (E)" aria-label="橡皮">
          <Eraser />
          橡皮
        </ToggleGroupItem>
        <ToggleGroupItem value="lasso_add" title="套索添加" aria-label="套索添加">
          <Lasso />
          添加
        </ToggleGroupItem>
        <ToggleGroupItem value="lasso_subtract" title="套索扣除" aria-label="套索扣除">
          <Lasso />
          扣除
        </ToggleGroupItem>
      </ToggleGroup>

      <DropdownMenu>
        <DropdownMenuTrigger
          className={buttonVariants({ variant: "outline", size: "sm" })}
          disabled={!canEdit}
          title="Mask 高级工具"
        >
          {operationLabel[tool] ?? "高级"} <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] w-72 overflow-y-auto"
        >
          <DropdownMenuLabel>区域工具</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onSetTool("fill_add")}>填充命中区域</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSetTool("fill_subtract")}>擦除命中区域</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>组件与孔洞</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onSetTool("component_keep")}>保留命中组件</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSetTool("component_delete")}>删除命中组件</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSetTool("component_copy")}>复制命中组件为新实例</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSetTool("hole_fill")}>填充命中孔洞</DropdownMenuItem>
          <DropdownMenuLabel className="flex items-center gap-2 font-normal">
            <span className="text-xs text-muted-foreground">面积阈值</span>
            <Input
              type="number"
              min={1}
              step={1}
              value={componentThreshold}
              aria-label="组件与孔洞面积阈值"
              onChange={(event) => setComponentThreshold(Math.max(1, Number.parseInt(event.target.value, 10) || 1))}
              className="h-7 w-20"
            />
            <span className="text-xs text-muted-foreground">px</span>
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => void onRunOperation("deburr", {
              type: "remove_small_components",
              maxArea: componentThreshold,
              connectivity,
            })}
          >
            去除小组件（≤ {componentThreshold}px）
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void onRunOperation("fill_holes_small", {
              type: "fill_holes",
              mode: "max_area",
              maxArea: componentThreshold,
            })}
          >
            填充小孔洞（≤ {componentThreshold}px）
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void onRunOperation("fill_holes_all", { type: "fill_holes", mode: "all" })}
          >
            填充全部孔洞
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void onRunInstanceOperation("split_components", {
              type: "split_components",
              keep: "largest",
              connectivity,
            })}
          >
            拆分全部组件（保留最大）
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>派生与转换</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={!onOpenConversion || dirty}
            title={dirty ? "请先保存当前 Mask 草稿" : "打开标注转换中心"}
            onSelect={() => onOpenConversion?.()}
          >
            转为紧致 BBox / Polygon
          </DropdownMenuItem>
          {onPrepareJoin && (
            <>
              {joinSupportsReplace && (
                <DropdownMenuItem
                  disabled={!canPrepareJoin}
                  onSelect={() => onPrepareJoin("replace_sources")}
                >
                  合并已选 Mask（替换来源）
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={!canPrepareJoin}
                onSelect={() => onPrepareJoin("preserve_sources")}
              >
                合并为副本（保留来源）
              </DropdownMenuItem>
            </>
          )}
          {onPrepareOverlap && (
            <>
              <DropdownMenuItem onSelect={() => onPrepareOverlap("erase_same_class")}>
                预览同类严格非重叠
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onPrepareOverlap("erase_all")}>
                预览全类严格非重叠
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>形态学</DropdownMenuLabel>
          <DropdownMenuLabel className="flex items-center gap-2 font-normal">
            <span className="text-xs text-muted-foreground">半径</span>
            <Input
              type="number"
              min={1}
              max={32}
              step={1}
              value={morphologyRadius}
              aria-label="形态学半径"
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10) || 1;
                setMorphologyRadius(Math.max(1, Math.min(32, value)));
              }}
              className="h-7 w-16"
            />
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={kernelShape}
            onValueChange={(value) => setKernelShape(value as MaskKernelShape)}
          >
            <DropdownMenuRadioItem value="disk">圆盘 kernel</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="square">方形 kernel</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuItem onSelect={() => runMorphology("dilate")}>膨胀</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => runMorphology("erode")}>腐蚀</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => runMorphology("open")}>开运算</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => runMorphology("close")}>闭运算</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void onRunOperation("smooth", {
              type: "smooth",
              kernelShape,
              radius: morphologyRadius,
            })}
          >
            边界平滑（闭→开）
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>笔刷形状</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={brushShape}
            onValueChange={(value) => onSetBrushShape(value as MaskBrushShape)}
          >
            <DropdownMenuRadioItem value="circle">圆形硬边</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="square">方形硬边</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>连通邻域</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={String(connectivity)}
            onValueChange={(value) => onSetConnectivity(value === "8" ? 8 : 4)}
          >
            <DropdownMenuRadioItem value="4">4 邻域</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="8">8 邻域</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {(tool === "brush" || tool === "erase") && (
        <Field orientation="horizontal" className="w-auto gap-1.5">
          <FieldLabel htmlFor="mask-radius" className="text-xs text-muted-foreground">半径</FieldLabel>
          <Input
            id="mask-radius"
            type="range"
            min={MASK_BRUSH_MIN_PX}
            max={MASK_BRUSH_MAX_PX}
            step={1}
            value={radius}
            disabled={!canEdit}
            onChange={(event) => onSetRadius(Number.parseInt(event.target.value, 10))}
            className="h-6 w-24 border-0 px-0 py-0 shadow-none"
            data-testid="mask-radius-slider"
          />
          <span className="mono min-w-8 text-right text-xs text-foreground">{radius}px</span>
        </Field>
      )}

      <span className={cn("text-xs", dirty ? "text-status-caution" : "text-muted-foreground")}>
        {phaseLabel[phase]}
      </span>
      {!canEdit && editBlockReason && (
        <span className="text-xs text-status-caution" role="status">
          不可编辑：{editBlockReasonLabel[editBlockReason]}
        </span>
      )}

      {operationPreview && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1">
          <span className="text-xs text-foreground">
            {operationLabel[operationPreview.name] ?? operationPreview.name}
          </span>
          <span className="text-xs text-muted-foreground">
            变化 {operationPreview.report.changedPixels} px
          </span>
          <span className="text-xs text-muted-foreground">
            面积 {operationPreview.report.beforeArea}→{operationPreview.report.afterArea}
            · 组件 {operationPreview.report.beforeComponents}→{operationPreview.report.afterComponents}
            · 孔洞 {operationPreview.report.beforeHoles}→{operationPreview.report.afterHoles}
          </span>
          <Button type="button" size="xs" variant="ghost" onClick={onCancelOperation}>
            取消预览
          </Button>
          <Button
            type="button"
            size="xs"
            onClick={() => {
              if (operationPreview.report.afterArea === 0) setConfirmEmptyOpen(true);
              else onConfirmOperation();
            }}
          >
            应用预览
          </Button>
        </div>
      )}
      {instanceOperationPreview && (
        <div className="flex max-w-3xl flex-wrap items-center gap-2 rounded-md border border-border bg-muted px-2 py-1">
          <span className="text-xs text-foreground">
            {instanceOperationPreview.plan.kind === "copy_component"
              ? "复制组件"
              : instanceOperationPreview.plan.kind === "copy_keyframe"
                ? "粘贴为新轨迹"
              : instanceOperationPreview.plan.kind === "join_masks"
                ? "合并 Mask"
                : instanceOperationPreview.plan.kind === "overlap"
                  ? "严格非重叠"
                : "拆分组件"}
          </span>
          <span className="text-xs text-muted-foreground">
            {instanceOperationPreview.plan.sourceCount} 个来源 → {instanceOperationPreview.plan.resultCount} 个结果
          </span>
          {instancePreviewDetail && (
            <span className="text-xs text-muted-foreground">{instancePreviewDetail}</span>
          )}
          {instancePreviewRows.length > 0 && (
            <div className="flex max-h-20 basis-full flex-wrap gap-x-3 gap-y-1 overflow-y-auto border-t border-border pt-1" aria-label="受影响 Mask 对象">
              {instancePreviewRows.map((row) => (
                <span key={row.annotationId} className="text-xs text-muted-foreground">
                  {row.annotationId.slice(0, 8)}·v{row.version ?? "?"}
                  {row.changedPixels === null ? "" : `·${row.changedPixels}px`}
                  ·{row.status === "delete"
                    ? "删除"
                    : row.status === "unresolved"
                      ? "未解决"
                      : row.status === "update"
                        ? "更新"
                        : "来源"}
                </span>
              ))}
            </div>
          )}
          <span className="text-xs text-status-caution">待原子提交</span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={instanceBusy}
            onClick={onCancelOperation}
          >取消预览</Button>
          {onCommitInstanceOperation && (
            <Button
              type="button"
              size="xs"
              disabled={instanceBusy || instanceCommitBlocked || !canEdit}
              onClick={onCommitInstanceOperation}
            >
              {instanceRefreshing ? "刷新中…" : instanceCommitting ? "提交中…" : "原子提交"}
            </Button>
          )}
        </div>
      )}
      {instanceCommitError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1" role="alert">
          <span className="text-xs text-destructive">{instanceCommitError}</span>
          {onCommitInstanceOperation && instanceCanRetry && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={instanceBusy}
              onClick={onCommitInstanceOperation}
            >重试</Button>
          )}
          {onRefreshInstanceOperation && instanceCanRefresh && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={instanceBusy}
              onClick={onRefreshInstanceOperation}
            >刷新范围</Button>
          )}
        </div>
      )}
      {operationStatus === "computing" && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1">
          <span className="text-xs text-foreground">正在计算预览…</span>
          <Button type="button" size="xs" variant="ghost" onClick={onCancelOperation}>取消</Button>
        </div>
      )}
      {operationStatus === "error" && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1">
          <span className="text-xs text-destructive">
            高级操作失败：{operationError instanceof Error ? operationError.message : String(operationError ?? "未知错误")}
          </span>
          <Button type="button" size="xs" variant="ghost" onClick={onCancelOperation}>关闭</Button>
        </div>
      )}

      <Button type="button" size="icon-xs" variant="ghost" onClick={onUndo} disabled={!canEdit || !canUndo} title="撤销笔画 (Ctrl+Z)">
        <Undo2 />
        <span className="sr-only">撤销</span>
      </Button>
      <Button type="button" size="icon-xs" variant="ghost" onClick={onRedo} disabled={!canEdit || !canRedo} title="重做笔画 (Ctrl+Y)">
        <Redo2 />
        <span className="sr-only">重做</span>
      </Button>
      {phase === "error" && onRetry && !instanceOperationPreview && (
        <Button type="button" size="sm" variant="ghost" onClick={onRetry} title="恢复或重试 Mask">
          重试
        </Button>
      )}
      <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={instanceBusy} title="取消 (Esc)">
        取消
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={onCommit}
        disabled={!canEdit || !active || !dirty || phase !== "dirty" || operationStatus !== "idle"}
        title="确认 (Enter)"
      >
        <Check /> 确认
      </Button>
      {onCommitAndPropagate && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCommitAndPropagate}
          disabled={!canEdit || !active || !dirty || phase !== "dirty" || operationStatus !== "idle"}
          title="保存人工纠错帧并选择定向重传播"
        >
          保存并传播
        </Button>
      )}
      <AlertDialog open={confirmEmptyOpen} onOpenChange={setConfirmEmptyOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空当前 Mask？</AlertDialogTitle>
            <AlertDialogDescription>
              该操作会把当前对象变为空 Mask。应用后仍可用撤销恢复，但保存时需要选择删除对象或继续编辑。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>返回预览</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onConfirmOperation}>确认清空</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

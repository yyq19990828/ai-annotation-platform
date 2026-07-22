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
} from "../state/useMaskEditor";
import type { MaskBrushShape } from "../stage/shared/geometry/maskBuffer";
import type { MaskConnectivity } from "../stage/shared/geometry/maskOperations";
import type { MaskEditorPhase } from "../state/canEditMask";

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
  operationPreview: MaskOperationPreview | null;
  operationStatus: MaskOperationStatus;
  onSetTool: (tool: MaskEditorTool) => void;
  onSetBrushShape: (shape: MaskBrushShape) => void;
  onSetConnectivity: (connectivity: MaskConnectivity) => void;
  onSetRadius: (radius: number) => void;
  onConfirmOperation: () => void;
  onCancelOperation: () => void;
  onCommit: () => void;
  onCommitAndPropagate?: () => void;
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
  operationPreview,
  operationStatus,
  onSetTool,
  onSetBrushShape,
  onSetConnectivity,
  onSetRadius,
  onConfirmOperation,
  onCancelOperation,
  onCommit,
  onCommitAndPropagate,
  onCancel,
  onUndo,
  onRedo,
  onRetry,
}: MaskToolbarProps) {
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
          高级 <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>区域工具</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onSetTool("fill_add")}>填充命中区域</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSetTool("fill_subtract")}>擦除命中区域</DropdownMenuItem>
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

      {operationPreview && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1">
          <span className="text-xs text-foreground">
            {operationLabel[operationPreview.name] ?? operationPreview.name}
          </span>
          <span className="text-xs text-muted-foreground">
            变化 {operationPreview.report.changedPixels} px
          </span>
          <Button type="button" size="xs" variant="ghost" onClick={onCancelOperation}>
            取消预览
          </Button>
          <Button type="button" size="xs" onClick={onConfirmOperation}>
            应用预览
          </Button>
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
          <span className="text-xs text-destructive">高级操作失败</span>
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
      {phase === "error" && onRetry && (
        <Button type="button" size="sm" variant="ghost" onClick={onRetry} title="恢复或重试 Mask">
          重试
        </Button>
      )}
      <Button type="button" size="sm" variant="outline" onClick={onCancel} title="取消 (Esc)">
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
    </div>
  );
}

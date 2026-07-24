import { Button } from "@/components/ui/Button";
import { ActionBar } from "./ActionBar";

const BODY_CLASS = "flex min-h-0 flex-col gap-2.5 overflow-x-hidden overflow-y-auto px-3 pt-2.5";

interface ConversionBatchCardContentProps {
  count: number;
  sourceType: string;
  readOnly: boolean;
  onConvert: () => void;
  onClear: () => void;
}

export function ConversionBatchCardContent({
  count,
  sourceType,
  readOnly,
  onConvert,
  onClear,
}: ConversionBatchCardContentProps) {
  return (
    <div className={BODY_CLASS}>
      <div className="text-sm text-foreground">
        已选 <b className="text-brand tabular-nums">{count}</b> 个同类型标注
        <div className="mt-1 text-xs text-muted-foreground">来源类型：{sourceType}</div>
      </div>
      <ActionBar label="批量转换操作">
        <Button variant="ghost" size="sm" disabled={readOnly} onClick={onConvert}>
          打开转换中心
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear}>
          取消选中
        </Button>
      </ActionBar>
    </div>
  );
}

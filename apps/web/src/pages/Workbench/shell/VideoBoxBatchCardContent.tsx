import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ActionBar } from "./selectionCard/ActionBar";

const BODY_CLASS =
  "flex min-h-0 flex-col gap-2.5 overflow-x-hidden overflow-y-auto px-3 pt-2.5";
const SUMMARY_CLASS = "flex flex-col gap-0.5 text-sm text-foreground";
const COUNT_CLASS = "text-brand tabular-nums";
const HINT_CLASS = "text-xs text-muted-foreground";

export interface VideoBoxBatchCardContentProps {
  count: number;
  /** 任务级锁定(review/completed)→ 改类 / 锁定 / 聚合 / 删除 只读。 */
  readOnly: boolean;
  /** 选中全部已锁定 → 显示「解锁」语义。 */
  allLocked: boolean;
  /** 选中全部已隐藏 → 显示「显示」语义。 */
  allHidden: boolean;
  onChangeClass: () => void;
  onToggleLock: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
  onAggregate: () => void;
  onClear: () => void;
}

/**
 * 选中信息卡的视频「单帧框(video_bbox)」多选内容,对齐图片批量卡的能力
 * (改类 / 锁定 / 隐藏 / 删除),并补一个视频专属动作「聚合为轨迹」。复用图片端
 * 既有批量 handler(按 id 通用操作),聚合走 handleVideoComposeTracks。改类弹
 * ClassPicker(视频用固定屏幕锚点,与单帧改类一致)。
 */
export function VideoBoxBatchCardContent({
  count,
  readOnly,
  allLocked,
  allHidden,
  onChangeClass,
  onToggleLock,
  onToggleHidden,
  onDelete,
  onAggregate,
  onClear,
}: VideoBoxBatchCardContentProps) {
  return (
    <div className={BODY_CLASS}>
      <div className={SUMMARY_CLASS}>
        已选 <b className={COUNT_CLASS}>{count}</b> 个单帧框
        <span className={HINT_CLASS}>操作将应用到全部选中</span>
      </div>

      <ActionBar label="批量操作">
        <Button
          variant="ghost"
          size="sm"
          title="批量改类别"
          aria-label="批量改类别"
          disabled={readOnly}
          onClick={onChangeClass}
        >
          <Icon name="tag" size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title="聚合为一条轨迹"
          aria-label="聚合为一条轨迹"
          disabled={readOnly}
          onClick={onAggregate}
        >
          <Icon name="link" size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title={allHidden ? "批量显示" : "批量隐藏"}
          aria-label={allHidden ? "批量显示" : "批量隐藏"}
          aria-pressed={allHidden}
          onClick={onToggleHidden}
        >
          <Icon name={allHidden ? "eyeOff" : "eye"} size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title={allLocked ? "批量解锁" : "批量锁定"}
          aria-label={allLocked ? "批量解锁" : "批量锁定"}
          aria-pressed={allLocked}
          disabled={readOnly}
          onClick={onToggleLock}
        >
          <Icon name={allLocked ? "lock" : "unlock"} size={14} />
        </Button>
        <Button
          variant="danger"
          size="sm"
          title="批量删除"
          aria-label="批量删除"
          disabled={readOnly}
          onClick={onDelete}
        >
          <Icon name="trash" size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title="取消选中"
          aria-label="取消选中"
          onClick={onClear}
        >
          <Icon name="x" size={14} />
        </Button>
      </ActionBar>
    </div>
  );
}

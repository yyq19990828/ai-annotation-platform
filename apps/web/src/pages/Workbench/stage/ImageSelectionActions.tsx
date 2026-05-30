import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import styles from "./ImageSelectionActions.module.css";

interface ImageSelectionActionsProps {
  onChangeClass?: () => void;
  onDelete?: () => void;
}

/**
 * 图片画布右上角的单框编辑工具条（改类 / 删除）。
 * v0.11.28 · 单框选中编辑由贴框浮条迁移到画布右上角，视觉对齐视频的 VideoSelectionActions。
 */
export function ImageSelectionActions({ onChangeClass, onDelete }: ImageSelectionActionsProps) {
  if (!onChangeClass && !onDelete) return null;

  return (
    <div
      data-testid="image-selection-actions"
      className={styles.actions}
    >
      <Button
        size="sm"
        className={styles.iconButton}
        title="修改类别 (C)"
        aria-label="修改类别"
        disabled={!onChangeClass}
        onClick={() => onChangeClass?.()}
      >
        <Icon name="tag" size={12} />
      </Button>
      <Button
        size="sm"
        className={styles.iconButton}
        title="删除"
        aria-label="删除"
        disabled={!onDelete}
        onClick={() => onDelete?.()}
      >
        <Icon name="trash" size={12} />
      </Button>
    </div>
  );
}

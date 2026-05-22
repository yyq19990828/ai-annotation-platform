import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AnnotationResponse } from "@/types";
import { isVideoTrack } from "./videoStageGeometry";
import type { VideoTrackConversionOptions } from "./videoStageTypes";
import styles from "./VideoSelectionActions.module.css";

interface VideoSelectionActionsProps {
  selectedAnnotation: AnnotationResponse | null;
  frameIndex: number;
  readOnly: boolean;
  onChangeUserBoxClass?: (id: string) => void;
  onDelete?: (annotation: AnnotationResponse) => void;
  onConvertToBboxes?: (annotation: AnnotationResponse, options: VideoTrackConversionOptions) => void;
  currentFrameOutside?: boolean;
  currentFrameOccluded?: boolean;
  selectedTrackHidden?: boolean;
  selectedTrackLocked?: boolean;
  currentFrameHasKeyframe?: boolean;
  onToggleOutside?: () => void;
  onToggleOccluded?: () => void;
  onToggleHidden?: () => void;
  onToggleLocked?: () => void;
  onDeleteTrackKeyframe?: () => void;
}

export function VideoSelectionActions({
  selectedAnnotation,
  frameIndex,
  readOnly,
  onChangeUserBoxClass,
  onDelete,
  onConvertToBboxes,
  currentFrameOutside = false,
  currentFrameOccluded = false,
  selectedTrackHidden = false,
  selectedTrackLocked = false,
  currentFrameHasKeyframe = false,
  onToggleOutside,
  onToggleOccluded,
  onToggleHidden,
  onToggleLocked,
  onDeleteTrackKeyframe,
}: VideoSelectionActionsProps) {
  if (!selectedAnnotation || readOnly) return null;

  return (
    <div
      data-testid="video-selection-actions"
      className={styles.actions}
    >
      <Button
        size="sm"
        className={styles.iconButton}
        title="修改类别"
        aria-label="修改类别"
        disabled={!onChangeUserBoxClass}
        onClick={() => onChangeUserBoxClass?.(selectedAnnotation.id)}
      >
        <Icon name="tag" size={12} />
      </Button>
      {isVideoTrack(selectedAnnotation) && (
        <>
          <Button
            size="sm"
            className={styles.iconButton}
            title={currentFrameOutside ? "恢复当前帧为正常状态" : "标记当前帧消失"}
            aria-label={currentFrameOutside ? "恢复当前帧为正常状态" : "标记当前帧消失"}
            aria-pressed={currentFrameOutside}
            disabled={selectedTrackLocked || !onToggleOutside}
            onClick={() => onToggleOutside?.()}
          >
            <Icon name="eyeOff" size={12} />
          </Button>
          <Button
            size="sm"
            className={styles.iconButton}
            title={currentFrameOccluded ? "恢复当前帧为正常状态" : "标记当前帧遮挡"}
            aria-label={currentFrameOccluded ? "恢复当前帧为正常状态" : "标记当前帧遮挡"}
            aria-pressed={currentFrameOccluded}
            disabled={selectedTrackLocked || !onToggleOccluded}
            onClick={() => onToggleOccluded?.()}
          >
            <Icon name="rect" size={12} />
          </Button>
          <Button
            size="sm"
            className={styles.iconButton}
            title={selectedTrackLocked ? "解锁轨迹" : "锁定轨迹"}
            aria-label={selectedTrackLocked ? "解锁轨迹" : "锁定轨迹"}
            aria-pressed={selectedTrackLocked}
            disabled={!onToggleLocked}
            onClick={() => onToggleLocked?.()}
          >
            <Icon name={selectedTrackLocked ? "lock" : "unlock"} size={12} />
          </Button>
          <Button
            size="sm"
            className={styles.iconButton}
            title={selectedTrackHidden ? "显示轨迹" : "隐藏轨迹"}
            aria-label={selectedTrackHidden ? "显示轨迹" : "隐藏轨迹"}
            aria-pressed={selectedTrackHidden}
            disabled={!onToggleHidden}
            onClick={() => onToggleHidden?.()}
          >
            <Icon name={selectedTrackHidden ? "eyeOff" : "eye"} size={12} />
          </Button>
          <Button
            size="sm"
            className={styles.iconButton}
            title="复制当前帧为独立框"
            aria-label="复制当前帧为独立框"
            onClick={() => onConvertToBboxes?.(selectedAnnotation, {
              operation: "copy",
              scope: "frame",
              frameIndex,
            })}
          >
            <Icon name="copy" size={12} />
          </Button>
          <Button
            size="sm"
            className={styles.iconButton}
            title="拆当前关键帧为独立框"
            aria-label="拆当前关键帧为独立框"
            onClick={() => onConvertToBboxes?.(selectedAnnotation, {
              operation: "split",
              scope: "frame",
              frameIndex,
            })}
          >
            <Icon name="scissors" size={12} />
          </Button>
        </>
      )}
      {isVideoTrack(selectedAnnotation) ? (
        <Button
          size="sm"
          className={styles.iconButton}
          title="删除当前关键帧"
          aria-label="删除当前关键帧"
          disabled={selectedTrackLocked || !currentFrameHasKeyframe || !onDeleteTrackKeyframe}
          onClick={() => onDeleteTrackKeyframe?.()}
        >
          <Icon name="trash" size={12} />
        </Button>
      ) : (
        <Button
          size="sm"
          className={styles.iconButton}
          title="删除"
          aria-label="删除"
          onClick={() => onDelete?.(selectedAnnotation)}
        >
          <Icon name="trash" size={12} />
        </Button>
      )}
    </div>
  );
}

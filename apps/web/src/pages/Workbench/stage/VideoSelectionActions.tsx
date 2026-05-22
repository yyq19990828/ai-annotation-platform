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
  onToggleOutside?: () => void;
  onToggleOccluded?: () => void;
  onToggleHidden?: () => void;
  onToggleLocked?: () => void;
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
  onToggleOutside,
  onToggleOccluded,
  onToggleHidden,
  onToggleLocked,
}: VideoSelectionActionsProps) {
  if (!selectedAnnotation || readOnly) return null;

  return (
    <div
      data-testid="video-selection-actions"
      className={styles.actions}
    >
      <Button
        size="sm"
        title="修改类别"
        disabled={!onChangeUserBoxClass}
        onClick={() => onChangeUserBoxClass?.(selectedAnnotation.id)}
      >
        <Icon name="tag" size={12} />
      </Button>
      {isVideoTrack(selectedAnnotation) && (
        <>
          <Button
            size="sm"
            title={currentFrameOutside ? "恢复当前帧为正常状态" : "标记当前帧消失"}
            aria-pressed={currentFrameOutside}
            disabled={selectedTrackLocked || !onToggleOutside}
            onClick={() => onToggleOutside?.()}
          >
            <Icon name="eyeOff" size={12} />
            消失
          </Button>
          <Button
            size="sm"
            title={currentFrameOccluded ? "恢复当前帧为正常状态" : "标记当前帧遮挡"}
            aria-pressed={currentFrameOccluded}
            disabled={selectedTrackLocked || !onToggleOccluded}
            onClick={() => onToggleOccluded?.()}
          >
            <Icon name="rect" size={12} />
            遮挡
          </Button>
          <Button
            size="sm"
            title={selectedTrackLocked ? "解锁轨迹" : "锁定轨迹"}
            aria-pressed={selectedTrackLocked}
            disabled={!onToggleLocked}
            onClick={() => onToggleLocked?.()}
          >
            <Icon name={selectedTrackLocked ? "lock" : "unlock"} size={12} />
            锁
          </Button>
          <Button
            size="sm"
            title={selectedTrackHidden ? "显示轨迹" : "隐藏轨迹"}
            aria-pressed={selectedTrackHidden}
            disabled={!onToggleHidden}
            onClick={() => onToggleHidden?.()}
          >
            <Icon name={selectedTrackHidden ? "eyeOff" : "eye"} size={12} />
            隐藏
          </Button>
          <Button
            size="sm"
            title="复制当前帧为独立框"
            onClick={() => onConvertToBboxes?.(selectedAnnotation, {
              operation: "copy",
              scope: "frame",
              frameIndex,
            })}
          >
            复制框
          </Button>
          <Button
            size="sm"
            title="拆当前关键帧为独立框"
            onClick={() => onConvertToBboxes?.(selectedAnnotation, {
              operation: "split",
              scope: "frame",
              frameIndex,
            })}
          >
            拆框
          </Button>
        </>
      )}
      <Button size="sm" title="删除" onClick={() => onDelete?.(selectedAnnotation)}>
        <Icon name="trash" size={12} />
      </Button>
    </div>
  );
}

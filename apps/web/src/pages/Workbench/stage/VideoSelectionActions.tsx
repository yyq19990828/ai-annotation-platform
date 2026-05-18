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
}

export function VideoSelectionActions({
  selectedAnnotation,
  frameIndex,
  readOnly,
  onChangeUserBoxClass,
  onDelete,
  onConvertToBboxes,
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

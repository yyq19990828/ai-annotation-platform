import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AnnotationResponse } from "@/types";
import { isVideoTrack } from "./videoStageGeometry";
import type { VideoTrackConversionOptions } from "./videoStageTypes";

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
      style={{
        position: "absolute",
        top: 14,
        right: 14,
        display: "flex",
        gap: 6,
        padding: 6,
        borderRadius: 8,
        background: "rgba(0,0,0,0.68)",
        boxShadow: "0 6px 18px rgba(0,0,0,0.24)",
      }}
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

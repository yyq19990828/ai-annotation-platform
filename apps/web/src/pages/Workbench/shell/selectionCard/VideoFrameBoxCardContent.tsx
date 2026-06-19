import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AttributeSchema } from "@/api/projects";
import type { AnnotationResponse } from "@/types";
import { AttributeForm } from "../AttributeForm";
import { IdentityHeader, annotationSourceKind } from "./IdentityHeader";
import { MetricGrid } from "./MetricGrid";
import { MetaFooter } from "./MetaFooter";
import { ActionBar } from "./ActionBar";
import { geometryMetrics } from "./geometryMetrics";

const BODY_CLASS =
  "flex min-h-0 flex-col gap-2.5 overflow-x-hidden overflow-y-auto px-3 pt-2.5";
const ATTR_BLOCK_CLASS = "border-t border-border pt-2";
const FRAME_CHIP_CLASS =
  "inline-flex flex-none items-center gap-[3px] rounded-full px-1.5 py-px text-[10px] font-medium tabular-nums whitespace-nowrap bg-brand/10 text-brand";
const FRAME_TIME_CLASS = "text-brand/75";

export interface VideoFrameBoxCardContentProps {
  /** geometry.type 必为 video_bbox(视频单帧框,不属任何轨迹)。 */
  annotation: AnnotationResponse;
  imageWidth: number | null;
  imageHeight: number | null;
  /** 视频帧率,用于把帧号换算成时间;缺省时只显示帧号。 */
  fps: number | null;
  attributeSchema: AttributeSchema | undefined;
  readOnly: boolean;
  onSeekFrame: (frameIndex: number) => void;
  onChangeClass: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateAttributes: (id: string, next: Record<string, unknown>) => void;
}

/** 秒 → 紧凑时间码 m:ss(帧定位 chip 用,不带毫秒)。 */
function formatTimecode(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * v0.16.14 · 选中视频「单帧框」(video_bbox)的浮动卡内容。
 * 单帧框不属任何轨迹,会被右栏轨迹面板过滤掉而「啥也不显示」;这里补齐帧定位
 * (F{n} · 时间)+ 结构化指标 + 属性 + 跳到该帧 / 改类 / 删除。
 */
export function VideoFrameBoxCardContent({
  annotation,
  imageWidth,
  imageHeight,
  fps,
  attributeSchema,
  readOnly,
  onSeekFrame,
  onChangeClass,
  onDelete,
  onUpdateAttributes,
}: VideoFrameBoxCardContentProps) {
  const geom = annotation.geometry;
  const frameIndex = geom.type === "video_bbox" ? geom.frame_index : null;
  const metrics = geometryMetrics(geom, imageWidth, imageHeight);
  const hasAttributes = !!attributeSchema && (attributeSchema.fields ?? []).length > 0;
  const timeLabel = frameIndex !== null && fps ? formatTimecode(frameIndex / fps) : null;

  const frameChip =
    frameIndex !== null ? (
      <span className={FRAME_CHIP_CLASS} title={`第 ${frameIndex} 帧`}>
        <Icon name="film" size={10} />F{frameIndex}
        {timeLabel && <span className={FRAME_TIME_CLASS}>· {timeLabel}</span>}
      </span>
    ) : undefined;

  return (
    <div className={BODY_CLASS}>
      <IdentityHeader
        className={annotation.class_name}
        source={annotationSourceKind(annotation)}
        trailing={frameChip}
      />

      <MetricGrid metrics={metrics} />

      {hasAttributes && (
        <div className={ATTR_BLOCK_CLASS} data-floating-panel-no-drag>
          <AttributeForm
            schema={attributeSchema}
            className={annotation.class_name}
            attributes={annotation.attributes ?? {}}
            onChange={(next) => onUpdateAttributes(annotation.id, next)}
            readOnly={readOnly}
            context="video"
            hideHeading
          />
        </div>
      )}

      <MetaFooter
        id={annotation.id}
        source={annotation.source}
        createdAt={annotation.created_at}
        updatedAt={annotation.updated_at}
        zOrder={annotation.z_order}
        groupId={annotation.group_id}
      />

      <ActionBar label="单帧框操作">
        {frameIndex !== null && (
          <Button
            variant="ghost"
            size="sm"
            title="跳到该帧"
            onClick={() => onSeekFrame(frameIndex)}
          >
            <Icon name="crosshair" size={14} />
            跳到该帧
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          title="修改类别"
          aria-label="修改类别"
          disabled={readOnly}
          onClick={() => onChangeClass(annotation.id)}
        >
          <Icon name="tag" size={14} />
        </Button>
        <Button
          variant="danger"
          size="sm"
          title="删除标注"
          aria-label="删除标注"
          disabled={readOnly}
          onClick={() => onDelete(annotation.id)}
        >
          <Icon name="trash" size={14} />
        </Button>
      </ActionBar>
    </div>
  );
}

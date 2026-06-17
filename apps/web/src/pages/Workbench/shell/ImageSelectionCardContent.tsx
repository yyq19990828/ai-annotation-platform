import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AttributeSchema } from "@/api/projects";
import type { AnnotationResponse, Geometry } from "@/types";
import { AttributeForm } from "./AttributeForm";
import styles from "./ImageSelectionCardContent.module.css";

export interface ImageSelectionCardContentProps {
  annotation: AnnotationResponse;
  imageWidth: number | null;
  imageHeight: number | null;
  attributeSchema: AttributeSchema | undefined;
  /** 任务级锁定(review/completed)→ 全部操作只读。 */
  readOnly: boolean;
  onChangeClass: (id: string) => void;
  onToggleFlag: (id: string, flag: "is_locked" | "is_hidden", value: boolean) => void;
  onDelete: (id: string) => void;
  onUpdateAttributes: (id: string, next: Record<string, unknown>) => void;
}

/** 几何只读摘要:类型 + 关键尺寸(bbox 像素 / polygon 顶点数 等)。 */
function geometrySummary(
  geometry: Geometry,
  imgW: number | null,
  imgH: number | null,
): string {
  switch (geometry.type) {
    case "bbox": {
      if (imgW && imgH) {
        return `矩形框 · ${Math.round(geometry.w * imgW)}×${Math.round(geometry.h * imgH)} px`;
      }
      return "矩形框";
    }
    case "rotated_bbox": {
      const dims = imgW && imgH
        ? ` · ${Math.round(geometry.w * imgW)}×${Math.round(geometry.h * imgH)} px`
        : "";
      return `旋转框${dims} · ${Math.round(geometry.angle)}°`;
    }
    case "polygon":
      return `多边形 · ${geometry.points.length} 顶点`;
    case "multi_polygon": {
      const verts = geometry.polygons.reduce((n, p) => n + p.points.length, 0);
      return `多连通域 · ${geometry.polygons.length} 环 / ${verts} 顶点`;
    }
    case "polyline":
      return `折线 · ${geometry.points.length} 点`;
    case "keypoint":
      return `关键点 · ${geometry.points.length} 个`;
    default:
      return geometry.type;
  }
}

/**
 * v0.16.8 · Phase 2 · 选中标注浮动信息卡的图片端内容。
 * 复用模型既有回调(改类 / 锁定 / 隐藏 / 删除 / 属性),不重写逻辑;与右栏 attrDock 共享同一批回调。
 */
export function ImageSelectionCardContent({
  annotation,
  imageWidth,
  imageHeight,
  attributeSchema,
  readOnly,
  onChangeClass,
  onToggleFlag,
  onDelete,
  onUpdateAttributes,
}: ImageSelectionCardContentProps) {
  const locked = !!annotation.is_locked;
  const hidden = !!annotation.is_hidden;

  return (
    <div className={styles.body}>
      <div className={styles.actions} data-floating-panel-no-drag>
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
          variant="ghost"
          size="sm"
          title={hidden ? "显示" : "隐藏"}
          aria-label={hidden ? "显示" : "隐藏"}
          aria-pressed={hidden}
          onClick={() => onToggleFlag(annotation.id, "is_hidden", !hidden)}
        >
          <Icon name={hidden ? "eyeOff" : "eye"} size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title={locked ? "解锁" : "锁定"}
          aria-label={locked ? "解锁" : "锁定"}
          aria-pressed={locked}
          disabled={readOnly}
          onClick={() => onToggleFlag(annotation.id, "is_locked", !locked)}
        >
          <Icon name={locked ? "lock" : "unlock"} size={14} />
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
      </div>

      <div className={styles.geomSummary}>
        {geometrySummary(annotation.geometry, imageWidth, imageHeight)}
      </div>

      {attributeSchema && (attributeSchema.fields ?? []).length > 0 && (
        <div className={styles.attrBlock} data-floating-panel-no-drag>
          <AttributeForm
            schema={attributeSchema}
            className={annotation.class_name}
            attributes={annotation.attributes ?? {}}
            onChange={(next) => onUpdateAttributes(annotation.id, next)}
            readOnly={readOnly || locked}
            context="image"
            hideHeading
          />
        </div>
      )}
    </div>
  );
}

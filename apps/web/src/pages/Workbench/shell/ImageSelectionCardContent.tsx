import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AttributeSchema } from "@/api/projects";
import type { AnnotationResponse } from "@/types";
import { AttributeForm } from "./AttributeForm";
import { IdentityHeader, annotationSourceKind } from "./selectionCard/IdentityHeader";
import { MetricGrid } from "./selectionCard/MetricGrid";
import { MetaFooter } from "./selectionCard/MetaFooter";
import { ActionBar } from "./selectionCard/ActionBar";
import { geometryMetrics } from "./selectionCard/geometryMetrics";

const BODY_CLASS =
  "flex min-h-0 flex-col gap-2.5 overflow-x-hidden overflow-y-auto px-3 pt-2.5";
const ATTR_BLOCK_CLASS = "border-t border-border pt-2";

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

/**
 * v0.16.14 · 选中标注浮动信息卡的图片端内容。
 * 由设计系统积木组合:IdentityHeader(类别 + 来源 + 置信度)/ MetricGrid(结构化几何指标)/
 * AttributeForm(属性)/ MetaFooter(折叠次要信息)/ ActionBar(改类 / 隐藏 / 锁定 / 删除)。
 * 复用模型既有回调,不重写逻辑;与右栏 attrDock 共享同一批回调。
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
  const metrics = geometryMetrics(annotation.geometry, imageWidth, imageHeight);
  const hasAttributes = !!attributeSchema && (attributeSchema.fields ?? []).length > 0;
  const source = annotationSourceKind(annotation);
  // 置信度仅对 AI 来源(采纳 / 导入)有意义;手动框即便后端落了 conf=1 也不展示 pill。
  const confidence = source === "manual" ? null : annotation.confidence;

  return (
    <div className={BODY_CLASS}>
      <IdentityHeader
        className={annotation.class_name}
        source={source}
        confidence={confidence}
      />

      <MetricGrid metrics={metrics} />

      {hasAttributes && (
        <div className={ATTR_BLOCK_CLASS} data-floating-panel-no-drag>
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

      <MetaFooter
        id={annotation.id}
        source={annotation.source}
        createdAt={annotation.created_at}
        updatedAt={annotation.updated_at}
        zOrder={annotation.z_order}
        groupId={annotation.group_id}
      />

      <ActionBar label="标注操作">
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
      </ActionBar>
    </div>
  );
}

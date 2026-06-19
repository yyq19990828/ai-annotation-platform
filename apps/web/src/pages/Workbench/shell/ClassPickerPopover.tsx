import { useEffect, useLayoutEffect, useRef } from "react";
import type { AttributeSchema } from "@/api/projects";
import type { Viewport } from "../state/useViewportTransform";
import { AttributeForm } from "./AttributeForm";
import { ClassPalette, shortcutForIndex } from "./ClassPalette";

const POPOVER_CLASS =
  "tw-scope top-[var(--class-picker-top)] left-[var(--class-picker-left)] z-30 min-w-[220px] max-w-[280px] max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card p-2.5 shadow-lg [pointer-events:auto]";

type Geom = { x: number; y: number; w: number; h: number };
type FixedAnchor = { left: number; top: number };
export type ClassPickerCancelReason = "escape" | "outside";

/** v0.11.28：改类悬浮框内联的属性编辑（与类别选择二合一，单列堆叠）。 */
export type ClassPickerAttrEditing = {
  schema: AttributeSchema;
  attributes: Record<string, unknown>;
  context: "image" | "video";
  readOnly?: boolean;
  onChange: (next: Record<string, unknown>) => void;
};

type CommonProps = {
  classes: string[];
  recent: string[];
  defaultClass: string;
  title?: string;
  onPick: (cls: string) => void;
  onCancel: (reason: ClassPickerCancelReason) => void;
  /** 传入时在类别选择下方渲染属性表单（className 跟随当前 defaultClass 联动刷新可见字段）。 */
  attrEditing?: ClassPickerAttrEditing;
};

type ImagePositionProps = CommonProps & {
  position?: "image";
  geom: Geom;
  imgW: number;
  imgH: number;
  vp: Viewport;
};

type FixedPositionProps = CommonProps & {
  position: "fixed";
  anchor: FixedAnchor;
};

type ClassPickerPopoverProps = ImagePositionProps | FixedPositionProps;

/**
 * 画框完成后的类别选择 popover。
 * - image 模式锚定到框左下角；fixed 模式使用调用方给出的 viewport 坐标
 * - 数字 1-9 / 字母 a-z 直选；Enter 默认 default；Esc 取消；点外部取消
 */
export function ClassPickerPopover({
  classes, recent, defaultClass, title = "选择类别", onPick, onCancel, attrEditing, ...positionProps
}: ClassPickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  const isFixed = positionProps.position === "fixed";
  // image 模式：框左下角（容器坐标）；fixed 模式：调用方传 viewport/client 坐标。
  const left = isFixed
    ? positionProps.anchor.left
    : (positionProps.geom.x * positionProps.imgW * positionProps.vp.scale + positionProps.vp.tx);
  const top = isFixed
    ? positionProps.anchor.top
    : ((positionProps.geom.y + positionProps.geom.h) * positionProps.imgH * positionProps.vp.scale + positionProps.vp.ty + 6);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let l = left;
    let t = top;
    // fixed 模式（改类 / SAM / 批量等由调用方给 viewport 坐标的场景）做视口边界 clamp：
    // 锚点来自列表里的触发按钮时，原始坐标常会让 popover 溢出右侧或底部，需拉回视口内，
    // 必要时翻转到锚点上方。image 模式锚定画布内的框，维持原行为不 clamp。
    if (isFixed && typeof window !== "undefined") {
      const margin = 8;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (l + rect.width > vw - margin) l = vw - margin - rect.width;
      if (l < margin) l = margin;
      if (t + rect.height > vh - margin) {
        const flipped = top - rect.height - 12; // 翻到锚点上方
        t = flipped >= margin ? flipped : Math.max(margin, vh - margin - rect.height);
      }
      if (t < margin) t = margin;
    }
    el.style.setProperty("--class-picker-left", `${l}px`);
    el.style.setProperty("--class-picker-top", `${t}px`);
  }, [left, top, isFixed]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target instanceof HTMLInputElement
          || e.target instanceof HTMLSelectElement
          || e.target instanceof HTMLTextAreaElement)
        && e.key !== "Escape" && e.key !== "Enter"
      ) {
        return; // 让搜索框 / 属性表单控件正常输入，不抢数字/字母快捷键
      }
      if (e.key === "Escape") { e.preventDefault(); onCancel("escape"); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const fallback = defaultClass || classes[0];
        if (fallback) onPick(fallback);
        return;
      }
      // 数字 1-9
      if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        if (classes[idx]) { e.preventDefault(); onPick(classes[idx]); }
        return;
      }
      // 字母 a-z (映射到 classes[9..])
      if (/^[a-z]$/i.test(e.key)) {
        const letterIdx = e.key.toLowerCase().charCodeAt(0) - "a".charCodeAt(0);
        const idx = 9 + letterIdx;
        if (classes[idx]) { e.preventDefault(); onPick(classes[idx]); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [classes, defaultClass, onPick, onCancel]);

  // click outside to cancel
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel("outside");
    };
    // 用 pointerdown(而非 mousedown):视频 Konva 画布的 pointerdown 处理会 preventDefault,
    // 抑制兼容性 mousedown。且用捕获阶段绑定:画布命中由 Konva/Stage 接管,冒泡阶段可能被
    // cancelBubble/停止传播而收不到;捕获阶段从 document 向下最先触发,谁都拦不住。
    // 延迟绑定,避免捕获到打开弹窗那次 down。
    const t = setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [onCancel]);

  return (
    <div
      ref={ref}
      data-testid="class-picker-popover"
      className={`${POPOVER_CLASS} ${isFixed ? "fixed" : "absolute"}`}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11.5px] font-semibold">{title}</div>
        <div className="text-[10px] text-muted-foreground">
          Enter ↵ 默认 · Esc 取消
        </div>
      </div>
      <ClassPalette
        classes={classes}
        recent={recent}
        activeClass={defaultClass}
        onPick={onPick}
        dense
        enableSearch={classes.length > 9}
      />
      {classes.length === 0 && (
        <div className="p-2 text-center text-xs text-muted-foreground">
          该项目尚未配置类别
        </div>
      )}
      {classes.length > 0 && (
        <div className="mt-2 text-center text-[10.5px] text-muted-foreground">
          快捷键: {shortcutForIndex(0)}…{shortcutForIndex(Math.min(classes.length - 1, 34))}
        </div>
      )}
      {attrEditing && (
        <div className="mt-1">
          <AttributeForm
            schema={attrEditing.schema}
            className={defaultClass}
            attributes={attrEditing.attributes}
            onChange={attrEditing.onChange}
            readOnly={attrEditing.readOnly}
            context={attrEditing.context}
          />
        </div>
      )}
    </div>
  );
}

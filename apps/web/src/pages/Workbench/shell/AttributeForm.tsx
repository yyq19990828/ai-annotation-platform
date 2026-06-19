import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AttributeField, AttributeSchema } from "@/api/projects";
import { Switch } from "@/components/ui/Switch";
import { usePopover } from "@/hooks/usePopover";
import type { DirtyTracker } from "../state/useDirtyTracker";

const INPUT_CLASS =
  "appearance-none rounded-[3px] border border-border bg-card px-1.5 py-1 text-xs text-foreground";

export interface AttributeFormProps {
  schema: AttributeSchema | undefined;
  className: string;
  attributes: Record<string, unknown> | undefined;
  onChange: (next: Record<string, unknown>) => void;
  readOnly?: boolean;
  /**
   * v0.10.20 · I12 多选批量编辑模式: > 1 时在表单顶部渲染 banner 提示「N 个标注被选中, 修改将应用到全部」。
   * 实际 bulk-update 路径由调用方在 onChange 中分发 (走 useAnnotationBulkUpdate);
   * 表单本身只负责 UI 提示与初始值展示 (取第一个选中标注的属性).
   */
  batchCount?: number;
  /**
   * v0.10.6 M4-γ · I13.2：可选环境位。
   * - `image`（默认）：忽略 `field.mutable` 标记，行为完全 = immutable，向后兼容。
   * - `video`：mutable 字段视觉上展示「mutable」徽标，未来由 video 工作台接 keyframe override 路径。
   */
  context?: "image" | "video";
  /**
   * v0.10.6：可选 dirty tracker（useDirtyTracker 返回值）。传入时启用「批量改 → blur 一次 commit」路径：
   * - 用户连续改 attribute 字段时，dirty 累积但 onChange 立即同步本地 draft；
   * - 表单失焦（blur 出 form 容器）时调用 flush，调用方据此决定何时真正 PATCH。
   * 不传时维持原 400ms debounce 行为（v0.6.x）。
   */
  dirtyTracker?: DirtyTracker;
  /** v0.10.6：dirty tracker 模式下，需要 annotationId 才能 mark / flush。 */
  annotationId?: string;
  /** 隐藏内部「属性」标题行：外层（侧栏底部折叠头 / 悬浮框）已承载标题时使用，避免重复。 */
  hideHeading?: boolean;
}

/** 判断 field 在当前 class + 当前值组合下是否应展示。 */
function isVisible(field: AttributeField, className: string, values: Record<string, unknown>): boolean {
  const applies = field.applies_to ?? "*";
  if (applies !== "*") {
    if (!Array.isArray(applies) || !applies.includes(className)) return false;
  }
  if (field.visible_if) {
    const cur = values[field.visible_if.key];
    if (cur !== field.visible_if.equals) return false;
  }
  return true;
}

/** 列出当前 class 下所有 required 且尚未填的 field key（缺失项）。 */
export function getMissingRequired(
  schema: AttributeSchema | undefined,
  className: string,
  attributes: Record<string, unknown> | undefined,
): string[] {
  if (!schema) return [];
  const values = attributes ?? {};
  const missing: string[] = [];
  for (const f of schema.fields ?? []) {
    if (!f.required) continue;
    if (!isVisible(f, className, values)) continue;
    const v = values[f.key];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) missing.push(f.key);
  }
  return missing;
}

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

export function AttributeForm({
  schema, className, attributes, onChange, readOnly,
  context = "image", dirtyTracker, annotationId,
  batchCount, hideHeading,
}: AttributeFormProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>(attributes ?? {});
  const lastFromUpstream = useRef<Record<string, unknown>>(attributes ?? {});
  // v0.10.6：保留最新 draft 引用，blur flush 时取最新值上抛
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  // v0.16.8：保留最新 onChange，卸载补 flush（见底部 cleanup）时用最新回调，避免闭包捕获首渲染的旧 onChange
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // 上游 attributes 变化（切选中标注 / 切类别）时同步本地 draft，避免输入残留。
  useEffect(() => {
    const next = attributes ?? {};
    if (JSON.stringify(next) !== JSON.stringify(lastFromUpstream.current)) {
      lastFromUpstream.current = next;
      setDraft(next);
    }
  }, [attributes]);

  // 防抖 400ms 上抛（dirty tracker 模式下旁路：dirty 累积，blur 时一次 flush）
  const debounceRef = useRef<number | null>(null);
  const useDirty = !!(dirtyTracker && annotationId);

  const scheduleCommit = (next: Record<string, unknown>) => {
    setDraft(next);
    if (useDirty) {
      // dirty tracker 模式：标脏即可，不立即触发 onChange；等 blur flush
      dirtyTracker!.markDirty(annotationId!, "attributes");
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      onChange(next);
      debounceRef.current = null;
    }, 400) as unknown as number;
  };

  // v0.10.6：form 整体 blur 时（焦点离开 form 容器）flush
  const handleFormBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!useDirty) return;
    // relatedTarget 仍在 form 内 → 字段间跳转，不算 blur 出
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    dirtyTracker!.flush(annotationId!, () => {
      onChange(draftRef.current);
    });
  };

  // v0.16.8 修复「改属性看似改了实则没保存」：debounce 路径下，组件卸载前若仍有未到点的提交
  // （如 ClassPickerPopover 内联属性编辑 <400ms 内关闭弹层），用最新 draft 补 flush 一次，
  // 避免待提交的 onChange 被 clearTimeout 丢弃。debounceRef 为 null（已 flush / dirty 模式）时不触发，杜绝重复提交。
  useEffect(() => () => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
      onChangeRef.current(draftRef.current);
    }
  }, []);

  const visible = useMemo(
    () => (schema?.fields ?? []).filter((f) => isVisible(f, className, draft)),
    [schema, className, draft],
  );

  if (!schema || visible.length === 0) return null;

  const missing = getMissingRequired(schema, className, draft);

  return (
    <div
      className="flex flex-col gap-1.5 border-t border-border px-3 pb-2.5 pt-2"
      onBlur={handleFormBlur}
    >
      {batchCount && batchCount > 1 && (
        <div
          className="rounded border border-amber-500 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400"
          data-testid="attribute-form-batch-banner"
          role="status"
        >
          <b>{batchCount}</b> 个标注被选中, 修改将应用到全部
        </div>
      )}
      {!hideHeading && (
        <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-muted-foreground">
          属性 {missing.length > 0 && <span className="text-rose-600 dark:text-rose-400">· {missing.length} 项必填未填</span>}
        </div>
      )}
      {visible.map((f) => {
        const v = draft[f.key];
        const isMissing = f.required && missing.includes(f.key);
        const setValue = (newV: unknown) => scheduleCommit({ ...draft, [f.key]: newV });
        return (
          <label
            key={f.key}
            className={cn(
              "flex flex-col gap-1 rounded border border-transparent px-1.5 py-[3px]",
              f.type === "boolean" && "flex-row items-center justify-between gap-2",
              isMissing && "border-rose-400/60 bg-rose-500/10",
            )}
          >
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-foreground">
              {f.label}
              {f.required && <span className="ml-1 text-rose-600 dark:text-rose-400">*</span>}
              {/* v0.10.6 M4-γ · I13.2：视频任务下 mutable 字段标记徽标，提示「逐 keyframe 可变」语义。 */}
              {context === "video" && f.mutable === true && (
                <span
                  title="逐 keyframe 可变（mutable）"
                  data-testid={`attr-mutable-badge-${f.key}`}
                  className="rounded-[3px] border border-amber-500/40 bg-amber-500/10 px-[5px] py-px text-[9.5px] font-semibold uppercase leading-[1.2] tracking-[0.3px] text-amber-600 dark:text-amber-400"
                >
                  逐帧
                </span>
              )}
              {f.description && <DescriptionPopover description={f.description} />}
              {f.hotkey && (f.type === "boolean" || f.type === "select") && (
                <span
                  className="mono rounded-[3px] border border-b-2 border-brand/30 bg-brand/10 px-1.5 py-px text-[10.5px] font-semibold text-brand"
                  title={`选中标注后按 ${f.hotkey} 切换该属性`}
                >
                  ⌨ {f.hotkey}
                </span>
              )}
            </span>
            {f.type === "text" && (
              <input
                type="text"
                value={(v as string) ?? ""}
                disabled={readOnly}
                onChange={(e) => setValue(e.target.value)}
                className={INPUT_CLASS}
              />
            )}
            {f.type === "number" && (
              <input
                type="number"
                value={(v as number | string | undefined) ?? ""}
                min={f.min ?? undefined}
                max={f.max ?? undefined}
                disabled={readOnly}
                onChange={(e) => {
                  const n = e.target.value === "" ? undefined : Number(e.target.value);
                  setValue(n);
                }}
                className={INPUT_CLASS}
              />
            )}
            {f.type === "boolean" && (
              <Switch
                checked={!!v}
                disabled={readOnly}
                onChange={(next) => setValue(next)}
              />
            )}
            {f.type === "select" && (
              <select
                value={(v as string) ?? ""}
                disabled={readOnly}
                onChange={(e) => setValue(e.target.value || undefined)}
                className={`${INPUT_CLASS} cursor-pointer`}
              >
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
            {f.type === "multiselect" && (
              <select
                multiple
                value={Array.isArray(v) ? (v as string[]) : []}
                disabled={readOnly}
                onChange={(e) => {
                  const arr = Array.from(e.target.selectedOptions).map((o) => o.value);
                  setValue(arr);
                }}
                className={`${INPUT_CLASS} h-20`}
              >
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
            {f.type === "range" && (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={f.min ?? 0}
                  max={f.max ?? 100}
                  value={typeof v === "number" ? v : f.min ?? 0}
                  disabled={readOnly}
                  onChange={(e) => setValue(Number(e.target.value))}
                  className="flex-1 accent-brand"
                />
                <span className="mono min-w-[2.5ch] text-right text-[11.5px] text-muted-foreground">
                  {typeof v === "number" ? v : f.min ?? 0}
                </span>
              </div>
            )}
          </label>
        );
      })}
    </div>
  );
}

/** v0.6.4：description 支持 markdown（链接 / 加粗 / 列表 / 换行）。
 *  hover 或 focus 时弹出 popover，点击外部关闭。链接强制 target=_blank。
 *  GFM 启用，但禁 raw HTML（react-markdown 默认不开 rehype-raw，避免 XSS）。
 */
function DescriptionPopover({ description }: { description: string }) {
  // v0.7.0：迁移到 usePopover（统一 click-outside + ESC 行为）
  const pop = usePopover();
  const containerRef = useRef<HTMLSpanElement | null>(null);

  return (
    <span
      ref={(node) => {
        containerRef.current = node;
        pop.anchorRef.current = node;
      }}
      onMouseEnter={() => pop.setOpen(true)}
      onMouseLeave={() => pop.close()}
      className="relative inline-flex"
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); pop.toggle(); }}
        aria-label={`查看说明：${description.slice(0, 50)}`}
        className="inline-flex size-3.5 cursor-help appearance-none items-center justify-center rounded-full border border-border bg-muted p-0 text-[9px] font-semibold text-muted-foreground"
      >
        i
      </button>
      {pop.open && (
        <div
          ref={pop.popoverRef as React.MutableRefObject<HTMLDivElement | null>}
          role="tooltip"
          className="absolute left-0 top-[calc(100%+4px)] z-[1000] min-w-[180px] max-w-[280px] rounded border border-border bg-card px-2.5 py-2 text-xs leading-normal text-foreground shadow-lg [pointer-events:auto]"
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand">
                  {children}
                </a>
              ),
              p: ({ children }) => <p className="mb-1.5">{children}</p>,
              ul: ({ children }) => <ul className="mb-1.5 pl-4">{children}</ul>,
              ol: ({ children }) => <ol className="mb-1.5 pl-4">{children}</ol>,
              code: ({ children }) => (
                <code className="rounded-[3px] border border-border bg-muted px-1 py-px font-mono text-[11px] text-muted-foreground">
                  {children}
                </code>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-foreground">{children}</strong>
              ),
              em: ({ children }) => (
                <em className="text-muted-foreground">{children}</em>
              ),
              li: ({ children }) => <li className="mb-0.5">{children}</li>,
            }}
          >
            {description}
          </ReactMarkdown>
        </div>
      )}
    </span>
  );
}

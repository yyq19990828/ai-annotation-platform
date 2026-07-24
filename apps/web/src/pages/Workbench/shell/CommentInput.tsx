import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { UserPicker, type UserPickerOption } from "@/components/UserPicker";
import { CanvasDrawingEditor } from "@/components/CanvasDrawingEditor";
import {
  commentsApi,
  type AnnotationCommentAnchor,
  type CommentAttachment,
  type CommentCanvasDrawing,
  type CommentMention,
} from "@/api/comments";

// mention chip(@提及):brand 语义色 + 柔底,亮暗主题统一走 token。
// 经 raw DOM(insertMentionChip)与 React(renderCommentBody)两条路径共用,故抽成静态串。
const MENTION_CHIP = "mx-px rounded-[3px] bg-brand/15 px-1.5 py-px font-medium text-brand";

interface CommentInputProps {
  annotationId: string;
  /** 项目成员候选；触发 @ 时作为 UserPicker 的源。 */
  members: UserPickerOption[];
  busy?: boolean;
  /** Reviewer 端：传入当前题图 URL，画布批注弹窗以此为背景。 */
  backgroundUrl?: string | null;
  /** v0.6.4：图像真实尺寸；画布批注按真实比例，避免 16:9 / 4:3 上批注被拉成 600×400 比例。*/
  imageWidth?: number | null;
  imageHeight?: number | null;
  /** 是否显示「画布批注」入口（仅 reviewer 端默认开启）。 */
  enableCanvasDrawing?: boolean;
  /** v0.6.4：在题图上直接画批注的桥接（与 ImageStage CanvasDrawingLayer 共享坐标系）。
   *  active=true 时，本组件不渲染入口按钮（toolbar 移到 ImageStage 上方）；
   *  result 非空表示一段绘制完成，本组件应消费并写回 canvasDrawing 后调 onConsume。*/
  liveCanvas?: {
    active: boolean;
    result: CommentCanvasDrawing | null;
    onStart: (initial?: CommentCanvasDrawing | null) => void;
    onConsume: () => void;
  };
  anchor?: AnnotationCommentAnchor | null;
  /** v0.11.12 · 上报当前 pending 批注，让画布把「正在编辑的评论」的批注预览出来。 */
  onPendingDrawingChange?: (drawing: CommentCanvasDrawing | null) => void;
  onSubmit: (payload: {
    body: string;
    mentions: CommentMention[];
    attachments: CommentAttachment[];
    canvas_drawing: CommentCanvasDrawing | null;
    anchor?: AnnotationCommentAnchor | null;
  }) => void | Promise<unknown>;
}

interface PickerState {
  open: boolean;
  anchor: { left: number; top: number };
  /** @ 后的过滤 query。 */
  query: string;
  /** @ 起始 Range（用于替换为 chip）。 */
  triggerRange: { node: Node; offset: number } | null;
}

const MAX_ATTACH_BYTES = 20 * 1024 * 1024; // 20MB / file

function sourceLabel(source: NonNullable<AnnotationCommentAnchor["source"]>): string {
  if (source === "prediction") return "prediction";
  if (source === "interpolated") return "interpolated";
  if (source === "legacy") return "legacy bbox";
  return "manual";
}

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

/** Serialize contenteditable 内容：扁平化文本 + 抽取 mention chip 的 (offset, length, userId, displayName)。
 *  v0.6.6 起 export 给单测。 */
export function serialize(root: HTMLElement): { body: string; mentions: CommentMention[] } {
  let body = "";
  const mentions: CommentMention[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      body += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const uid = el.getAttribute("data-mention-uid");
    if (uid) {
      const name = el.getAttribute("data-mention-name") ?? el.textContent ?? "";
      const text = `@${name}`;
      mentions.push({
        userId: uid,
        displayName: name,
        offset: body.length,
        length: text.length,
      });
      body += text;
      return;
    }
    if (el.tagName === "BR") {
      body += "\n";
      return;
    }
    el.childNodes.forEach(walk);
    // block 元素之间补换行（避免 div 包裹时丢失换行）
    if (["DIV", "P"].includes(el.tagName) && body && !body.endsWith("\n")) {
      body += "\n";
    }
  };
  root.childNodes.forEach(walk);
  return { body: body.trim(), mentions };
}

/** 把 @+name 注入到当前光标位置：插入 chip span，替换之前的 `@query` 文本。 */
function insertMentionChip(triggerRange: { node: Node; offset: number }, opt: UserPickerOption) {
  const sel = window.getSelection();
  if (!sel) return;

  // 计算 trigger（@ 字符）到当前光标之间的范围
  const r = document.createRange();
  r.setStart(triggerRange.node, triggerRange.offset);
  if (sel.rangeCount > 0) {
    const cur = sel.getRangeAt(0);
    r.setEnd(cur.endContainer, cur.endOffset);
  }
  r.deleteContents();

  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.setAttribute("data-mention-uid", opt.id);
  chip.setAttribute("data-mention-name", opt.name);
  chip.className = MENTION_CHIP;
  chip.textContent = `@${opt.name}`;

  r.insertNode(chip);

  // 在 chip 之后追加一个空格（让用户继续输入更自然）
  const space = document.createTextNode(" ");
  chip.after(space);

  // 把光标放到 space 之后
  const newRange = document.createRange();
  newRange.setStartAfter(space);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

export function CommentInput({
  annotationId,
  members,
  busy,
  backgroundUrl,
  imageWidth,
  imageHeight,
  enableCanvasDrawing,
  liveCanvas,
  anchor,
  onPendingDrawingChange,
  onSubmit,
}: CommentInputProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [picker, setPicker] = useState<PickerState>({
    open: false,
    anchor: { left: 0, top: 0 },
    query: "",
    triggerRange: null,
  });
  const [attachments, setAttachments] = useState<CommentAttachment[]>([]);
  const [canvasDrawing, setCanvasDrawing] = useState<CommentCanvasDrawing | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  // v0.6.4：消费来自 ImageStage 的 live canvas 结果
  useEffect(() => {
    if (liveCanvas?.result) {
      setCanvasDrawing(
        liveCanvas.result.shapes && liveCanvas.result.shapes.length > 0 ? liveCanvas.result : null,
      );
      liveCanvas.onConsume();
    }
  }, [liveCanvas]);

  // v0.11.12：把当前 pending 批注上报给画布预览通道；卸载时清空。
  useEffect(() => {
    onPendingDrawingChange?.(canvasDrawing);
    return () => onPendingDrawingChange?.(null);
  }, [canvasDrawing, onPendingDrawingChange]);

  const reset = useCallback(() => {
    if (editorRef.current) editorRef.current.innerHTML = "";
    setAttachments([]);
    setCanvasDrawing(null);
    setPicker({ open: false, anchor: { left: 0, top: 0 }, query: "", triggerRange: null });
  }, []);

  /** 监听 input：检测 @ 触发；维护光标处的 query 用于 picker 过滤。 */
  const handleInput = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const offset = range.startOffset;
    if (node.nodeType !== Node.TEXT_NODE) {
      setPicker((p) => (p.open ? { ...p, open: false } : p));
      return;
    }
    const text = node.textContent ?? "";
    // 反向查找最近的 @；要求 @ 前是空白 / 文首
    let at = -1;
    for (let i = offset - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === "@") {
        if (i === 0 || /[\s\u00A0]/.test(text[i - 1])) at = i;
        break;
      }
      if (/[\s\u00A0]/.test(ch)) break;
    }
    if (at < 0) {
      setPicker((p) => (p.open ? { ...p, open: false } : p));
      return;
    }
    const query = text.slice(at + 1, offset);
    // 锚点：当前光标 caret 的 ClientRect
    const tmpRange = document.createRange();
    tmpRange.setStart(node, at);
    tmpRange.setEnd(node, offset);
    const rect = tmpRange.getBoundingClientRect();
    setPicker({
      open: true,
      anchor: { left: rect.left, top: rect.bottom + 4 },
      query,
      triggerRange: { node, offset: at },
    });
  }, []);

  const handlePick = useCallback(
    (opt: UserPickerOption) => {
      if (!picker.triggerRange) return;
      insertMentionChip(picker.triggerRange, opt);
      setPicker({ open: false, anchor: { left: 0, top: 0 }, query: "", triggerRange: null });
      editorRef.current?.focus();
    },
    [picker.triggerRange],
  );

  const handleFileUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      const added: CommentAttachment[] = [];
      try {
        for (const f of Array.from(files)) {
          if (f.size > MAX_ATTACH_BYTES) {
            pushToast({ msg: `${f.name} 超过 20MB，已跳过`, kind: "warning" });
            continue;
          }
          const init = await commentsApi.attachmentUploadInit(annotationId, {
            file_name: f.name,
            content_type: f.type || "application/octet-stream",
          });
          const putRes = await fetch(init.upload_url, {
            method: "PUT",
            body: f,
            headers: { "Content-Type": f.type || "application/octet-stream" },
          });
          if (!putRes.ok) throw new Error(`上传失败 (HTTP ${putRes.status})`);
          added.push({
            storageKey: init.storage_key,
            fileName: f.name,
            mimeType: f.type || "application/octet-stream",
            size: f.size,
          });
        }
        if (added.length > 0) {
          setAttachments((prev) => [...prev, ...added]);
        }
      } catch (err) {
        pushToast({ msg: "附件上传失败", sub: String(err), kind: "error" });
      } finally {
        setUploading(false);
      }
    },
    [annotationId, pushToast],
  );

  const handleSubmit = useCallback(async () => {
    if (!editorRef.current) return;
    const { body, mentions } = serialize(editorRef.current);
    if (!body && attachments.length === 0 && !canvasDrawing) return;
    try {
      // 成功后才 reset：提交失败（如后端校验 / 网络）时保留草稿与画布批注，不静默丢失。
      await onSubmit({ body, mentions, attachments, canvas_drawing: canvasDrawing, anchor });
      reset();
    } catch {
      // 失败提示由 mutation 的 onError 负责；此处仅阻止 reset。
    }
  }, [anchor, attachments, canvasDrawing, onSubmit, reset]);

  const submitDisabled = busy || uploading;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={editorRef}
        contentEditable={!busy}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={(e) => {
          // Enter 提交（Shift+Enter 换行）
          if (e.key === "Enter" && !e.shiftKey && !picker.open) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        data-placeholder="留言（@ 提及成员，可附图）..."
        className="max-h-40 min-h-[56px] overflow-y-auto whitespace-pre-wrap rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none [font:inherit] empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
      />
      {anchor?.kind === "video_frame" && (
        <div
          data-testid="comment-anchor-preview"
          className="inline-flex select-none items-center gap-1.5 self-start rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          <Icon name="film" size={12} />
          <span className="mono">F{anchor.frameIndex}</span>
          {anchor.trackId && <span className="mono">{anchor.trackId.slice(0, 8)}</span>}
          {anchor.source && <span>{sourceLabel(anchor.source)}</span>}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {attachments.map((a, i) => (
            <div
              key={a.storageKey}
              className="inline-flex items-center gap-1 rounded-[3px] border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
              title={`${(a.size / 1024).toFixed(1)} KB`}
            >
              <Icon name="folder" size={11} />
              <span className="max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap">
                {a.fileName}
              </span>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                className="inline-flex cursor-pointer appearance-none items-center border-0 bg-transparent p-0 text-muted-foreground"
                aria-label="移除附件"
              >
                <Icon name="x" size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-2">
          <label
            className={cn(
              "inline-flex items-center gap-1 text-xs text-muted-foreground",
              uploading ? "cursor-wait" : "cursor-pointer",
            )}
          >
            <Icon name="upload" size={12} />
            {uploading ? "上传中…" : "附件"}
            <input
              type="file"
              multiple
              disabled={uploading || busy}
              onChange={(e) => handleFileUpload(e.target.files)}
              className="hidden"
            />
          </label>
          {enableCanvasDrawing && (
            <button
              type="button"
              onClick={() => setCanvasOpen(true)}
              disabled={!backgroundUrl}
              className={cn(
                "inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-xs font-normal text-muted-foreground",
                canvasDrawing && "font-semibold text-brand",
                !backgroundUrl && "cursor-default text-muted-foreground/60",
              )}
              title={
                backgroundUrl ? "弹窗内绘制（与原图比例对齐）" : "题图未加载，无法在空白画布上批注"
              }
            >
              <Icon name="edit" size={12} />
              {canvasDrawing ? `批注 · ${(canvasDrawing.shapes ?? []).length} 条` : "弹窗批注"}
            </button>
          )}
          {liveCanvas && (
            <button
              type="button"
              onClick={() => liveCanvas.onStart(canvasDrawing)}
              disabled={liveCanvas.active}
              className={cn(
                "inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-xs font-normal text-brand",
                liveCanvas.active && "cursor-default text-muted-foreground/60",
              )}
              title="直接在题图上绘制 — 缩放/平移自动跟随"
            >
              <Icon name="target" size={12} />
              {liveCanvas.active ? "正在绘制…" : "在题图上绘制"}
            </button>
          )}
        </div>
        <Button size="sm" variant="primary" disabled={submitDisabled} onClick={handleSubmit}>
          {busy ? "发送中..." : "发送"}
        </Button>
      </div>
      {enableCanvasDrawing && (
        <CanvasDrawingEditor
          open={canvasOpen}
          onClose={() => setCanvasOpen(false)}
          onSave={setCanvasDrawing}
          initial={canvasDrawing}
          backgroundUrl={backgroundUrl}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
        />
      )}
      {picker.open && (
        <UserPicker
          anchor={picker.anchor}
          options={members}
          query={picker.query}
          onPick={handlePick}
          onClose={() => setPicker((p) => ({ ...p, open: false }))}
        />
      )}
    </div>
  );
}

/** 把后端返回的 body + mentions[] 还原成 React 节点（用于历史评论渲染）。
 *  渲染规则：mentions 按 offset 排序，依次插入 chip；其它文字作为纯文本。 */
export function renderCommentBody(
  body: string,
  mentions: CommentMention[],
  onMentionClick?: (userId: string) => void,
) {
  if (mentions.length === 0) return body;
  const sorted = [...mentions].sort((a, b) => a.offset - b.offset);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((m, i) => {
    if (m.offset > cursor) parts.push(body.slice(cursor, m.offset));
    parts.push(
      <span
        key={i}
        onClick={() => onMentionClick?.(m.userId)}
        className={cn(MENTION_CHIP, onMentionClick ? "cursor-pointer" : "cursor-default")}
      >
        @{m.displayName}
      </span>,
    );
    cursor = m.offset + m.length;
  });
  if (cursor < body.length) parts.push(body.slice(cursor));
  return parts;
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { UserPicker, type UserPickerOption } from "@/components/UserPicker";
import { CanvasDrawingEditor } from "@/components/CanvasDrawingEditor";
import { commentsApi, type CommentAttachment, type CommentCanvasDrawing, type CommentMention } from "@/api/comments";

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
  onSubmit: (payload: {
    body: string;
    mentions: CommentMention[];
    attachments: CommentAttachment[];
    canvas_drawing: CommentCanvasDrawing | null;
  }) => void;
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
  chip.className = "mention-chip";
  chip.textContent = `@${opt.name}`;
  chip.style.cssText =
    "padding: 1px 6px; margin: 0 1px; background: oklch(0.55 0.18 250 / 0.15); color: oklch(0.55 0.18 250); border-radius: 3px; font-weight: 500;";

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

export function CommentInput({ annotationId, members, busy, backgroundUrl, imageWidth, imageHeight, enableCanvasDrawing, liveCanvas, onSubmit }: CommentInputProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [picker, setPicker] = useState<PickerState>({ open: false, anchor: { left: 0, top: 0 }, query: "", triggerRange: null });
  const [attachments, setAttachments] = useState<CommentAttachment[]>([]);
  const [canvasDrawing, setCanvasDrawing] = useState<CommentCanvasDrawing | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  // v0.6.4：消费来自 ImageStage 的 live canvas 结果
  useEffect(() => {
    if (liveCanvas?.result) {
      setCanvasDrawing(liveCanvas.result.shapes && liveCanvas.result.shapes.length > 0 ? liveCanvas.result : null);
      liveCanvas.onConsume();
    }
  }, [liveCanvas]);

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

  const handlePick = useCallback((opt: UserPickerOption) => {
    if (!picker.triggerRange) return;
    insertMentionChip(picker.triggerRange, opt);
    setPicker({ open: false, anchor: { left: 0, top: 0 }, query: "", triggerRange: null });
    editorRef.current?.focus();
  }, [picker.triggerRange]);

  const handleFileUpload = useCallback(async (files: FileList | null) => {
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
  }, [annotationId, pushToast]);

  const handleSubmit = useCallback(() => {
    if (!editorRef.current) return;
    const { body, mentions } = serialize(editorRef.current);
    if (!body && attachments.length === 0 && !canvasDrawing) return;
    onSubmit({ body, mentions, attachments, canvas_drawing: canvasDrawing });
    reset();
  }, [attachments, canvasDrawing, onSubmit, reset]);

  const submitDisabled = busy || uploading;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
        style={{
          minHeight: 56,
          maxHeight: 160,
          overflowY: "auto",
          fontSize: 12,
          padding: "6px 8px",
          background: "var(--color-bg-elev)",
          border: "1px solid var(--color-border)",
          borderRadius: 4,
          color: "var(--color-fg)",
          fontFamily: "inherit",
          outline: "none",
          whiteSpace: "pre-wrap",
        }}
      />
      {attachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {attachments.map((a, i) => (
            <div
              key={a.storageKey}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                padding: "2px 6px",
                background: "var(--color-bg-sunken)",
                border: "1px solid var(--color-border)",
                borderRadius: 3,
                color: "var(--color-fg)",
              }}
              title={`${(a.size / 1024).toFixed(1)} KB`}
            >
              <Icon name="folder" size={11} />
              <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.fileName}
              </span>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--color-fg-muted)",
                  cursor: "pointer",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                }}
                aria-label="移除附件"
              >
                <Icon name="x" size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label
            style={{
              fontSize: 11,
              color: "var(--color-fg-muted)",
              cursor: uploading ? "wait" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon name="upload" size={12} />
            {uploading ? "上传中…" : "附件"}
            <input
              type="file"
              multiple
              disabled={uploading || busy}
              onChange={(e) => handleFileUpload(e.target.files)}
              style={{ display: "none" }}
            />
          </label>
          {enableCanvasDrawing && (
            <button
              type="button"
              onClick={() => setCanvasOpen(true)}
              style={{
                fontSize: 11,
                color: canvasDrawing ? "oklch(0.55 0.18 250)" : "var(--color-fg-muted)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontWeight: canvasDrawing ? 600 : 400,
              }}
              title="弹窗内绘制（与原图比例对齐）"
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
              style={{
                fontSize: 11,
                color: liveCanvas.active ? "var(--color-fg-subtle)" : "oklch(0.55 0.18 250)",
                background: "transparent",
                border: "none",
                cursor: liveCanvas.active ? "default" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
              title="直接在题图上绘制 — 缩放/平移自动跟随"
            >
              <Icon name="target" size={12} />
              {liveCanvas.active ? "正在绘制…" : "在题图上绘制"}
            </button>
          )}
        </div>
        <Button
          size="sm"
          variant="primary"
          disabled={submitDisabled}
          onClick={handleSubmit}
        >
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
export function renderCommentBody(body: string, mentions: CommentMention[], onMentionClick?: (userId: string) => void) {
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
        style={{
          padding: "1px 6px",
          margin: "0 1px",
          background: "oklch(0.55 0.18 250 / 0.15)",
          color: "oklch(0.55 0.18 250)",
          borderRadius: 3,
          fontWeight: 500,
          cursor: onMentionClick ? "pointer" : "default",
        }}
      >
        @{m.displayName}
      </span>,
    );
    cursor = m.offset + m.length;
  });
  if (cursor < body.length) parts.push(body.slice(cursor));
  return parts;
}

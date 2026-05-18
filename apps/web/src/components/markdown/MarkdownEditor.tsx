import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import styles from "./MarkdownEditor.module.css";

interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** 拖拽 / 粘贴图片时上传; 返回 markdown 中要插入的 src (例如 "guide-asset:KEY"). */
  onUploadImage?: (file: File) => Promise<{ src: string; alt?: string }>;
  placeholder?: string;
}

/**
 * v0.10.13 · E1 · CodeMirror 6 Markdown 编辑器.
 *
 * - 行号 / 自动换行 / undo-redo / 默认 markdown 语法
 * - 工具栏: 粗体 / 斜体 / 标题 / 列表 / 链接 / 图片 / 代码块
 * - 拖拽 / 粘贴图片: 调 onUploadImage 上传后插入 ![](src)
 *
 * 通过路由级 dynamic import 加载, 避免污染 dashboard 首屏 bundle.
 */
export function MarkdownEditor({
  value,
  onChange,
  onUploadImage,
  placeholder,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onUploadRef = useRef(onUploadImage);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  onChangeRef.current = onChange;
  onUploadRef.current = onUploadImage;

  const insertAtCursor = useCallback((text: string) => {
    const v = viewRef.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    v.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    v.focus();
  }, []);

  const wrapSelection = useCallback((prefix: string, suffix = prefix) => {
    const v = viewRef.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    const selected = v.state.doc.sliceString(from, to);
    const insert = `${prefix}${selected}${suffix}`;
    v.dispatch({
      changes: { from, to, insert },
      selection: {
        anchor: from + prefix.length,
        head: from + prefix.length + selected.length,
      },
    });
    v.focus();
  }, []);

  const handleUpload = useCallback(async (file: File) => {
    const upload = onUploadRef.current;
    if (!upload) return;
    if (!file.type.startsWith("image/")) return;
    setUploading(file.name);
    try {
      const { src, alt } = await upload(file);
      insertAtCursor(`![${alt ?? file.name}](${src})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      insertAtCursor(`<!-- 上传失败: ${msg} -->`);
    } finally {
      setUploading(null);
    }
  }, [insertAtCursor]);

  // ── CodeMirror lifecycle ─────────────────────────────────
  useEffect(() => {
    if (!hostRef.current) return;
    const updateListener = EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        onChangeRef.current(u.state.doc.toString());
      }
    });
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        EditorView.lineWrapping,
        updateListener,
        EditorView.domEventHandlers({
          drop: (event) => {
            const files = Array.from(event.dataTransfer?.files ?? []);
            const imgs = files.filter((f) => f.type.startsWith("image/"));
            if (imgs.length > 0) {
              event.preventDefault();
              setDragging(false);
              imgs.forEach((f) => void handleUpload(f));
              return true;
            }
            return false;
          },
          dragover: (event) => {
            event.preventDefault();
            setDragging(true);
            return false;
          },
          dragleave: () => {
            setDragging(false);
            return false;
          },
          paste: (event) => {
            const items = Array.from(event.clipboardData?.items ?? []);
            const imgs = items
              .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
              .map((it) => it.getAsFile())
              .filter((f): f is File => f !== null);
            if (imgs.length > 0) {
              event.preventDefault();
              imgs.forEach((f) => void handleUpload(f));
              return true;
            }
            return false;
          },
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 仅初始化一次; value 变更通过下面 effect 同步, 避免拆装。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部 value 变更同步到 CM (例如用户点"重置")
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) {
      v.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  const onImageButton = useCallback(() => {
    const upload = onUploadRef.current;
    if (!upload) {
      insertAtCursor("![alt](https://...)");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void handleUpload(file);
    };
    input.click();
  }, [handleUpload, insertAtCursor]);

  // placeholder 由首次 effect 设置只读副本，避免每次 render 干扰
  useEffect(() => {
    if (!placeholder) return;
    const v = viewRef.current;
    if (!v) return;
    if (v.state.doc.length === 0) {
      // CodeMirror 6 placeholder 需要 extension; 这里用 DOM attr 暗示
      hostRef.current?.setAttribute("data-placeholder", placeholder);
    }
  }, [placeholder]);

  const toolbarButtons = useMemo(
    () => [
      { label: "B", title: "粗体", onClick: () => wrapSelection("**") },
      { label: "I", title: "斜体", onClick: () => wrapSelection("*") },
      { label: "H1", title: "一级标题", onClick: () => insertAtCursor("\n# ") },
      { label: "H2", title: "二级标题", onClick: () => insertAtCursor("\n## ") },
      { label: "·列表", title: "无序列表", onClick: () => insertAtCursor("\n- ") },
      { label: "1.列表", title: "有序列表", onClick: () => insertAtCursor("\n1. ") },
      { label: "🔗", title: "链接", onClick: () => insertAtCursor("[text](https://)") },
      { label: "🖼", title: "图片", onClick: onImageButton },
      { label: "</>", title: "代码块", onClick: () => insertAtCursor("\n```\n\n```\n") },
    ],
    [insertAtCursor, onImageButton, wrapSelection],
  );

  return (
    <div className={styles.root}>
      <div className={styles.toolbar} role="toolbar" aria-label="Markdown 工具栏">
        {toolbarButtons.map((b) => (
          <button key={b.label} type="button" title={b.title} onClick={b.onClick}>
            {b.label}
          </button>
        ))}
      </div>
      <div
        ref={hostRef}
        className={`${styles.cmHost} ${dragging ? styles.dragging : ""}`}
        data-testid="markdown-editor"
      />
      {uploading && (
        <div className={styles.uploading} aria-live="polite">
          上传中: {uploading}
        </div>
      )}
    </div>
  );
}

export default MarkdownEditor;

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { useProjectMembers } from "@/hooks/useProjects";
import { CanvasDrawingPreview } from "@/components/CanvasDrawingEditor";
import { useHoveredCommentStore } from "../state/useHoveredCommentStore";
import {
  useAnnotationComments,
  useCreateComment,
  usePatchComment,
  useDeleteComment,
} from "@/hooks/useAnnotationComments";
import { useAnnotationAuditHistory } from "@/hooks/useAnnotationAuditHistory";
import { AnnotationHistoryTimeline } from "@/components/AnnotationHistoryTimeline";
import { CommentInput, renderCommentBody } from "./CommentInput";
import type { CommentAttachment, CommentCanvasDrawing, CommentMention } from "@/api/comments";

type Tab = "comments" | "history";

interface Props {
  annotationId: string | null;
  /** 项目 id：用于拉取成员供 @ 提及 picker 选择。 */
  projectId?: string | null;
  /** 当前用户 id（用于判断"作者操作权"）。 */
  currentUserId?: string;
  /** Reviewer 端：传入题图 URL；启用画布批注按钮，渲染画布预览时也用作背景。 */
  backgroundUrl?: string | null;
  /** v0.6.4：图像真实尺寸；CanvasDrawingEditor / Preview 都按真实比例渲染。*/
  imageWidth?: number | null;
  imageHeight?: number | null;
  /** 是否启用画布批注入口（默认 false，仅 reviewer 端开启）。 */
  enableCanvasDrawing?: boolean;
  /** v0.6.4：在题图上直接绘制的桥接，由 WorkbenchShell 通过 useWorkbenchState 提供。*/
  liveCanvas?: {
    active: boolean;
    result: CommentCanvasDrawing | null;
    onStart: (initial?: CommentCanvasDrawing | null) => void;
    onConsume: () => void;
  };
}

export function CommentsPanel({ annotationId, projectId, currentUserId, backgroundUrl, imageWidth, imageHeight, enableCanvasDrawing, liveCanvas }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("comments");
  const { data: comments } = useAnnotationComments(annotationId);
  const { data: members } = useProjectMembers(projectId ?? "");
  const createMut = useCreateComment(annotationId);
  const patchMut = usePatchComment(annotationId);
  const deleteMut = useDeleteComment(annotationId);
  const setHoveredShapes = useHoveredCommentStore((s) => s.setShapes);
  // v0.7.2 · 历史 tab — 仅切到 history 时拉取
  const { data: history, isLoading: historyLoading } = useAnnotationAuditHistory(
    tab === "history" ? annotationId : null,
  );

  if (!annotationId) return null;

  const memberOptions = (members ?? []).map((m) => ({
    id: m.user_id,
    name: m.user_name,
    email: m.user_email,
  }));

  const handleSubmit = ({
    body,
    mentions,
    attachments,
    canvas_drawing,
  }: {
    body: string;
    mentions: CommentMention[];
    attachments: CommentAttachment[];
    canvas_drawing: CommentCanvasDrawing | null;
  }) => {
    if (!body && attachments.length === 0 && !canvas_drawing) return;
    createMut.mutate({ body, mentions, attachments, canvas_drawing });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--color-border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>
        <button
          type="button"
          onClick={() => setTab("comments")}
          style={tabBtnStyle(tab === "comments")}
        >
          评论 {comments && comments.length > 0 && `(${comments.length})`}
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          style={tabBtnStyle(tab === "history")}
        >
          历史 {history && history.entries.length > 0 && `(${history.entries.length})`}
        </button>
      </div>

      {tab === "history" ? (
        <AnnotationHistoryTimeline
          entries={history?.entries ?? []}
          loading={historyLoading}
        />
      ) : (
      <>
      <CommentInput
        annotationId={annotationId}
        members={memberOptions}
        busy={createMut.isPending}
        backgroundUrl={backgroundUrl}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        enableCanvasDrawing={enableCanvasDrawing}
        liveCanvas={liveCanvas}
        onSubmit={handleSubmit}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
        {(comments ?? []).length === 0 && (
          <div style={{ fontSize: 11.5, color: "var(--color-fg-subtle)" }}>暂无评论</div>
        )}
        {(comments ?? []).map((c) => {
          const isMine = !!currentUserId && currentUserId === c.author_id;
          const hoverShapes = c.canvas_drawing?.shapes && c.canvas_drawing.shapes.length > 0
            ? c.canvas_drawing.shapes : null;
          return (
            <div
              key={c.id}
              onMouseEnter={() => { if (hoverShapes) setHoveredShapes(hoverShapes); }}
              onMouseLeave={() => { if (hoverShapes) setHoveredShapes(null); }}
              style={{
                padding: 8, borderRadius: 4,
                background: c.is_resolved ? "var(--color-bg-sunken)" : "var(--color-bg-elev)",
                border: "1px solid var(--color-border)",
                opacity: c.is_resolved ? 0.7 : 1,
                cursor: hoverShapes ? "crosshair" : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--color-fg)" }}>
                  {c.author_name ?? "—"}
                  {c.is_resolved && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-success)" }}>已解决</span>
                  )}
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    title={c.is_resolved ? "标为未解决" : "标为已解决"}
                    onClick={() => patchMut.mutate({ id: c.id, payload: { is_resolved: !c.is_resolved } })}
                    style={iconBtnStyle}
                  >
                    <Icon name="check" size={11} />
                  </button>
                  {isMine && (
                    <button
                      type="button"
                      title="删除"
                      onClick={() => deleteMut.mutate(c.id)}
                      style={iconBtnStyle}
                    >
                      <Icon name="trash" size={11} />
                    </button>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--color-fg)", whiteSpace: "pre-wrap" }}>
                {renderCommentBody(c.body, c.mentions ?? [], (uid) => navigate(`/audit?actor=${uid}`))}
              </div>
              {c.canvas_drawing && c.canvas_drawing.shapes && c.canvas_drawing.shapes.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <CanvasDrawingPreview
                    drawing={c.canvas_drawing}
                    width={220}
                    backgroundUrl={backgroundUrl}
                    imageWidth={imageWidth}
                    imageHeight={imageHeight}
                  />
                </div>
              )}
              {(c.attachments ?? []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                  {(c.attachments ?? []).map((a) => (
                    <a
                      key={a.storageKey}
                      href={`/api/v1/annotations/${annotationId}/comment-attachments/download?key=${encodeURIComponent(a.storageKey)}`}
                      target="_blank"
                      rel="noopener noreferrer"
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
                        textDecoration: "none",
                      }}
                      title={`${(a.size / 1024).toFixed(1)} KB`}
                    >
                      <Icon name="folder" size={11} />
                      <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.fileName}
                      </span>
                    </a>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 10, color: "var(--color-fg-subtle)", marginTop: 4 }}>
                {new Date(c.created_at).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: "none",
    padding: "4px 8px",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: active ? "var(--color-fg)" : "var(--color-fg-muted)",
    borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

const iconBtnStyle: React.CSSProperties = {
  width: 20, height: 20,
  background: "transparent", border: "none",
  borderRadius: 3, cursor: "pointer",
  color: "var(--color-fg-muted)",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { useProjectMembers } from "@/hooks/useProjects";
import { CanvasDrawingPreview } from "@/components/CanvasDrawingEditor";
import { useHoveredCommentStore } from "../state/useHoveredCommentStore";
import {
  useAnnotationCommentsInfinite,
  useCreateComment,
  usePatchComment,
  useDeleteComment,
} from "@/hooks/useAnnotationComments";
import { useAnnotationAuditHistory } from "@/hooks/useAnnotationAuditHistory";
import { AnnotationHistoryTimeline } from "@/components/AnnotationHistoryTimeline";
import { CommentInput, renderCommentBody } from "./CommentInput";
import styles from "./CommentsPanel.module.css";
import type {
  AnnotationCommentAnchor,
  CommentAttachment,
  CommentCanvasDrawing,
  CommentMention,
} from "@/api/comments";

type Tab = "comments" | "history";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

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
  commentAnchor?: AnnotationCommentAnchor | null;
  onSeekFrame?: (frameIndex: number) => void;
}

function anchorLabel(anchor: AnnotationCommentAnchor): string {
  const parts = [`F${anchor.frameIndex}`];
  if (anchor.trackId) parts.push(anchor.trackId.slice(0, 8));
  if (anchor.source) parts.push(anchor.source);
  return parts.join(" · ");
}

export function CommentsPanel({ annotationId, projectId, currentUserId, backgroundUrl, imageWidth, imageHeight, enableCanvasDrawing, liveCanvas, commentAnchor, onSeekFrame }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("comments");
  // v0.8.8 · keyset 分页：单标注 100+ 评论时按需加载，初始首屏只拉最近 50 条。
  const commentsQuery = useAnnotationCommentsInfinite(annotationId);
  const comments = useMemo(
    () => (commentsQuery.data?.pages ?? []).flatMap((p) => p.items),
    [commentsQuery.data],
  );
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
    anchor,
  }: {
    body: string;
    mentions: CommentMention[];
    attachments: CommentAttachment[];
    canvas_drawing: CommentCanvasDrawing | null;
    anchor?: AnnotationCommentAnchor | null;
  }) => {
    if (!body && attachments.length === 0 && !canvas_drawing) return;
    createMut.mutate({ body, mentions, attachments, canvas_drawing, anchor });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.tabRow}>
        <button
          type="button"
          onClick={() => setTab("comments")}
          className={cn(styles.tabButton, tab === "comments" && styles.tabButtonActive)}
        >
          评论 {comments && comments.length > 0 && `(${comments.length})`}
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={cn(styles.tabButton, tab === "history" && styles.tabButtonActive)}
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
        anchor={commentAnchor}
        onSubmit={handleSubmit}
      />

      <div className={styles.commentList}>
        {comments.length === 0 && (
          <div className={styles.emptyState}>暂无评论</div>
        )}
        {comments.map((c) => {
          const isMine = !!currentUserId && currentUserId === c.author_id;
          const hoverShapes = c.canvas_drawing?.shapes && c.canvas_drawing.shapes.length > 0
            ? c.canvas_drawing.shapes : null;
          return (
            <div
              key={c.id}
              onMouseEnter={() => { if (hoverShapes) setHoveredShapes(hoverShapes); }}
              onMouseLeave={() => { if (hoverShapes) setHoveredShapes(null); }}
              className={cn(
                styles.commentCard,
                c.is_resolved && styles.commentCardResolved,
                hoverShapes && styles.commentCardHoverable,
              )}
            >
              <div className={styles.commentHeader}>
                <span className={styles.authorName}>
                  {c.author_name ?? "—"}
                  {c.is_resolved && (
                    <span className={styles.resolvedLabel}>已解决</span>
                  )}
                </span>
                <div className={styles.commentActions}>
                  <button
                    type="button"
                    title={c.is_resolved ? "标为未解决" : "标为已解决"}
                    onClick={() => patchMut.mutate({ id: c.id, payload: { is_resolved: !c.is_resolved } })}
                    className={styles.iconButton}
                  >
                    <Icon name="check" size={11} />
                  </button>
                  {isMine && (
                    <button
                      type="button"
                      title="删除"
                      onClick={() => deleteMut.mutate(c.id)}
                      className={styles.iconButton}
                    >
                      <Icon name="trash" size={11} />
                    </button>
                  )}
                </div>
              </div>
              <div className={styles.commentBody}>
                {renderCommentBody(c.body, c.mentions ?? [], (uid) => navigate(`/audit?actor=${uid}`))}
              </div>
              {c.anchor?.kind === "video_frame" && (
                <button
                  type="button"
                  data-testid="comment-anchor-chip"
                  onClick={() => onSeekFrame?.(c.anchor!.frameIndex)}
                  className={cn(styles.anchorChip, onSeekFrame && styles.anchorChipClickable)}
                  title="跳转到评论锚定的视频帧"
                >
                  <Icon name="film" size={12} />
                  <span className="mono">{anchorLabel(c.anchor)}</span>
                </button>
              )}
              {c.canvas_drawing && c.canvas_drawing.shapes && c.canvas_drawing.shapes.length > 0 && (
                <div className={styles.canvasPreview}>
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
                <div className={styles.attachmentList}>
                  {(c.attachments ?? []).map((a) => (
                    <a
                      key={a.storageKey}
                      href={`/api/v1/annotations/${annotationId}/comment-attachments/download?key=${encodeURIComponent(a.storageKey)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.attachmentLink}
                      title={`${(a.size / 1024).toFixed(1)} KB`}
                    >
                      <Icon name="folder" size={11} />
                      <span className={styles.attachmentName}>
                        {a.fileName}
                      </span>
                    </a>
                  ))}
                </div>
              )}
              <div className={styles.commentTimestamp}>
                {new Date(c.created_at).toLocaleString()}
              </div>
            </div>
          );
        })}
        {/* v0.8.8 · keyset 分页 「加载更早评论」按钮 */}
        {commentsQuery.hasNextPage && (
          <button
            type="button"
            onClick={() => commentsQuery.fetchNextPage()}
            disabled={commentsQuery.isFetchingNextPage}
            data-testid="comments-load-more"
            className={styles.loadMoreButton}
          >
            {commentsQuery.isFetchingNextPage ? "加载中…" : "加载更早评论"}
          </button>
        )}
      </div>
      </>
      )}
    </div>
  );
}

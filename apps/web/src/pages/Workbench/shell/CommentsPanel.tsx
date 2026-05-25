import { useCallback, useEffect, useMemo, useState } from "react";
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
  useTaskCommentsInfinite,
} from "@/hooks/useAnnotationComments";
import { useAnnotationAuditHistory, useTaskAuditHistory } from "@/hooks/useAnnotationAuditHistory";
import { AnnotationHistoryTimeline } from "@/components/AnnotationHistoryTimeline";
import { CommentInput, renderCommentBody } from "./CommentInput";
import styles from "./CommentsPanel.module.css";
import type {
  AnnotationCommentAnchor,
  CommentAttachment,
  CommentCanvasDrawing,
  CommentMention,
} from "@/api/comments";
// v0.10.20 · D1 · 任务级评论复用 POST /feedbacks (kind=comment, anchor_type=task).
// v0.10.21 · D4 · 任务级 feedback patch/delete UI 入口开放.
import { useFeedbacks, useCreateFeedback, usePatchFeedback, useDeleteFeedback } from "@/hooks/useFeedbacks";

type Tab = "comments" | "history";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

interface Props {
  annotationId: string | null;
  /** I4 · 未选中标注时降级到任务级评论/历史 (聚合该 task 下所有标注的评论). */
  taskId?: string | null;
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
  /** 评论绑定标注框的类别名映射（annotation_id → class_name）；用于在评论卡片上显示绑定 chip。 */
  annotationClassById?: Record<string, string | undefined>;
  /** 点击绑定 chip 时选中/跳转到对应标注框。 */
  onSelectAnnotation?: (annotationId: string) => void;
  /** v0.11.2/3 · DiscussionPanel 自带顶层 tab 时, 隐藏本组件内部 comments/history 切换条。 */
  hideTabs?: boolean;
  /** v0.11.2/3 · 由外层 DiscussionPanel 锁定显示哪一段 (配合 hideTabs)。 */
  forceTab?: Tab;
}

function anchorLabel(anchor: AnnotationCommentAnchor): string {
  const parts = [`F${anchor.frameIndex}`];
  if (anchor.trackId) parts.push(anchor.trackId.slice(0, 8));
  if (anchor.source) parts.push(anchor.source);
  return parts.join(" · ");
}

export function CommentsPanel({ annotationId, taskId, projectId, currentUserId, backgroundUrl, imageWidth, imageHeight, enableCanvasDrawing, liveCanvas, commentAnchor, onSeekFrame, annotationClassById, onSelectAnnotation, hideTabs, forceTab }: Props) {
  const navigate = useNavigate();
  const [localTab, setTab] = useState<Tab>("comments");
  const tab = forceTab ?? localTab;
  // I4 · annotationId null 时走 task 级 hook (DiscussionPanel 雏形 — 评论/历史常驻).
  const annotationCommentsQuery = useAnnotationCommentsInfinite(annotationId);
  const taskCommentsQuery = useTaskCommentsInfinite(taskId ?? null, !annotationId && !!taskId);
  // v0.10.20 · D1 · 任务级评论从 annotation_feedbacks 读 (kind=comment, anchor_type=task); 与 annotation_comments 任务聚合合并展示.
  const taskLevelFeedbacksParams = useMemo(
    () => ({
      project_id: projectId ?? "",
      task_id: taskId ?? undefined,
      kind: "comment" as const,
      anchor_type: "task" as const,
    }),
    [projectId, taskId],
  );
  const taskLevelFeedbacksQuery = useFeedbacks(
    taskLevelFeedbacksParams,
    !annotationId && !!taskId && !!projectId,
  );
  const createTaskFeedbackMut = useCreateFeedback(taskLevelFeedbacksParams);
  // v0.10.21 · D4 · 任务级 feedback patch/delete UI 入口.
  const patchTaskFeedbackMut = usePatchFeedback(taskLevelFeedbacksParams);
  const deleteTaskFeedbackMut = useDeleteFeedback(taskLevelFeedbacksParams);
  const commentsQuery = annotationId ? annotationCommentsQuery : taskCommentsQuery;
  const comments = useMemo(
    () => {
      const annComments = (commentsQuery.data?.pages ?? []).flatMap((p) => p.items);
      if (annotationId) return annComments;
      // 任务级模式: merge annotation_comments + 任务级 feedback (kind=comment), 按 created_at desc.
      const fb = (taskLevelFeedbacksQuery.data?.items ?? []).map((f) => ({
        id: f.id,
        annotation_id: null as string | null,
        author_id: f.author_id,
        author_name: f.author_name,
        body: f.body,
        is_resolved: f.status === "resolved",
        is_active: f.is_active,
        mentions: [] as CommentMention[],
        attachments: (f.attachments ?? []) as CommentAttachment[],
        canvas_drawing: null as CommentCanvasDrawing | null,
        anchor: null as AnnotationCommentAnchor | null,
        created_at: f.created_at,
        updated_at: f.updated_at,
        // v0.10.20 · 标记任务级 feedback 行, UI 上不允许 patch/delete (走不同端点).
        __source: "feedback" as const,
      }));
      const merged = [...annComments.map((c) => ({ ...c, __source: "comment" as const })), ...fb];
      merged.sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
      );
      return merged;
    },
    [commentsQuery.data, taskLevelFeedbacksQuery.data, annotationId],
  );
  const { data: members } = useProjectMembers(projectId ?? "");
  const createMut = useCreateComment(annotationId);
  const patchMut = usePatchComment(annotationId);
  const deleteMut = useDeleteComment(annotationId);
  const setHoveredShapes = useHoveredCommentStore((s) => s.setHover);
  const togglePinnedComment = useHoveredCommentStore((s) => s.togglePin);
  const clearPinnedComment = useHoveredCommentStore((s) => s.clearPin);
  const pinnedCommentId = useHoveredCommentStore((s) => s.pinnedId);
  const setComposingShapes = useHoveredCommentStore((s) => s.setComposing);
  // CommentInput 上报 pending 批注 → 写入 composing 预览通道（仅提取 shapes）。
  const reportPendingDrawing = useCallback(
    (d: CommentCanvasDrawing | null) =>
      setComposingShapes(d?.shapes && d.shapes.length > 0 ? d.shapes : null),
    [setComposingShapes],
  );
  // 切换标注 / 卸载 → 清掉 pin 与 composing 预览，避免上一个标注的批注残留在画布上。
  useEffect(() => {
    clearPinnedComment();
    setComposingShapes(null);
    return () => {
      clearPinnedComment();
      setComposingShapes(null);
    };
  }, [annotationId, clearPinnedComment, setComposingShapes]);
  // v0.7.2 · 历史 tab — 仅切到 history 时拉取; I4 · 未选中标注时拉 task 级.
  const annotationHistoryQuery = useAnnotationAuditHistory(
    tab === "history" && annotationId ? annotationId : null,
  );
  const taskHistoryQuery = useTaskAuditHistory(
    tab === "history" && !annotationId ? (taskId ?? null) : null,
    tab === "history" && !annotationId,
  );
  const history = annotationId ? annotationHistoryQuery.data : taskHistoryQuery.data;
  const historyLoading = annotationId ? annotationHistoryQuery.isLoading : taskHistoryQuery.isLoading;

  // I4 · annotationId 与 taskId 都无 → 真正没东西显示, return null.
  if (!annotationId && !taskId) return null;

  const memberOptions = (members ?? []).map((m) => ({
    id: m.user_id,
    name: m.user_name,
    email: m.user_email,
  }));

  // 删除评论前清掉它在题图上的批注预览：卡片随删除卸载时 onMouseLeave 不会触发，
  // hover/pinned 预览会残留在画布上直到 hover 别处或刷新。
  const clearShapesPreviewFor = (commentId: string) => {
    setHoveredShapes(null);
    if (pinnedCommentId === commentId) clearPinnedComment();
  };

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
    // 返回 mutateAsync 的 promise，让 CommentInput 在成功后才 reset（失败保留草稿）。
    if (annotationId) {
      return createMut.mutateAsync({ body, mentions, attachments, canvas_drawing, anchor });
    }
    // v0.10.20 · D1 · 任务级评论 POST /feedbacks (kind=comment, anchor_type=task).
    // 任务级 feedback 不支持 mentions / canvas_drawing / anchor (走不同 schema), 仅传 body + attachments.
    if (!taskId || !projectId) return;
    return createTaskFeedbackMut.mutateAsync({
      kind: "comment",
      anchor_type: "task",
      project_id: projectId,
      task_id: taskId,
      body,
      attachments: attachments as Array<Record<string, unknown>>,
    });
  };

  return (
    <div className={styles.panel}>
      {!hideTabs && (
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
      )}

      {tab === "history" ? (
        <AnnotationHistoryTimeline
          entries={history?.entries ?? []}
          loading={historyLoading}
        />
      ) : (
      <>
      {annotationId ? (
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
          onPendingDrawingChange={reportPendingDrawing}
          onSubmit={handleSubmit}
        />
      ) : taskId && projectId ? (
        // 未选中标注时禁用评论框：先要求选中一个标注再评论。
        // 任务级评论 (POST /feedbacks · kind=comment / anchor_type=task) 的后端路径保留，
        // 待后续有更好的交互方案再开启（handleSubmit 的 task 分支仍在）。
        <div className={styles.disabledComposer} data-testid="comment-input-disabled">
          请先选中一个标注后再评论
        </div>
      ) : null}

      <div className={styles.commentList}>
        {comments.length === 0 && (
          <div className={styles.emptyState}>{annotationId ? "暂无评论" : "该任务暂无任何评论"}</div>
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
              onClick={(e) => {
                // 卡片内的按钮 / 链接（解决、删除、跳标注、跳帧、附件）各有自己的动作，
                // 点它们不应顺带 toggle pin；其余区域点击 = pin 这条评论的批注到画布。
                if (!hoverShapes) return;
                if ((e.target as HTMLElement).closest("button, a")) return;
                togglePinnedComment(c.id, hoverShapes);
              }}
              className={cn(
                styles.commentCard,
                c.is_resolved && styles.commentCardResolved,
                hoverShapes && styles.commentCardHoverable,
                pinnedCommentId === c.id && styles.commentCardPinned,
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
                  {/* v0.10.21 · D4 · 任务级 feedback 行走 PATCH/DELETE /feedbacks; annotation_comments 行走原路径. */}
                  {"__source" in c && c.__source === "feedback" ? (
                    <>
                      <button
                        type="button"
                        title={c.is_resolved ? "重开" : "标为已解决"}
                        onClick={() =>
                          patchTaskFeedbackMut.mutate({
                            id: c.id,
                            payload: { status: c.is_resolved ? "open" : "resolved" },
                          })
                        }
                        className={styles.iconButton}
                      >
                        <Icon name="check" size={11} />
                      </button>
                      {isMine && (
                        <button
                          type="button"
                          title="删除"
                          onClick={() => {
                            clearShapesPreviewFor(c.id);
                            deleteTaskFeedbackMut.mutate(c.id);
                          }}
                          className={styles.iconButton}
                        >
                          <Icon name="trash" size={11} />
                        </button>
                      )}
                    </>
                  ) : (
                    <>
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
                          onClick={() => {
                            clearShapesPreviewFor(c.id);
                            deleteMut.mutate(c.id);
                          }}
                          className={styles.iconButton}
                        >
                          <Icon name="trash" size={11} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {c.annotation_id && onSelectAnnotation && (
                <button
                  type="button"
                  data-testid="comment-annotation-chip"
                  onClick={() => onSelectAnnotation(c.annotation_id!)}
                  className={styles.annotationChip}
                  title="跳转到该评论绑定的标注框"
                >
                  <Icon name="crosshair" size={11} />
                  <span className={styles.annotationChipLabel}>
                    {annotationClassById?.[c.annotation_id] ?? "标注框"}
                  </span>
                </button>
              )}
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

import { lazy, Suspense, useState, useEffect, useCallback, useRef } from "react";
import { bugReportsApi, type BugReportResponse, type BugReportDetail } from "@/api/bug-reports";
import { useToastStore } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/Icon";
import { MarkdownBlock } from "@/components/bugreport/MarkdownBlock";
import type { MarkdownEditorProps } from "@/components/markdown/MarkdownEditor";
import styles from "./BugsPage.module.css";

const STATUS_OPTIONS = ["new", "triaged", "in_progress", "fixed", "wont_fix", "duplicate"];
const SEVERITY_OPTIONS = ["low", "medium", "high", "critical"];
const MAX_COMMENT_LENGTH = 10_000;

type CompactMarkdownEditorProps = Pick<
  MarkdownEditorProps,
  "value" | "onChange" | "placeholder" | "documentId" | "label" | "variant" | "disabled"
>;

// 管理评论使用紧凑编辑器，延迟加载编辑器依赖以保持管理页首屏轻量。
const MarkdownEditor = lazy(() =>
  import("@/components/markdown/MarkdownEditor").then((m) => ({
    default: m.MarkdownEditor,
  })),
);

const codePointLength = (value: string) => Array.from(value).length;

function CompactMarkdownEditor(props: CompactMarkdownEditorProps) {
  return (
    <Suspense fallback={<div className={styles.commentInput}>编辑器加载中…</div>}>
      <MarkdownEditor {...props} />
    </Suspense>
  );
}

const statusLabel: Record<string, string> = {
  new: "新提交",
  triaged: "已确认",
  in_progress: "处理中",
  fixed: "已修复",
  wont_fix: "不修复",
  duplicate: "重复",
};

const severityClass: Record<string, string> = {
  low: styles.severityLow,
  medium: styles.severityMedium,
  high: styles.severityHigh,
  critical: styles.severityCritical,
};

export function BugsPage() {
  const [items, setItems] = useState<BugReportResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BugReportDetail | null>(null);
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const detailRequestRef = useRef(0);
  const activeDetailIdRef = useRef<string | null>(null);
  const commentRequestRef = useRef(0);
  const pushToast = useToastStore((s) => s.push);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await bugReportsApi.list({
        status: filterStatus || undefined,
        severity: filterSeverity || undefined,
        limit: 50,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch {
      pushToast({ msg: "加载失败", kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterSeverity, pushToast]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const loadDetail = async (id: string) => {
    const requestId = ++detailRequestRef.current;
    commentRequestRef.current += 1;
    if (activeDetailIdRef.current !== id) setCommentText("");
    activeDetailIdRef.current = id;
    setDetailId(id);
    setDetail(null);
    setPostingComment(false);
    try {
      const data = await bugReportsApi.get(id);
      if (requestId !== detailRequestRef.current || activeDetailIdRef.current !== id) return;
      setDetail(data);
    } catch {
      if (requestId === detailRequestRef.current && activeDetailIdRef.current === id) {
        pushToast({ msg: "加载详情失败", kind: "error" });
      }
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const detailScope = detailRequestRef.current;
    try {
      await bugReportsApi.update(id, { status });
      pushToast({ msg: "状态已更新", kind: "success" });
      void loadList();
      if (activeDetailIdRef.current === id && detailRequestRef.current === detailScope) {
        void loadDetail(id);
      }
    } catch {
      pushToast({ msg: "更新失败", kind: "error" });
    }
  };

  const addComment = async () => {
    if (!detailId || !commentText.trim() || postingComment) return;
    const body = commentText.trim();
    if (codePointLength(body) > MAX_COMMENT_LENGTH) {
      pushToast({ msg: `评论不能超过 ${MAX_COMMENT_LENGTH} 个字符`, kind: "error" });
      return;
    }
    const reportId = detailId;
    const detailScope = detailRequestRef.current;
    const requestId = ++commentRequestRef.current;
    setPostingComment(true);
    try {
      await bugReportsApi.addComment(reportId, body);
      if (
        requestId !== commentRequestRef.current ||
        detailScope !== detailRequestRef.current ||
        activeDetailIdRef.current !== reportId
      ) {
        return;
      }
      setCommentText("");
      void loadDetail(reportId);
    } catch {
      if (
        requestId === commentRequestRef.current &&
        detailScope === detailRequestRef.current &&
        activeDetailIdRef.current === reportId
      ) {
        pushToast({ msg: "评论失败", kind: "error" });
      }
    } finally {
      if (requestId === commentRequestRef.current) setPostingComment(false);
    }
  };

  const invalidateDetailScope = () => {
    detailRequestRef.current += 1;
    commentRequestRef.current += 1;
    activeDetailIdRef.current = null;
    setPostingComment(false);
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Bug 反馈管理</h1>

      {/* Filters */}
      <div className={styles.filters}>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className={styles.select}
        >
          <option value="">全部状态</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {statusLabel[s]}
            </option>
          ))}
        </select>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className={styles.select}
        >
          <option value="">全部严重度</option>
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className={styles.totalText}>共 {total} 条</span>
      </div>

      {/* List */}
      <div className={detailId ? styles.layoutWithDetail : styles.layout}>
        <div>
          {loading && <div className={styles.emptyState}>加载中...</div>}
          {!loading && items.length === 0 && <div className={styles.emptyState}>暂无反馈</div>}
          <table className={styles.table}>
            <thead>
              <tr className={styles.headerRow}>
                <th className={styles.th}>ID</th>
                <th className={styles.th}>标题</th>
                <th className={styles.th}>严重度</th>
                <th className={styles.th}>状态</th>
                <th className={styles.th}>时间</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => loadDetail(item.id)}
                  className={
                    detailId === item.id
                      ? `${styles.itemRow} ${styles.itemRowSelected}`
                      : styles.itemRow
                  }
                >
                  <td className={styles.idCell}>{item.display_id}</td>
                  <td className={styles.titleCell}>
                    {item.title.length > 40 ? item.title.slice(0, 40) + "..." : item.title}
                  </td>
                  <td className={styles.td}>
                    <span className={`${styles.severity} ${severityClass[item.severity] ?? ""}`}>
                      {item.severity}
                    </span>
                  </td>
                  <td className={styles.td}>
                    {statusLabel[item.status] ?? item.status}
                    {item.reopen_count > 0 && (
                      <span
                        title={
                          item.last_reopened_at
                            ? `最近重开：${new Date(item.last_reopened_at).toLocaleString("zh-CN")}`
                            : undefined
                        }
                        className={styles.reopenPill}
                      >
                        ↻{item.reopen_count}
                      </span>
                    )}
                  </td>
                  <td className={styles.dateCell}>
                    {new Date(item.created_at).toLocaleDateString("zh-CN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Detail panel */}
        {detailId && detail && (
          <div className={styles.detailPanel}>
            <div className={styles.detailHeader}>
              <h2 className={styles.detailTitle}>
                {detail.display_id}: {detail.title}
              </h2>
              <button
                onClick={() => {
                  invalidateDetailScope();
                  setDetailId(null);
                  setDetail(null);
                }}
                className={styles.closeButton}
              >
                <Icon name="x" size={14} />
              </button>
            </div>

            <div className={styles.metaRow}>
              <span className={styles.metaText}>
                路由：<code className={styles.routeCode}>{detail.route}</code>
              </span>
              <span className={styles.metaText}>角色：{detail.user_role}</span>
              {detail.viewport && <span className={styles.metaText}>{detail.viewport}</span>}
              {detail.reopen_count > 0 && (
                <span
                  title={
                    detail.last_reopened_at
                      ? `最近重开：${new Date(detail.last_reopened_at).toLocaleString("zh-CN")}`
                      : undefined
                  }
                  className={styles.reopenPillLarge}
                >
                  曾重开 {detail.reopen_count} 次
                </span>
              )}
            </div>
            <div className={styles.section}>
              <MarkdownBlock>{detail.description}</MarkdownBlock>
            </div>

            {detail.attachments?.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>截图附件 ({detail.attachments.length})</div>
                <div className={styles.attachments}>
                  {detail.attachments.map((att) => (
                    <a
                      key={att.storageKey}
                      href={bugReportsApi.attachmentDownloadUrl(detail.id, att.storageKey)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.attachmentLink}
                    >
                      <Icon name="image" size={13} />
                      <span className={styles.attachmentName}>{att.fileName}</span>
                      <span className={styles.attachmentSize}>
                        {Math.round(att.size / 1024)} KB
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {detail.resolution && (
              <div className={styles.resolution}>
                <span className={styles.mediumText}>处理结果：</span>
                {detail.resolution}
              </div>
            )}

            {/* Status actions */}
            <div className={styles.statusActions}>
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => updateStatus(detail.id, s)}
                  disabled={detail.status === s}
                  className={
                    detail.status === s
                      ? `${styles.statusButton} ${styles.statusButtonActive}`
                      : styles.statusButton
                  }
                >
                  {statusLabel[s]}
                </button>
              ))}
            </div>

            {/* Comments */}
            <div className={styles.commentsSection}>
              <div className={styles.sectionTitle}>评论 ({detail.comments?.length ?? 0})</div>
              {detail.comments?.map((c) => (
                <div key={c.id} className={styles.comment}>
                  <div className={styles.commentMeta}>
                    <span className={styles.commentAuthor}>{c.author_name || "未知"}</span>
                    {c.author_role && <span className={styles.rolePill}>{c.author_role}</span>}
                    <span className={styles.commentTime}>
                      {new Date(c.created_at).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <MarkdownBlock compact>{c.body}</MarkdownBlock>
                </div>
              ))}
            </div>
            <div className={styles.commentForm}>
              <div
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void addComment();
                  }
                }}
              >
                <CompactMarkdownEditor
                  value={commentText}
                  onChange={setCommentText}
                  placeholder="添加评论，支持 Markdown..."
                  documentId={`bug-comment-${detail.id}`}
                  label="反馈评论"
                  variant="compact"
                  disabled={postingComment}
                />
              </div>
              <button
                onClick={addComment}
                disabled={postingComment || !commentText.trim()}
                className={
                  commentText.trim()
                    ? styles.sendButton
                    : `${styles.sendButton} ${styles.sendButtonDisabled}`
                }
              >
                发送
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

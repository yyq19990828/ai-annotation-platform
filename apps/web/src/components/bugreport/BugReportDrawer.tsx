import { useState, useEffect, type ClipboardEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { bugReportsApi, uploadBugAttachment, type BugAttachment, type BugReportResponse, type BugReportDetail } from "@/api/bug-reports";
import { getRecentApiCalls, getRecentConsoleErrors, sanitizeApiCalls, captureScreenshot } from "@/utils/bugReportCapture";
import { ScreenshotEditor } from "./ScreenshotEditor";
import { MarkdownBlock } from "./MarkdownBlock";

interface Props {
  open: boolean;
  onClose: () => void;
  focusBugId?: string | null;
}

type ViewState = "list" | "create" | "detail" | "edit";

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

interface PendingAttachment {
  id: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
}

export function BugReportDrawer({ open, onClose, focusBugId = null }: Props) {
  const [view, setView] = useState<ViewState>("list");
  const [reports, setReports] = useState<BugReportResponse[]>([]);
  const [detail, setDetail] = useState<BugReportDetail | null>(null);
  const [loading, setLoading] = useState(false);

  // create/edit form
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [severity, setSeverity] = useState<string>("medium");
  const [submitting, setSubmitting] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // detail-view comment composer
  const [commentBody, setCommentBody] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  // v0.6.6 · 截图状态
  const [screenshotBlob, setScreenshotBlob] = useState<Blob | null>(null);
  const [screenshotEditing, setScreenshotEditing] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  // v0.7.0：上传失败 retry 状态
  const [screenshotUploadFail, setScreenshotUploadFail] = useState<string | null>(null);

  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (open && view === "list") {
      loadMine();
    }
  }, [open, view]);

  // v0.7.0：从通知中心点击「我的反馈」类通知跳转时，自动定位到该条详情
  useEffect(() => {
    if (open && focusBugId) {
      loadDetail(focusBugId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusBugId]);

  const loadMine = async () => {
    setLoading(true);
    try {
      const data = await bugReportsApi.listMine(20);
      setReports(data.items);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: string) => {
    setLoading(true);
    try {
      const data = await bugReportsApi.get(id);
      setDetail(data);
      setView("detail");
    } catch {
      pushToast({ msg: "加载失败", kind: "error" });
    } finally {
      setLoading(false);
    }
  };

  const addPendingAttachment = (blob: Blob, fileName: string) => {
    const mimeType = blob.type || "image/png";
    if (!ALLOWED_ATTACHMENT_TYPES.has(mimeType)) {
      pushToast({ msg: "仅支持 PNG / JPEG / WebP 截图", kind: "error" });
      return false;
    }
    if (blob.size > MAX_ATTACHMENT_SIZE) {
      pushToast({ msg: "截图超过 10MB", kind: "error" });
      return false;
    }
    if (pendingAttachments.length >= MAX_ATTACHMENTS) {
      pushToast({ msg: `最多上传 ${MAX_ATTACHMENTS} 张截图`, kind: "error" });
      return false;
    }
    setPendingAttachments((items) => [
      ...items,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        blob,
        fileName,
        mimeType,
      },
    ]);
    setScreenshotUploadFail(null);
    return true;
  };

  const handlePasteImage = (e: ClipboardEvent) => {
    if (view !== "create") return;
    const files = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();
    const nextAttachments: PendingAttachment[] = [];
    let nextCount = pendingAttachments.length;
    for (const file of files) {
      const mimeType = file.type || "image/png";
      if (!ALLOWED_ATTACHMENT_TYPES.has(mimeType)) {
        pushToast({ msg: "仅支持 PNG / JPEG / WebP 截图", kind: "error" });
        continue;
      }
      if (file.size > MAX_ATTACHMENT_SIZE) {
        pushToast({ msg: "截图超过 10MB", kind: "error" });
        continue;
      }
      if (nextCount >= MAX_ATTACHMENTS) {
        pushToast({ msg: `最多上传 ${MAX_ATTACHMENTS} 张截图`, kind: "error" });
        break;
      }
      const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
      nextAttachments.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        blob: file,
        fileName: file.name || `clipboard-${Date.now()}-${nextAttachments.length + 1}.${ext}`,
        mimeType,
      });
      nextCount += 1;
    }
    if (nextAttachments.length > 0) {
      setPendingAttachments((items) => [...items, ...nextAttachments]);
      setScreenshotUploadFail(null);
      pushToast({ msg: `已添加 ${nextAttachments.length} 张截图`, kind: "success" });
    }
  };

  const handleSubmit = async (skipScreenshot = false) => {
    if (!title.trim() || !desc.trim()) return;
    setSubmitting(true);
    try {
      let uploadedAttachments: BugAttachment[] = [];
      if (!skipScreenshot && pendingAttachments.length > 0) {
        try {
          uploadedAttachments = await Promise.all(
            pendingAttachments.map((item) => uploadBugAttachment(item.blob, item.fileName)),
          );
          setScreenshotUploadFail(null);
        } catch (e) {
          // v0.7.0：失败不再静默降级，停在表单让用户选 retry / skip / cancel
          console.error("Bug screenshot upload failed", e);
          setScreenshotUploadFail("请稍后重试，或跳过截图继续提交。");
          setSubmitting(false);
          return;
        }
      }
      await bugReportsApi.create({
        title: title.trim(),
        description: desc.trim(),
        severity: severity as "low" | "medium" | "high" | "critical",
        route: location.pathname + location.search,
        browser_ua: navigator.userAgent.slice(0, 200),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        recent_api_calls: sanitizeApiCalls(getRecentApiCalls()),
        recent_console_errors: getRecentConsoleErrors().map((e) => ({ msg: e.msg, stack: e.stack || "" })),
        screenshot_url: uploadedAttachments[0]?.storageKey ?? null,
        attachments: uploadedAttachments,
      });
      pushToast({ msg: "反馈已提交", kind: "success" });
      setTitle("");
      setDesc("");
      setSeverity("medium");
      setScreenshotBlob(null);
      setPendingAttachments([]);
      setView("list");
    } catch {
      pushToast({ msg: "提交失败，请稍后重试", kind: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCaptureScreenshot = async () => {
    pushToast({ msg: "正在截图…" });
    try {
      // 关闭 drawer 短暂时间让 html2canvas 截到完整页面（可选简化：用 ignoreElements）
      const blob = await captureScreenshot();
      setScreenshotBlob(blob);
      setScreenshotEditing(true);
    } catch (e) {
      pushToast({
        msg: "截图失败",
        sub: e instanceof Error ? e.message : String(e),
        kind: "error",
      });
    }
  };

  const startEdit = (r: BugReportDetail) => {
    setEditId(r.id);
    setTitle(r.title);
    setDesc(r.description);
    setSeverity(r.severity);
    setView("edit");
  };

  const handleUpdate = async () => {
    if (!editId || !title.trim() || !desc.trim()) return;
    setSubmitting(true);
    try {
      await bugReportsApi.update(editId, {
        title: title.trim(),
        description: desc.trim(),
        severity,
      });
      pushToast({ msg: "反馈已更新", kind: "success" });
      setTitle("");
      setDesc("");
      setSeverity("medium");
      setEditId(null);
      setView("list");
    } catch {
      pushToast({ msg: "更新失败", kind: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePostComment = async () => {
    if (!detail || !commentBody.trim() || postingComment) return;
    const body = commentBody.trim();
    const willReopen = ["fixed", "wont_fix", "duplicate"].includes(detail.status);
    setPostingComment(true);
    try {
      await bugReportsApi.addComment(detail.id, body);
      setCommentBody("");
      pushToast({
        msg: willReopen ? "评论已发送，反馈已重新打开" : "评论已发送",
        kind: "success",
      });
      const fresh = await bugReportsApi.get(detail.id);
      setDetail(fresh);
    } catch {
      pushToast({ msg: "评论发送失败", kind: "error" });
    } finally {
      setPostingComment(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此反馈？")) return;
    try {
      await bugReportsApi.delete(id);
      pushToast({ msg: "反馈已删除", kind: "success" });
      setDetail(null);
      setView("list");
    } catch {
      pushToast({ msg: "删除失败", kind: "error" });
    }
  };

  const statusLabel: Record<string, string> = {
    new: "新提交",
    triaged: "已确认",
    in_progress: "处理中",
    fixed: "已修复",
    wont_fix: "不修复",
    duplicate: "重复",
  };

  const severityColor: Record<string, string> = {
    low: "oklch(0.55 0.08 200)",
    medium: "oklch(0.65 0.18 75)",
    high: "oklch(0.65 0.18 45)",
    critical: "oklch(0.60 0.22 25)",
  };

  if (!open) return null;

  return (
    <>
      <div
        data-bug-drawer
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 200,
          background: "rgba(0,0,0,0.3)",
        }}
        onClick={onClose}
      />
      <div
        data-bug-drawer
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: 400,
          maxWidth: "100vw",
          height: "100vh",
          zIndex: 201,
          background: "var(--color-bg-elev)",
          boxShadow: "-4px 0 20px rgba(0,0,0,0.12)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-fg)" }}>
            {view === "list" ? "我的反馈" : view === "create" ? "提交反馈" : view === "edit" ? "编辑反馈" : detail?.display_id ?? "详情"}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {view !== "list" && (
              <button
                onClick={() => {
                  setView("list");
                  setDetail(null);
                }}
                style={{
                  padding: "3px 10px",
                  fontSize: 12,
                  background: "none",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-fg-muted)",
                  cursor: "pointer",
                }}
              >
                返回
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-fg-muted)",
                padding: 2,
              }}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
          {view === "list" && (
            <div>
              <button
                onClick={() => {
                  setTitle("");
                  setDesc("");
                  setSeverity("medium");
                  setPendingAttachments([]);
                  setScreenshotBlob(null);
                  setScreenshotEditing(false);
                  setScreenshotUploadFail(null);
                  setView("create");
                }}
                style={{
                  width: "100%",
                  padding: "8px 0",
                  fontSize: 13,
                  fontWeight: 500,
                  background: "var(--color-accent)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  marginBottom: 10,
                }}
              >
                <Icon name="plus" size={13} style={{ marginRight: 4 }} />
                提交新反馈
              </button>
              {loading && <div style={{ fontSize: 12, color: "var(--color-fg-muted)", textAlign: "center", padding: 20 }}>加载中...</div>}
              {!loading && reports.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--color-fg-muted)", textAlign: "center", padding: 20 }}>
                  暂无反馈
                </div>
              )}
              {reports.map((r) => (
                <div
                  key={r.id}
                  onClick={() => loadDetail(r.id)}
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid var(--color-border-subtle)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--color-fg)" }}>
                    {r.display_id}: {r.title}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginTop: 3 }}>
                    <span style={{ color: severityColor[r.severity] ?? "var(--color-fg-muted)", fontWeight: 500 }}>
                      {r.severity}
                    </span>
                    {" · "}
                    <span>{statusLabel[r.status] ?? r.status}</span>
                    {" · "}
                    <span>{new Date(r.created_at).toLocaleDateString("zh-CN")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {view === "create" && (
            <form
              onPaste={handlePasteImage}
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
            >
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-fg-muted)", display: "block", marginBottom: 4 }}>
                标题 *
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={500}
                placeholder="发生了什么问题？"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "7px 10px",
                  fontSize: 13,
                  background: "var(--color-bg-sunken)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-fg)",
                  marginBottom: 10,
                }}
              />

              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-fg-muted)", display: "block", marginBottom: 4 }}>
                描述 *
              </label>
              <textarea
                required
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={4}
                placeholder="详细描述问题..."
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "7px 10px",
                  fontSize: 13,
                  background: "var(--color-bg-sunken)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-fg)",
                  resize: "vertical",
                  marginBottom: 10,
                  fontFamily: "inherit",
                }}
              />

              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-fg-muted)", display: "block", marginBottom: 4 }}>
                严重程度
              </label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  fontSize: 13,
                  background: "var(--color-bg-sunken)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-fg)",
                  marginBottom: 10,
                }}
              >
                <option value="low">低 - 小建议</option>
                <option value="medium">中 - 影响体验</option>
                <option value="high">高 - 影响功能</option>
                <option value="critical">严重 - 系统不可用</option>
              </select>

              <div style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5 }}>
                  截图（可选）
                </label>
                {screenshotEditing && screenshotBlob ? (
                  <ScreenshotEditor
                    imageBlob={screenshotBlob}
                    onConfirm={(blob) => {
                      addPendingAttachment(blob, `screenshot-${Date.now()}.png`);
                      setScreenshotBlob(null);
                      setScreenshotEditing(false);
                    }}
                    onCancel={() => {
                      setScreenshotBlob(null);
                      setScreenshotEditing(false);
                    }}
                  />
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={handleCaptureScreenshot}
                        disabled={pendingAttachments.length >= MAX_ATTACHMENTS}
                        style={{
                          padding: "6px 10px", fontSize: 12,
                          border: "1px dashed var(--color-border)",
                          borderRadius: "var(--radius-sm)",
                          background: "transparent",
                          cursor: pendingAttachments.length >= MAX_ATTACHMENTS ? "not-allowed" : "pointer",
                          color: "var(--color-fg-muted)",
                          display: "inline-flex", alignItems: "center", gap: 4,
                        }}
                      >
                        <Icon name="image" size={12} /> 截取当前画面
                      </button>
                      <span style={{ fontSize: 11.5, color: "var(--color-fg-muted)" }}>
                        可直接粘贴剪贴板截图，最多 {MAX_ATTACHMENTS} 张
                      </span>
                    </div>
                    {pendingAttachments.length > 0 && (
                      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                        {pendingAttachments.map((att, index) => (
                          <div
                            key={att.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 8px",
                              border: "1px solid var(--color-border)",
                              borderRadius: "var(--radius-sm)",
                              background: "var(--color-bg-sunken)",
                            }}
                          >
                            <Icon name="image" size={12} />
                            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--color-fg-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              图 {index + 1} · {att.fileName} · {Math.round(att.blob.size / 1024)} KB
                            </span>
                            <button
                              type="button"
                              onClick={() => setPendingAttachments((items) => items.filter((item) => item.id !== att.id))}
                              style={{
                                padding: "2px 6px",
                                border: "1px solid var(--color-border)",
                                borderRadius: 3,
                                background: "transparent",
                                color: "var(--color-fg-muted)",
                                cursor: "pointer",
                                fontSize: 11,
                              }}
                            >
                              移除
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {screenshotUploadFail && (
                <div
                  style={{
                    padding: "8px 10px",
                    marginBottom: 10,
                    background: "oklch(0.95 0.04 25)",
                    border: "1px solid oklch(0.85 0.10 25)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 12,
                    color: "oklch(0.50 0.20 25)",
                  }}
                >
                  <div style={{ marginBottom: 6 }}>
                    截图上传失败：{screenshotUploadFail}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => { setScreenshotUploadFail(null); handleSubmit(false); }}
                      style={{
                        padding: "4px 10px", fontSize: 11,
                        background: "var(--color-accent)", color: "#fff",
                        border: "none", borderRadius: 3, cursor: "pointer",
                      }}
                    >
                      重试上传
                    </button>
                    <button
                      type="button"
                      onClick={() => { setScreenshotUploadFail(null); handleSubmit(true); }}
                      style={{
                        padding: "4px 10px", fontSize: 11,
                        background: "transparent", color: "var(--color-fg)",
                        border: "1px solid var(--color-border)", borderRadius: 3, cursor: "pointer",
                      }}
                    >
                      跳过截图提交
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !title.trim() || !desc.trim()}
                style={{
                  width: "100%",
                  padding: "8px 0",
                  fontSize: 13,
                  fontWeight: 600,
                  background: submitting ? "var(--color-accent-muted)" : "var(--color-accent)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  cursor: submitting ? "not-allowed" : "pointer",
                  marginTop: 4,
                }}
              >
                {submitting ? "提交中..." : "提交反馈"}
              </button>
            </form>
          )}

          {view === "edit" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleUpdate();
              }}
            >
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-fg-muted)", display: "block", marginBottom: 4 }}>
                标题 *
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={500}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "7px 10px",
                  fontSize: 13,
                  background: "var(--color-bg-sunken)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-fg)",
                  marginBottom: 10,
                }}
              />
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-fg-muted)", display: "block", marginBottom: 4 }}>
                描述 *
              </label>
              <textarea
                required
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={4}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "7px 10px",
                  fontSize: 13,
                  background: "var(--color-bg-sunken)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-fg)",
                  resize: "vertical",
                  marginBottom: 10,
                  fontFamily: "inherit",
                }}
              />
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-fg-muted)", display: "block", marginBottom: 4 }}>
                严重程度
              </label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  fontSize: 13,
                  background: "var(--color-bg-sunken)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-fg)",
                  marginBottom: 10,
                }}
              >
                <option value="low">低 - 小建议</option>
                <option value="medium">中 - 影响体验</option>
                <option value="high">高 - 影响功能</option>
                <option value="critical">严重 - 系统不可用</option>
              </select>
              <button
                type="submit"
                disabled={submitting || !title.trim() || !desc.trim()}
                style={{
                  width: "100%",
                  padding: "8px 0",
                  fontSize: 13,
                  fontWeight: 600,
                  background: submitting ? "var(--color-accent-muted)" : "var(--color-accent)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  cursor: submitting ? "not-allowed" : "pointer",
                  marginTop: 4,
                }}
              >
                {submitting ? "保存中..." : "保存修改"}
              </button>
            </form>
          )}

          {view === "detail" && detail && (
            <div style={{ fontSize: 12.5 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontWeight: 600, color: "var(--color-fg)" }}>{detail.title}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => startEdit(detail)}
                    style={{
                      padding: "3px 8px",
                      fontSize: 11,
                      background: "none",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--color-fg-muted)",
                      cursor: "pointer",
                    }}
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(detail.id)}
                    style={{
                      padding: "3px 8px",
                      fontSize: 11,
                      background: "none",
                      border: "1px solid oklch(0.65 0.2 25)",
                      borderRadius: "var(--radius-sm)",
                      color: "oklch(0.65 0.2 25)",
                      cursor: "pointer",
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ color: severityColor[detail.severity] ?? "var(--color-fg-muted)", fontWeight: 500 }}>
                  {detail.severity}
                </span>
                <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 11, background: "var(--color-bg-sunken)" }}>
                  {statusLabel[detail.status] ?? detail.status}
                </span>
                {detail.reopen_count > 0 && (
                  <span
                    title={detail.last_reopened_at ? `最近重开：${new Date(detail.last_reopened_at).toLocaleString("zh-CN")}` : undefined}
                    style={{
                      padding: "1px 6px",
                      borderRadius: 3,
                      fontSize: 11,
                      color: "oklch(0.55 0.18 45)",
                      background: "oklch(0.95 0.04 45)",
                      border: "1px solid oklch(0.85 0.10 45)",
                    }}
                  >
                    曾重开 {detail.reopen_count} 次
                  </span>
                )}
                <span style={{ color: "var(--color-fg-muted)" }}>
                  {new Date(detail.created_at).toLocaleString("zh-CN")}
                </span>
              </div>
              <div style={{ color: "var(--color-fg-muted)", marginBottom: 10 }}>
                路由：<code style={{ fontSize: 11 }}>{detail.route}</code>
              </div>
              <div style={{ marginBottom: 14 }}>
                <MarkdownBlock compact>{detail.description}</MarkdownBlock>
              </div>
              {detail.attachments?.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 500, marginBottom: 6, fontSize: 12 }}>截图附件 ({detail.attachments.length})</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {detail.attachments.map((att) => (
                      <a
                        key={att.storageKey}
                        href={bugReportsApi.attachmentDownloadUrl(detail.id, att.storageKey)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 8px",
                          border: "1px solid var(--color-border)",
                          borderRadius: "var(--radius-sm)",
                          color: "var(--color-fg-muted)",
                          textDecoration: "none",
                        }}
                      >
                        <Icon name="image" size={12} />
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {att.fileName}
                        </span>
                        <span style={{ fontSize: 11 }}>{Math.round(att.size / 1024)} KB</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {detail.resolution && (
                <div style={{ padding: 8, background: "var(--color-bg-sunken)", borderRadius: "var(--radius-md)", marginBottom: 14 }}>
                  <span style={{ fontWeight: 500 }}>处理结果：</span>{detail.resolution}
                </div>
              )}
              <div style={{ marginTop: 6 }}>
                <div style={{ fontWeight: 500, marginBottom: 6, fontSize: 12 }}>
                  评论 ({detail.comments.length})
                </div>
                {detail.comments.map((c) => (
                  <div key={c.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--color-border-subtle)" }}>
                    <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginBottom: 2 }}>
                      <span style={{ color: "var(--color-fg)", fontWeight: 500 }}>{c.author_name || "未知"}</span>
                      {c.author_role && (
                        <span style={{ marginLeft: 6, padding: "0 5px", fontSize: 10, borderRadius: 3, background: "var(--color-bg-sunken)" }}>
                          {c.author_role}
                        </span>
                      )}
                      <span style={{ marginLeft: 6, color: "var(--color-fg-subtle)" }}>
                        {new Date(c.created_at).toLocaleString("zh-CN")}
                      </span>
                    </div>
                    <MarkdownBlock compact>{c.body}</MarkdownBlock>
                  </div>
                ))}
                {detail.comments.length === 0 && (
                  <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)", padding: "4px 0 8px" }}>暂无评论</div>
                )}

                {/* 评论输入框 */}
                <div style={{ marginTop: 10 }}>
                  {["fixed", "wont_fix", "duplicate"].includes(detail.status) && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "oklch(0.55 0.18 45)",
                        marginBottom: 4,
                      }}
                    >
                      ⚠ 当前状态为「{statusLabel[detail.status] ?? detail.status}」，发送评论将自动重新打开此反馈
                    </div>
                  )}
                  <textarea
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder="写下你的回复 / 补充信息..."
                    rows={3}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "7px 10px",
                      fontSize: 12.5,
                      background: "var(--color-bg-sunken)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                      color: "var(--color-fg)",
                      resize: "vertical",
                      fontFamily: "inherit",
                      marginBottom: 6,
                    }}
                  />
                  <button
                    type="button"
                    onClick={handlePostComment}
                    disabled={postingComment || !commentBody.trim()}
                    style={{
                      padding: "6px 14px",
                      fontSize: 12,
                      fontWeight: 500,
                      background: postingComment || !commentBody.trim() ? "var(--color-accent-muted)" : "var(--color-accent)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "var(--radius-md)",
                      cursor: postingComment || !commentBody.trim() ? "not-allowed" : "pointer",
                    }}
                  >
                    {postingComment ? "发送中..." : "发送"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

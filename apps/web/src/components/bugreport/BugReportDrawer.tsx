import { useState, useEffect } from "react";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { bugReportsApi, uploadBugScreenshot, type BugReportResponse, type BugReportDetail } from "@/api/bug-reports";
import { getRecentApiCalls, getRecentConsoleErrors, sanitizeApiCalls, captureScreenshot } from "@/utils/bugReportCapture";
import { ScreenshotEditor } from "./ScreenshotEditor";

interface Props {
  open: boolean;
  onClose: () => void;
}

type ViewState = "list" | "create" | "detail" | "edit";

export function BugReportDrawer({ open, onClose }: Props) {
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

  // v0.6.6 · 截图状态
  const [screenshotBlob, setScreenshotBlob] = useState<Blob | null>(null);
  const [screenshotEditing, setScreenshotEditing] = useState(false);
  const [screenshotKey, setScreenshotKey] = useState<string | null>(null);

  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (open && view === "list") {
      loadMine();
    }
  }, [open, view]);

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

  const handleSubmit = async () => {
    if (!title.trim() || !desc.trim()) return;
    setSubmitting(true);
    try {
      // 若有未上传的截图 blob → 先上传拿 storage_key
      let finalKey = screenshotKey;
      if (screenshotBlob && !finalKey) {
        try {
          finalKey = await uploadBugScreenshot(screenshotBlob);
        } catch (e) {
          pushToast({
            msg: "截图上传失败，已回退提交无截图",
            sub: e instanceof Error ? e.message : String(e),
            kind: "warning",
          });
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
        screenshot_url: finalKey,
      });
      pushToast({ msg: "反馈已提交", kind: "success" });
      setTitle("");
      setDesc("");
      setSeverity("medium");
      setScreenshotBlob(null);
      setScreenshotKey(null);
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
      setScreenshotKey(null);
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
                onClick={() => setView("create")}
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
                      setScreenshotBlob(blob);
                      setScreenshotEditing(false);
                    }}
                    onCancel={() => {
                      setScreenshotBlob(null);
                      setScreenshotEditing(false);
                    }}
                  />
                ) : screenshotBlob ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
                      已附加截图（{Math.round(screenshotBlob.size / 1024)} KB）
                    </span>
                    <button
                      type="button"
                      onClick={() => setScreenshotEditing(true)}
                      style={{
                        padding: "4px 8px", fontSize: 11,
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--color-bg-elev)",
                        cursor: "pointer", color: "var(--color-fg)",
                      }}
                    >
                      重新涂抹
                    </button>
                    <button
                      type="button"
                      onClick={() => { setScreenshotBlob(null); setScreenshotKey(null); }}
                      style={{
                        padding: "4px 8px", fontSize: 11,
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-sm)",
                        background: "transparent",
                        cursor: "pointer", color: "var(--color-fg-muted)",
                      }}
                    >
                      移除
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleCaptureScreenshot}
                    style={{
                      padding: "6px 10px", fontSize: 12,
                      border: "1px dashed var(--color-border)",
                      borderRadius: "var(--radius-sm)",
                      background: "transparent",
                      cursor: "pointer", color: "var(--color-fg-muted)",
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}
                  >
                    <Icon name="image" size={12} /> 截取当前画面
                  </button>
                )}
              </div>

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
              <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ color: severityColor[detail.severity] ?? "var(--color-fg-muted)", fontWeight: 500 }}>
                  {detail.severity}
                </span>
                <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 11, background: "var(--color-bg-sunken)" }}>
                  {statusLabel[detail.status] ?? detail.status}
                </span>
                <span style={{ color: "var(--color-fg-muted)" }}>
                  {new Date(detail.created_at).toLocaleString("zh-CN")}
                </span>
              </div>
              <div style={{ color: "var(--color-fg-muted)", marginBottom: 10 }}>
                路由：<code style={{ fontSize: 11 }}>{detail.route}</code>
              </div>
              <p style={{ color: "var(--color-fg)", lineHeight: 1.55, whiteSpace: "pre-wrap", margin: "0 0 14px" }}>
                {detail.description}
              </p>
              {detail.resolution && (
                <div style={{ padding: 8, background: "var(--color-bg-sunken)", borderRadius: "var(--radius-md)", marginBottom: 14 }}>
                  <span style={{ fontWeight: 500 }}>处理结果：</span>{detail.resolution}
                </div>
              )}
              {detail.comments.length > 0 && (
                <div>
                  <div style={{ fontWeight: 500, marginBottom: 6, fontSize: 12 }}>评论 ({detail.comments.length})</div>
                  {detail.comments.map((c) => (
                    <div key={c.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--color-border-subtle)" }}>
                      <span style={{ color: "var(--color-fg)" }}>{c.body}</span>
                      <div style={{ fontSize: 10.5, color: "var(--color-fg-subtle)", marginTop: 2 }}>
                        {new Date(c.created_at).toLocaleString("zh-CN")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

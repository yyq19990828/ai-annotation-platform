import { useState, useEffect } from "react";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { bugReportsApi, type BugReportResponse, type BugReportDetail } from "@/api/bug-reports";
import { getRecentApiCalls, getRecentConsoleErrors, sanitizeApiCalls } from "@/utils/bugReportCapture";

interface Props {
  open: boolean;
  onClose: () => void;
}

type ViewState = "list" | "create" | "detail";

export function BugReportDrawer({ open, onClose }: Props) {
  const [view, setView] = useState<ViewState>("list");
  const [reports, setReports] = useState<BugReportResponse[]>([]);
  const [detail, setDetail] = useState<BugReportDetail | null>(null);
  const [loading, setLoading] = useState(false);

  // create form
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [severity, setSeverity] = useState<string>("medium");
  const [submitting, setSubmitting] = useState(false);

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
      await bugReportsApi.create({
        title: title.trim(),
        description: desc.trim(),
        severity: severity as "low" | "medium" | "high" | "critical",
        route: location.pathname + location.search,
        browser_ua: navigator.userAgent.slice(0, 200),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        recent_api_calls: sanitizeApiCalls(getRecentApiCalls()),
        recent_console_errors: getRecentConsoleErrors().map((e) => ({ msg: e.msg, stack: e.stack || "" })),
      });
      pushToast({ msg: "反馈已提交", kind: "success" });
      setTitle("");
      setDesc("");
      setSeverity("medium");
      setView("list");
    } catch {
      pushToast({ msg: "提交失败，请稍后重试", kind: "error" });
    } finally {
      setSubmitting(false);
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
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 200,
          background: "rgba(0,0,0,0.3)",
        }}
        onClick={onClose}
      />
      <div
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
            {view === "list" ? "我的反馈" : view === "create" ? "提交反馈" : detail?.display_id ?? "详情"}
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

          {view === "detail" && detail && (
            <div style={{ fontSize: 12.5 }}>
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontWeight: 600, color: "var(--color-fg)" }}>{detail.title}</span>
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

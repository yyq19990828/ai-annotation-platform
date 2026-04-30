import { useState, useEffect, useCallback } from "react";
import { bugReportsApi, type BugReportResponse, type BugReportDetail } from "@/api/bug-reports";
import { useToastStore } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/Icon";

const STATUS_OPTIONS = ["new", "triaged", "in_progress", "fixed", "wont_fix", "duplicate"];
const SEVERITY_OPTIONS = ["low", "medium", "high", "critical"];

const statusLabel: Record<string, string> = {
  new: "新提交", triaged: "已确认", in_progress: "处理中",
  fixed: "已修复", wont_fix: "不修复", duplicate: "重复",
};

const severityColor: Record<string, string> = {
  low: "oklch(0.55 0.08 200)",
  medium: "oklch(0.65 0.18 75)",
  high: "oklch(0.65 0.18 45)",
  critical: "oklch(0.60 0.22 25)",
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
    setDetailId(id);
    try {
      const data = await bugReportsApi.get(id);
      setDetail(data);
    } catch {
      pushToast({ msg: "加载详情失败", kind: "error" });
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await bugReportsApi.update(id, { status });
      pushToast({ msg: "状态已更新", kind: "success" });
      loadList();
      if (detailId === id) loadDetail(id);
    } catch {
      pushToast({ msg: "更新失败", kind: "error" });
    }
  };

  const addComment = async () => {
    if (!detailId || !commentText.trim()) return;
    try {
      await bugReportsApi.addComment(detailId, commentText.trim());
      setCommentText("");
      loadDetail(detailId);
    } catch {
      pushToast({ msg: "评论失败", kind: "error" });
    }
  };

  return (
    <div style={{ padding: 24, height: "100%", overflow: "auto" }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px", color: "var(--color-fg)" }}>Bug 反馈管理</h1>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{ padding: "5px 10px", fontSize: 12.5, background: "var(--color-bg-sunken)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", color: "var(--color-fg)" }}
        >
          <option value="">全部状态</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{statusLabel[s]}</option>
          ))}
        </select>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          style={{ padding: "5px 10px", fontSize: 12.5, background: "var(--color-bg-sunken)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", color: "var(--color-fg)" }}
        >
          <option value="">全部严重度</option>
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span style={{ fontSize: 11.5, color: "var(--color-fg-muted)" }}>共 {total} 条</span>
      </div>

      {/* List */}
      <div style={{ display: "grid", gridTemplateColumns: detailId ? "1fr 1fr" : "1fr", gap: 14 }}>
        <div>
          {loading && <div style={{ fontSize: 13, color: "var(--color-fg-muted)", padding: 20, textAlign: "center" }}>加载中...</div>}
          {!loading && items.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--color-fg-muted)", padding: 20, textAlign: "center" }}>暂无反馈</div>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 500, color: "var(--color-fg-muted)" }}>ID</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 500, color: "var(--color-fg-muted)" }}>标题</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 500, color: "var(--color-fg-muted)" }}>严重度</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 500, color: "var(--color-fg-muted)" }}>状态</th>
                <th style={{ padding: "8px 6px", textAlign: "left", fontWeight: 500, color: "var(--color-fg-muted)" }}>时间</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => loadDetail(item.id)}
                  style={{
                    borderBottom: "1px solid var(--color-border-subtle)",
                    cursor: "pointer",
                    background: detailId === item.id ? "var(--color-bg-sunken)" : undefined,
                  }}
                >
                  <td style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 11 }}>{item.display_id}</td>
                  <td style={{ padding: "8px 6px", color: "var(--color-fg)" }}>{item.title.length > 40 ? item.title.slice(0, 40) + "..." : item.title}</td>
                  <td style={{ padding: "8px 6px" }}>
                    <span style={{ color: severityColor[item.severity] ?? "var(--color-fg-muted)", fontWeight: 500 }}>{item.severity}</span>
                  </td>
                  <td style={{ padding: "8px 6px" }}>{statusLabel[item.status] ?? item.status}</td>
                  <td style={{ padding: "8px 6px", fontSize: 11, color: "var(--color-fg-muted)" }}>
                    {new Date(item.created_at).toLocaleDateString("zh-CN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Detail panel */}
        {detailId && detail && (
          <div
            style={{
              padding: 14,
              background: "var(--color-bg-sunken)",
              borderRadius: "var(--radius-md)",
              fontSize: 12.5,
              maxHeight: "calc(100vh - 140px)",
              overflow: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "var(--color-fg)" }}>{detail.display_id}: {detail.title}</h2>
              <button
                onClick={() => setDetailId(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-fg-muted)" }}
              >
                <Icon name="x" size={14} />
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ color: "var(--color-fg-muted)" }}>路由：<code style={{ fontSize: 11 }}>{detail.route}</code></span>
              <span style={{ color: "var(--color-fg-muted)" }}>角色：{detail.user_role}</span>
              {detail.viewport && <span style={{ color: "var(--color-fg-muted)" }}>{detail.viewport}</span>}
            </div>
            <p style={{ margin: "0 0 14px", lineHeight: 1.55, color: "var(--color-fg)", whiteSpace: "pre-wrap" }}>{detail.description}</p>

            {detail.resolution && (
              <div style={{ padding: 8, background: "var(--color-bg-elev)", borderRadius: "var(--radius-md)", marginBottom: 14 }}>
                <span style={{ fontWeight: 500 }}>处理结果：</span>{detail.resolution}
              </div>
            )}

            {/* Status actions */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => updateStatus(detail.id, s)}
                  disabled={detail.status === s}
                  style={{
                    padding: "3px 10px",
                    fontSize: 11.5,
                    background: detail.status === s ? "var(--color-accent)" : "var(--color-bg-elev)",
                    color: detail.status === s ? "#fff" : "var(--color-fg)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    cursor: detail.status === s ? "default" : "pointer",
                  }}
                >
                  {statusLabel[s]}
                </button>
              ))}
            </div>

            {/* Comments */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 6 }}>
                评论 ({detail.comments?.length ?? 0})
              </div>
              {detail.comments?.map((c) => (
                <div key={c.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--color-border-subtle)" }}>
                  <span style={{ color: "var(--color-fg)" }}>{c.body}</span>
                  <div style={{ fontSize: 10.5, color: "var(--color-fg-subtle)", marginTop: 2 }}>
                    {new Date(c.created_at).toLocaleString("zh-CN")}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="添加评论..."
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  fontSize: 12.5,
                  background: "var(--color-bg-elev)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-fg)",
                }}
                onKeyDown={(e) => e.key === "Enter" && addComment()}
              />
              <button
                onClick={addComment}
                disabled={!commentText.trim()}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 500,
                  background: "var(--color-accent)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  cursor: commentText.trim() ? "pointer" : "not-allowed",
                }}
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

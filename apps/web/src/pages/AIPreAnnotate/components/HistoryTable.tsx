/**
 * v0.9.7 · pre_annotated 批次历史表 (含 client-side 搜索 / 排序 / 分页).
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import type { PreannotateQueueItem } from "@/api/adminPreannotate";
import {
  cardBodyStyle,
  cardHeaderStyle,
  helperTextStyle,
  tableHeaderCellStyle,
  tableBodyCellStyle,
  HISTORY_PAGE_SIZE,
  FS_XS,
  FS_SM,
} from "../styles";

type SortKey = "last_run_at" | "total_tasks" | "prediction_count" | "failed_count";
type SortDir = "asc" | "desc";

interface Props {
  items: PreannotateQueueItem[];
  isLoading: boolean;
}

export function HistoryTable({ items, isLoading }: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("last_run_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter(
      (it) =>
        it.batch_name.toLowerCase().includes(s) ||
        it.project_name.toLowerCase().includes(s) ||
        (it.project_display_id ?? "").toLowerCase().includes(s),
    );
  }, [items, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av === bv) return 0;
      const cmp = av < bv ? -1 : 1;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / HISTORY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * HISTORY_PAGE_SIZE;
  const pageItems = sorted.slice(pageStart, pageStart + HISTORY_PAGE_SIZE);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return (
      <span style={{ marginLeft: 4, color: "var(--color-ai)" }}>
        {sortDir === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  return (
    <Card>
      <div style={cardHeaderStyle}>
        <span>AI 预标已就绪批次（{filtered.length}）</span>
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="搜索批次/项目..."
          style={{
            padding: "4px 10px",
            fontSize: FS_XS,
            background: "var(--color-bg-sunken)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--color-fg)",
            outline: "none",
            width: 200,
          }}
        />
      </div>
      <div style={cardBodyStyle}>
        {isLoading ? (
          <div style={{ ...helperTextStyle, padding: 16, textAlign: "center" }}>加载中…</div>
        ) : items.length === 0 ? (
          <EmptyState />
        ) : sorted.length === 0 ? (
          <div style={{ ...helperTextStyle, padding: 16, textAlign: "center" }}>
            无匹配批次（搜索：{search}）
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: FS_SM, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--color-bg-sunken)" }}>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>项目</th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>批次</th>
                    <th style={tableHeaderCellStyle} onClick={() => onSort("total_tasks")}>
                      总数{sortIndicator("total_tasks")}
                    </th>
                    <th style={tableHeaderCellStyle} onClick={() => onSort("prediction_count")}>
                      已预标{sortIndicator("prediction_count")}
                    </th>
                    <th style={tableHeaderCellStyle} onClick={() => onSort("failed_count")}>
                      失败{sortIndicator("failed_count")}
                    </th>
                    <th style={tableHeaderCellStyle} onClick={() => onSort("last_run_at")}>
                      最近预标{sortIndicator("last_run_at")}
                    </th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((it) => (
                    <tr key={it.batch_id}>
                      <td style={tableBodyCellStyle}>
                        {it.project_name}
                        {it.project_display_id && (
                          <span style={{ marginLeft: 6, color: "var(--color-fg-subtle)" }}>
                            ({it.project_display_id})
                          </span>
                        )}
                      </td>
                      <td style={tableBodyCellStyle}>{it.batch_name}</td>
                      <td style={{ ...tableBodyCellStyle, fontVariantNumeric: "tabular-nums" }}>
                        {it.total_tasks}
                      </td>
                      <td style={tableBodyCellStyle}>
                        <Badge variant="ai">{it.prediction_count}</Badge>
                      </td>
                      <td style={tableBodyCellStyle}>
                        {it.failed_count > 0 ? (
                          <Badge variant="danger">{it.failed_count}</Badge>
                        ) : (
                          <span style={{ color: "var(--color-fg-subtle)" }}>0</span>
                        )}
                      </td>
                      <td style={{ ...tableBodyCellStyle, color: "var(--color-fg-muted)" }}>
                        {formatRelative(it.last_run_at)}
                      </td>
                      <td style={tableBodyCellStyle}>
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              navigate(
                                `/projects/${it.project_id}/annotate?batch=${it.batch_id}`,
                              )
                            }
                            title="打开工作台接管 review"
                          >
                            <Icon name="chevRight" size={11} />
                          </Button>
                          {it.can_retry && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                navigate(
                                  `/model-market?tab=failed&batch_id=${it.batch_id}`,
                                )
                              }
                              title="去失败 prediction 列表重试"
                            >
                              <Icon name="refresh" size={11} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingTop: 6,
                }}
              >
                <span style={{ ...helperTextStyle, marginTop: 0 }}>
                  共 {sorted.length} 条 · 第 {safePage + 1}/{totalPages} 页
                </span>
                <div style={{ display: "inline-flex", gap: 6 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <Icon name="chevLeft" size={11} /> 上一页
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  >
                    下一页 <Icon name="chevRight" size={11} />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: "32px 16px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        color: "var(--color-fg-subtle)",
      }}
    >
      <Icon name="sparkles" size={28} />
      <div style={{ fontSize: FS_SM, color: "var(--color-fg-muted)" }}>
        暂无 AI 预标已就绪的批次
      </div>
      <div style={{ fontSize: FS_XS }}>在上方跑一次预标，结果会出现在这里。</div>
    </div>
  );
}

function sortValue(it: PreannotateQueueItem, key: SortKey): number | string {
  switch (key) {
    case "total_tasks":
      return it.total_tasks;
    case "prediction_count":
      return it.prediction_count;
    case "failed_count":
      return it.failed_count;
    case "last_run_at":
      return it.last_run_at ? Date.parse(it.last_run_at) : 0;
  }
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} 天前`;
  return d.toLocaleDateString("zh-CN");
}

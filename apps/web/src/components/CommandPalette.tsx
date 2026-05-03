import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";

interface Props {
  open: boolean;
  onClose: () => void;
}

type FlatItem =
  | { kind: "project"; id: string; label: string; sublabel: string; href: string }
  | { kind: "task"; id: string; label: string; sublabel: string; href: string }
  | { kind: "dataset"; id: string; label: string; sublabel: string; href: string }
  | { kind: "member"; id: string; label: string; sublabel: string; href: string };

const KIND_LABEL: Record<FlatItem["kind"], string> = {
  project: "项目",
  task: "任务",
  dataset: "数据集",
  member: "成员",
};

/**
 * v0.7.2 · ⌘K 全局搜索 Palette。
 * - 由 TopBar 的 SearchInput / 全局 keydown 触发
 * - ↑↓ 切换 / ↵ 跳转 / Esc 关闭
 */
export function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { data, isLoading, debounced } = useGlobalSearch(input);

  useEffect(() => {
    if (open) {
      setInput("");
      setActiveIdx(0);
      // 延迟让 portal 完成渲染再 focus
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const items: FlatItem[] = useMemo(() => {
    const out: FlatItem[] = [];
    for (const p of data.projects) {
      out.push({
        kind: "project",
        id: p.id,
        label: p.name,
        sublabel: `${p.display_id} · ${p.type_label}`,
        href: `/projects/${p.id}`,
      });
    }
    for (const t of data.tasks) {
      out.push({
        kind: "task",
        id: t.id,
        label: t.file_name,
        sublabel: `${t.display_id} · ${t.project_name}`,
        href: `/projects/${t.project_id}/annotate?task=${t.id}`,
      });
    }
    for (const d of data.datasets) {
      out.push({
        kind: "dataset",
        id: d.id,
        label: d.name,
        sublabel: d.data_type,
        href: `/datasets/${d.id}`,
      });
    }
    for (const m of data.members) {
      out.push({
        kind: "member",
        id: m.id,
        label: m.name,
        sublabel: `${m.role} · ${m.email}`,
        href: `/users?focus=${m.id}`,
      });
    }
    return out;
  }, [data]);

  useEffect(() => {
    if (activeIdx >= items.length) setActiveIdx(0);
  }, [items.length, activeIdx]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(items.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = items[activeIdx];
        if (target) {
          navigate(target.href);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, activeIdx, navigate, onClose]);

  if (!open) return null;

  // 分组渲染：一次循环输出 group header + items，记录每条对应的 flat index
  const grouped: { kind: FlatItem["kind"]; rows: { item: FlatItem; flatIdx: number }[] }[] = [];
  let flatIdx = 0;
  for (const kind of ["project", "task", "dataset", "member"] as const) {
    const rows: { item: FlatItem; flatIdx: number }[] = [];
    for (const it of items) {
      if (it.kind === kind) {
        rows.push({ item: it, flatIdx });
        flatIdx += 1;
      }
    }
    if (rows.length > 0) grouped.push({ kind, rows });
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0 0 0 / 0.4)",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: 560,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--color-bg-elev)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setActiveIdx(0);
          }}
          placeholder="搜索项目、任务、数据集、成员..."
          style={{
            border: "none",
            outline: "none",
            padding: "14px 18px",
            fontSize: 14,
            background: "transparent",
            color: "var(--color-fg)",
            borderBottom: "1px solid var(--color-border)",
            fontFamily: "inherit",
          }}
        />

        <div style={{ maxHeight: 380, overflowY: "auto" }}>
          {!debounced && (
            <div style={{ padding: "32px 18px", textAlign: "center", fontSize: 12, color: "var(--color-fg-subtle)" }}>
              开始输入以搜索
            </div>
          )}
          {debounced && isLoading && items.length === 0 && (
            <div style={{ padding: "32px 18px", textAlign: "center", fontSize: 12, color: "var(--color-fg-subtle)" }}>
              搜索中…
            </div>
          )}
          {debounced && !isLoading && items.length === 0 && (
            <div style={{ padding: "32px 18px", textAlign: "center", fontSize: 12, color: "var(--color-fg-subtle)" }}>
              没有找到结果
            </div>
          )}

          {grouped.map((g) => (
            <div key={g.kind}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  color: "var(--color-fg-subtle)",
                  padding: "10px 18px 4px",
                }}
              >
                {KIND_LABEL[g.kind]} ({g.rows.length})
              </div>
              {g.rows.map(({ item, flatIdx: idx }) => {
                const active = idx === activeIdx;
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    type="button"
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => {
                      navigate(item.href);
                      onClose();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "8px 18px",
                      border: "none",
                      background: active ? "var(--color-bg-sunken)" : "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "inherit",
                      borderLeft: active ? "2px solid var(--color-accent)" : "2px solid transparent",
                    }}
                  >
                    {item.kind === "member" ? (
                      <Avatar size="sm" initial={(item.label || "?").slice(0, 1).toUpperCase()} />
                    ) : (
                      <Badge variant="outline" style={{ minWidth: 38, justifyContent: "center" }}>
                        {KIND_LABEL[item.kind]}
                      </Badge>
                    )}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.label}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--color-fg-subtle)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.sublabel}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 18px",
            borderTop: "1px solid var(--color-border)",
            fontSize: 11,
            color: "var(--color-fg-subtle)",
          }}
        >
          <span>↑↓ 选择　↵ 跳转</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

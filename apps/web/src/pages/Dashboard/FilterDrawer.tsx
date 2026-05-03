import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { useUsers } from "@/hooks/useUsers";
import { useAuthStore } from "@/stores/authStore";
import { PROJECT_TYPES } from "@/constants/projectTypes";

export interface DashboardFilters {
  status?: string;
  type_key: string[];
  member_id?: string;
  created_from?: string;
  created_to?: string;
}

export const EMPTY_FILTERS: DashboardFilters = {
  status: undefined,
  type_key: [],
  member_id: undefined,
  created_from: undefined,
  created_to: undefined,
};

interface Props {
  open: boolean;
  onClose: () => void;
  initial: DashboardFilters;
  onApply: (next: DashboardFilters) => void;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: "in_progress", label: "进行中" },
  { value: "pending_review", label: "待审核" },
  { value: "completed", label: "已完成" },
];

export function FilterDrawer({ open, onClose, initial, onApply }: Props) {
  const [draft, setDraft] = useState<DashboardFilters>(initial);
  const currentUser = useAuthStore((s) => s.user);
  const { data: users = [] } = useUsers();

  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  const toggleType = (key: string) => {
    setDraft((prev) => {
      const has = prev.type_key.includes(key);
      return {
        ...prev,
        type_key: has ? prev.type_key.filter((k) => k !== key) : [...prev.type_key, key],
      };
    });
  };

  const apply = () => {
    onApply(draft);
    onClose();
  };

  const clear = () => {
    setDraft(EMPTY_FILTERS);
  };

  return (
    <Modal open={open} onClose={onClose} title="高级筛选" width={520}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Section title="状态">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {STATUS_OPTIONS.map((s) => {
              const active = (draft.status ?? "") === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setDraft({ ...draft, status: s.value || undefined })}
                  style={chipStyle(active)}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="类型">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PROJECT_TYPES.map((t) => {
              const active = draft.type_key.includes(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => toggleType(t.key)}
                  style={chipStyle(active)}
                  title={t.hint}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="成员">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, member_id: currentUser?.id })}
              style={chipStyle(draft.member_id === currentUser?.id)}
            >
              我参与的
            </button>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, member_id: undefined })}
              style={chipStyle(!draft.member_id)}
            >
              不限
            </button>
          </div>
          <div
            style={{
              maxHeight: 160,
              overflowY: "auto",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-bg-sunken)",
            }}
          >
            {users.length === 0 && (
              <div style={{ padding: 12, fontSize: 12, color: "var(--color-fg-subtle)", textAlign: "center" }}>
                暂无成员
              </div>
            )}
            {users.map((u) => {
              const active = draft.member_id === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setDraft({ ...draft, member_id: active ? undefined : u.id })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    width: "100%",
                    textAlign: "left",
                    background: active ? "var(--color-accent-soft)" : "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--color-border)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: "var(--color-fg)",
                  }}
                >
                  <Avatar size="sm" initial={(u.name || "?").slice(0, 1).toUpperCase()} />
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{u.name}</span>
                  <Badge variant="outline" style={{ fontSize: 10 }}>{u.role}</Badge>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="创建时间">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="date"
              value={draft.created_from ?? ""}
              onChange={(e) => setDraft({ ...draft, created_from: e.target.value || undefined })}
              style={dateStyle}
            />
            <span style={{ color: "var(--color-fg-muted)" }}>至</span>
            <input
              type="date"
              value={draft.created_to ?? ""}
              onChange={(e) => setDraft({ ...draft, created_to: e.target.value || undefined })}
              style={dateStyle}
            />
          </div>
        </Section>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
          <Button onClick={clear} size="sm">清空</Button>
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={onClose} size="sm">取消</Button>
            <Button
              onClick={apply}
              size="sm"
              variant="primary"
            >
              应用
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          color: "var(--color-fg-muted)",
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: 12,
    borderRadius: 999,
    border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
    background: active ? "var(--color-accent-soft)" : "transparent",
    color: active ? "var(--color-accent)" : "var(--color-fg)",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

const dateStyle: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-bg-elev)",
  color: "var(--color-fg)",
  fontFamily: "inherit",
};

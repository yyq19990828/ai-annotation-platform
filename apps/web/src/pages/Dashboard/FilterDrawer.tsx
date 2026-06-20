import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { useUsers } from "@/hooks/useUsers";
import { useAuthStore } from "@/stores/authStore";
import { PROJECT_DATA_TYPES } from "@/constants/toolUnits";

export interface DashboardFilters {
  status?: string;
  // v0.10.28 · 媒体维度筛选 (image / video / lidar), 取代任务级 type_key.
  data_type: string[];
  member_id?: string;
  created_from?: string;
  created_to?: string;
}

export const EMPTY_FILTERS: DashboardFilters = {
  status: undefined,
  data_type: [],
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

// UA-safe 胶囊按钮基线(无全局 preflight 期间,消浏览器默认样式)
const CHIP_BASE =
  "cursor-pointer appearance-none rounded-full border border-border bg-transparent px-2.5 py-1 text-xs text-foreground [font:inherit]";
const CHIP_ACTIVE = "border-brand bg-brand/10 text-brand";

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

export function FilterDrawer({ open, onClose, initial, onApply }: Props) {
  const [draft, setDraft] = useState<DashboardFilters>(initial);
  const currentUser = useAuthStore((s) => s.user);
  const { data: users = [] } = useUsers();

  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  const toggleType = (key: string) => {
    setDraft((prev) => {
      const has = prev.data_type.includes(key);
      return {
        ...prev,
        data_type: has
          ? prev.data_type.filter((k) => k !== key)
          : [...prev.data_type, key],
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
      <div className="flex flex-col gap-5">
        <Section title="状态">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.map((s) => {
              const active = (draft.status ?? "") === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setDraft({ ...draft, status: s.value || undefined })}
                  className={cn(CHIP_BASE, active && CHIP_ACTIVE)}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="数据类型">
          <div className="flex flex-wrap gap-1.5">
            {PROJECT_DATA_TYPES.map((t) => {
              const active = draft.data_type.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleType(t.id)}
                  className={cn(CHIP_BASE, active && CHIP_ACTIVE)}
                  title={t.hint}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="成员">
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setDraft({ ...draft, member_id: currentUser?.id })}
              className={cn(CHIP_BASE, draft.member_id === currentUser?.id && CHIP_ACTIVE)}
            >
              我参与的
            </button>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, member_id: undefined })}
              className={cn(CHIP_BASE, !draft.member_id && CHIP_ACTIVE)}
            >
              不限
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted">
            {users.length === 0 && (
              <div className="p-3 text-center text-xs text-muted-foreground">
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
                  className={cn(
                    "flex w-full cursor-pointer appearance-none items-center gap-2 border-0 border-b border-border bg-transparent px-2 py-1.5 text-left text-foreground [font:inherit]",
                    active && "bg-brand/10",
                  )}
                >
                  <Avatar size="sm" initial={(u.name || "?").slice(0, 1).toUpperCase()} />
                  <span className="text-sm font-medium">{u.name}</span>
                  <span className="[&>span]:text-2xs">
                    <Badge variant="outline">{u.role}</Badge>
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="创建时间">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={draft.created_from ?? ""}
              onChange={(e) => setDraft({ ...draft, created_from: e.target.value || undefined })}
              className="appearance-none rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground [font:inherit]"
            />
            <span className="text-muted-foreground">至</span>
            <input
              type="date"
              value={draft.created_to ?? ""}
              onChange={(e) => setDraft({ ...draft, created_to: e.target.value || undefined })}
              className="appearance-none rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground [font:inherit]"
            />
          </div>
        </Section>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button onClick={clear} size="sm">清空</Button>
          <div className="flex gap-2">
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
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

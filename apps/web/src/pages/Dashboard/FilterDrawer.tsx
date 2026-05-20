import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { useUsers } from "@/hooks/useUsers";
import { useAuthStore } from "@/stores/authStore";
import { PROJECT_DATA_TYPES } from "@/constants/toolUnits";
import styles from "./FilterDrawer.module.css";

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
      <div className={styles.content}>
        <Section title="状态">
          <div className={styles.chipGroup}>
            {STATUS_OPTIONS.map((s) => {
              const active = (draft.status ?? "") === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setDraft({ ...draft, status: s.value || undefined })}
                  className={cn(styles.chip, active && styles.chipActive)}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="数据类型">
          <div className={styles.chipGroup}>
            {PROJECT_DATA_TYPES.map((t) => {
              const active = draft.data_type.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleType(t.id)}
                  className={cn(styles.chip, active && styles.chipActive)}
                  title={t.hint}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="成员">
          <div className={styles.memberQuickFilters}>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, member_id: currentUser?.id })}
              className={cn(styles.chip, draft.member_id === currentUser?.id && styles.chipActive)}
            >
              我参与的
            </button>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, member_id: undefined })}
              className={cn(styles.chip, !draft.member_id && styles.chipActive)}
            >
              不限
            </button>
          </div>
          <div className={styles.memberList}>
            {users.length === 0 && (
              <div className={styles.emptyMembers}>
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
                  className={cn(styles.memberButton, active && styles.memberButtonActive)}
                >
                  <Avatar size="sm" initial={(u.name || "?").slice(0, 1).toUpperCase()} />
                  <span className={styles.memberName}>{u.name}</span>
                  <span className={styles.memberRole}>
                    <Badge variant="outline">{u.role}</Badge>
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="创建时间">
          <div className={styles.dateRow}>
            <input
              type="date"
              value={draft.created_from ?? ""}
              onChange={(e) => setDraft({ ...draft, created_from: e.target.value || undefined })}
              className={styles.dateInput}
            />
            <span className={styles.dateSeparator}>至</span>
            <input
              type="date"
              value={draft.created_to ?? ""}
              onChange={(e) => setDraft({ ...draft, created_to: e.target.value || undefined })}
              className={styles.dateInput}
            />
          </div>
        </Section>

        <div className={styles.footer}>
          <Button onClick={clear} size="sm">清空</Button>
          <div className={styles.footerActions}>
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
      <div className={styles.sectionTitle}>
        {title}
      </div>
      {children}
    </div>
  );
}

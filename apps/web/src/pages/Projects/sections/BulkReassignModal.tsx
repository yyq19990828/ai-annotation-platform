import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { useProjectMembers } from "@/hooks/useProjects";
import type { BulkBatchActionResponse } from "@/api/batches";

interface Props {
  projectId: string;
  count: number;
  onClose: () => void;
  onSubmit: (payload: {
    annotator_id?: string | null;
    reviewer_id?: string | null;
  }) => Promise<BulkBatchActionResponse | void>;
  pending?: boolean;
}

type Sentinel = "__keep__" | "__clear__";

/**
 * v0.7.3 · 批量改派 modal。
 * 标注员 / 审核员各一栏：保留不变 / 清空 / 选某成员，三种语义。
 */
export function BulkReassignModal({ projectId, count, onClose, onSubmit, pending }: Props) {
  const { data: members = [], isLoading } = useProjectMembers(projectId);

  // 「保留不变」= 不发送该字段；「清空」= 发送 null；选成员 = user_id
  const [annotatorChoice, setAnnotatorChoice] = useState<string | Sentinel>("__keep__");
  const [reviewerChoice, setReviewerChoice] = useState<string | Sentinel>("__keep__");

  const annotators = useMemo(() => members.filter((m) => m.role === "annotator"), [members]);
  const reviewers = useMemo(() => members.filter((m) => m.role === "reviewer"), [members]);

  const dirty = annotatorChoice !== "__keep__" || reviewerChoice !== "__keep__";

  const handleSubmit = async () => {
    const payload: { annotator_id?: string | null; reviewer_id?: string | null } = {};
    if (annotatorChoice !== "__keep__") {
      payload.annotator_id = annotatorChoice === "__clear__" ? null : annotatorChoice;
    }
    if (reviewerChoice !== "__keep__") {
      payload.reviewer_id = reviewerChoice === "__clear__" ? null : reviewerChoice;
    }
    await onSubmit(payload);
  };

  return (
    <Modal open onClose={onClose} title={`批量改派 · 已选 ${count} 个批次`} width={560}>
      <div style={{ fontSize: 13, color: "var(--color-fg-muted)", marginBottom: 12 }}>
        留空或选择「保留不变」则该字段不会被修改；选择「清空指派」则该字段会被设为未分派。
      </div>

      {isLoading && (
        <div style={{ padding: 16, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
          加载成员…
        </div>
      )}

      {!isLoading && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Column
            title="标注员"
            members={annotators}
            choice={annotatorChoice}
            onChange={setAnnotatorChoice}
            roleColor="accent"
          />
          <Column
            title="审核员"
            members={reviewers}
            choice={reviewerChoice}
            onChange={setReviewerChoice}
            roleColor="warning"
          />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button onClick={onClose}>取消</Button>
        <Button
          onClick={handleSubmit}
          disabled={pending || !dirty}
          style={{ background: "var(--color-accent)", color: "#fff" }}
        >
          {pending ? "提交中…" : `确认改派 ${count} 个批次`}
        </Button>
      </div>
    </Modal>
  );
}

function Column({
  title,
  members,
  choice,
  onChange,
  roleColor,
}: {
  title: string;
  members: { id: string; user_id: string; user_name: string; user_email: string; role: string }[];
  choice: string | Sentinel;
  onChange: (v: string | Sentinel) => void;
  roleColor: "accent" | "warning";
}) {
  const renderRow = (
    key: string,
    label: React.ReactNode,
    value: string | Sentinel,
    sub?: string,
    icon?: React.ReactNode,
  ) => {
    const checked = choice === value;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onChange(value)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 8px",
          borderRadius: "var(--radius-sm)",
          background: checked ? "var(--color-accent-soft)" : "transparent",
          border: `1px solid ${checked ? "var(--color-accent)" : "transparent"}`,
          cursor: "pointer",
          textAlign: "left",
          marginBottom: 2,
          fontFamily: "inherit",
          color: "var(--color-fg)",
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            border: "1px solid var(--color-border)",
            background: checked ? "var(--color-accent)" : "var(--color-bg)",
            flexShrink: 0,
            position: "relative",
          }}
        >
          {checked && (
            <span
              style={{
                position: "absolute",
                inset: 3,
                borderRadius: "50%",
                background: "#fff",
              }}
            />
          )}
        </span>
        {icon}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
          {sub && (
            <span style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginLeft: 6 }}>{sub}</span>
          )}
        </span>
      </button>
    );
  };

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-bg-sunken)",
        padding: 8,
        maxHeight: 300,
        overflowY: "auto",
      }}
    >
      <div style={{ padding: "4px 6px 8px" }}>
        <Badge variant={roleColor} dot>{title}</Badge>
      </div>
      {renderRow("__keep__", "保留不变", "__keep__", "（不修改该字段）")}
      {renderRow("__clear__", "清空指派", "__clear__", "（设为未分派）", <Icon name="x" size={11} />)}
      <div style={{ height: 1, background: "var(--color-border)", margin: "4px 6px" }} />
      {members.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--color-fg-subtle)", padding: 16, textAlign: "center" }}>
          暂无成员
        </div>
      )}
      {members.map((m) =>
        renderRow(
          m.id,
          m.user_name,
          m.user_id,
          m.user_email,
          <Avatar initial={(m.user_name || "?").slice(0, 1).toUpperCase()} size="sm" />,
        ),
      )}
    </div>
  );
}

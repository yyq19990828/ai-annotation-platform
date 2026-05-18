import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useProjectMembers } from "@/hooks/useProjects";
import { useDistributeBatches } from "@/hooks/useBatches";
import styles from "./ProjectDistributeBatchesModal.module.css";

interface Props {
  projectId: string;
  onClose: () => void;
}

/**
 * v0.7.2 · 项目级 batch 圆周分派：把项目内未分派 / 全部 batch 在所选 annotator/reviewer 间均分。
 * 一 batch 落到 1 个 annotator + 1 个 reviewer。
 */
export function ProjectDistributeBatchesModal({ projectId, onClose }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const { data: members = [], isLoading } = useProjectMembers(projectId);
  const distribute = useDistributeBatches(projectId);

  const [annotators, setAnnotators] = useState<Set<string>>(new Set());
  const [reviewers, setReviewers] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"unassigned" | "all">("unassigned");

  const annotatorMembers = useMemo(() => members.filter((m) => m.role === "annotator"), [members]);
  const reviewerMembers = useMemo(() => members.filter((m) => m.role === "reviewer"), [members]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const onSubmit = () => {
    if (annotators.size === 0 && reviewers.size === 0) {
      pushToast({ msg: "请至少勾选一个标注员或审核员" });
      return;
    }
    distribute.mutate(
      {
        annotatorIds: Array.from(annotators),
        reviewerIds: Array.from(reviewers),
        onlyUnassigned: scope === "unassigned",
      },
      {
        onSuccess: (data) => {
          pushToast({
            msg: `已圆周分派 ${data.distributed_batches} 个批次`,
            kind: "success",
          });
          onClose();
        },
        onError: (e) => pushToast({ msg: "分派失败", sub: (e as Error).message, kind: "error" }),
      },
    );
  };

  return (
    <Modal open onClose={onClose} title="按项目分派批次" width={560}>
      <div className={styles.description}>
        把项目下的批次圆周均分给所选标注员 / 审核员。每个批次落到 <strong>1 个标注员 + 1 个审核员</strong>。
      </div>

      <div className={styles.scopeTabs}>
        <button
          type="button"
          onClick={() => setScope("unassigned")}
          className={clsx(styles.scopeChip, scope === "unassigned" && styles.scopeChipActive)}
          title="只分派那些 annotator/reviewer 为空的批次（不覆盖已分派）"
        >
          仅未分派的批次
        </button>
        <button
          type="button"
          onClick={() => setScope("all")}
          className={clsx(styles.scopeChip, scope === "all" && styles.scopeChipActive)}
          title="覆盖所有非归档批次（含已分派）"
        >
          覆盖全部批次
        </button>
      </div>

      {isLoading && (
        <div className={styles.loading}>加载中…</div>
      )}

      {!isLoading && (
        <div className={styles.columns}>
          <Column
            title="参与标注员"
            members={annotatorMembers}
            selected={annotators}
            onToggle={(id) => toggle(annotators, setAnnotators, id)}
            roleColor="accent"
          />
          <Column
            title="参与审核员"
            members={reviewerMembers}
            selected={reviewers}
            onToggle={(id) => toggle(reviewers, setReviewers, id)}
            roleColor="warning"
          />
        </div>
      )}

      <div className={styles.footer}>
        <span className={styles.selectionSummary}>
          标注员 <strong className={styles.selectionCount}>{annotators.size}</strong>
          {" · "}
          审核员 <strong className={styles.selectionCount}>{reviewers.size}</strong>
        </span>
        <div className={styles.actions}>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={distribute.isPending || (annotators.size === 0 && reviewers.size === 0)}
          >
            {distribute.isPending ? "分派中…" : "执行分派"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Column({
  title,
  members,
  selected,
  onToggle,
  roleColor,
}: {
  title: string;
  members: { id: string; user_id: string; user_name: string; user_email: string; role: string }[];
  selected: Set<string>;
  onToggle: (userId: string) => void;
  roleColor: "accent" | "warning";
}) {
  return (
    <div className={styles.column}>
      <div className={styles.columnHeader}>
        <Badge variant={roleColor} dot>{title}</Badge>
      </div>
      {members.length === 0 && (
        <div className={styles.emptyMembers}>
          暂无成员
        </div>
      )}
      {members.map((m) => {
        const checked = selected.has(m.user_id);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onToggle(m.user_id)}
            className={clsx(styles.memberButton, checked && styles.memberButtonChecked)}
          >
            <span className={clsx(styles.checkMark, checked && styles.checkMarkChecked)}>
              {checked && <Icon name="check" size={10} />}
            </span>
            <Avatar initial={(m.user_name || "?").slice(0, 1).toUpperCase()} size="sm" />
            <span className={styles.memberText}>
              <span className={styles.memberName}>{m.user_name}</span>
              <span className={styles.memberEmail}>{m.user_email}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// v0.10.18 · CreateProjectWizard 第 6 步: 项目成员选择 (annotator / reviewer).
// 从 CreateProjectWizard.tsx 抽出.

import { useState } from "react";
import { clsx } from "clsx";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useAddProjectMember } from "@/hooks/useProjects";
import { useUsers } from "@/hooks/useUsers";
import type { ProjectResponse } from "@/api/projects";
import type { FormState } from "../CreateProjectWizard";
import styles from "../CreateProjectWizard.module.css";

export function Step6Members({
  project,
  form,
  setForm,
  onNext,
}: {
  project: ProjectResponse;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onNext: (added: number) => void;
}) {
  const pushToast = useToastStore((s) => s.push);
  const addMember = useAddProjectMember(project.id);
  const { data: users = [], isLoading } = useUsers();
  const [adding, setAdding] = useState(false);

  // 仅展示 annotator / reviewer 角色用户（项目成员只能这两个角色）
  const eligible = users.filter(
    (u) => u.role === "annotator" || u.role === "reviewer",
  );

  const toggle = (userId: string, role: "annotator" | "reviewer") => {
    setForm((s) => {
      const exists = s.members.find((m) => m.userId === userId);
      if (exists)
        return { ...s, members: s.members.filter((m) => m.userId !== userId) };
      return { ...s, members: [...s.members, { userId, role }] };
    });
  };

  const onContinue = async () => {
    if (form.members.length === 0) {
      onNext(0);
      return;
    }
    setAdding(true);
    let ok = 0;
    for (const m of form.members) {
      try {
        await addMember.mutateAsync({ user_id: m.userId, role: m.role });
        ok++;
      } catch (e) {
        pushToast({
          msg: "添加成员失败",
          sub: (e as Error).message,
          kind: "error",
        });
      }
    }
    setAdding(false);
    pushToast({ msg: `已添加 ${ok} 位成员`, kind: "success" });
    onNext(ok);
  };

  return (
    <div className={styles.formStack}>
      <div className={styles.sectionHint}>
        选择标注员 / 审核员（可空）。每位成员的角色由其账户角色决定。
      </div>

      {isLoading && <div className={styles.inlineLoading}>加载用户…</div>}

      {!isLoading && eligible.length === 0 && (
        <div className={styles.emptyPanel}>
          暂无 annotator / reviewer 角色的用户，可跳过此步骤。
        </div>
      )}

      {!isLoading && eligible.length > 0 && (
        <div className={styles.memberList}>
          {eligible.map((u) => {
            const checked = form.members.some((m) => m.userId === u.id);
            const role = (u.role === "reviewer" ? "reviewer" : "annotator") as
              | "annotator"
              | "reviewer";
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => toggle(u.id, role)}
                className={clsx(
                  styles.choiceButton,
                  checked && styles.choiceButtonChecked,
                )}
              >
                <span
                  className={clsx(
                    styles.checkMark,
                    checked && styles.checkMarkChecked,
                  )}
                >
                  {checked && <Icon name="check" size={10} />}
                </span>
                <Avatar
                  initial={(u.name || u.email).slice(0, 1).toUpperCase()}
                  size="sm"
                />
                <span className={styles.choiceBody}>
                  <div className={styles.choiceTitle}>{u.name || u.email}</div>
                  <div className={styles.choiceMeta}>{u.email}</div>
                </span>
                <Badge variant={role === "reviewer" ? "warning" : "accent"}>
                  {role === "reviewer" ? "审核员" : "标注员"}
                </Badge>
              </button>
            );
          })}
        </div>
      )}

      <div className={styles.stepActions}>
        <Button variant="ghost" onClick={() => onNext(0)} disabled={adding}>
          跳过
        </Button>
        <Button variant="primary" onClick={onContinue} disabled={adding}>
          {adding
            ? "添加中…"
            : form.members.length === 0
              ? "完成"
              : `添加 ${form.members.length} 位并完成`}
        </Button>
      </div>
    </div>
  );
}

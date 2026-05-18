/**
 * v0.9.7 · AIPreAnnotate 顶部水平 stepper.
 *
 * 4 步进度引导, 不强制翻页(admin 重复使用同一项目跑多次预标, 强制 wizard
 * 翻页反而麻烦). 点徽章滚到对应 anchor section.
 */

import { Icon } from "@/components/ui/Icon";
import styles from "./PreannotateStepper.module.css";

export type StepStatus = "pending" | "active" | "complete";

export interface StepDef {
  id: 1 | 2 | 3 | 4;
  label: string;
  anchor: string;
  status: StepStatus;
}

interface Props {
  steps: StepDef[];
}

export function PreannotateStepper({ steps }: Props) {
  return (
    <div
      className={styles.stepper}
      role="navigation"
      aria-label="预标流程"
    >
      {steps.map((s, i) => (
        <div key={s.id} className={styles.stepItem}>
          <button
            type="button"
            onClick={() => scrollToAnchor(s.anchor)}
            className={`${styles.stepButton} ${stepButtonStatusClass(s.status)}`}
            aria-current={s.status === "active" ? "step" : undefined}
            aria-label={`第 ${s.id} 步：${s.label}`}
          >
            <span className={`${styles.stepCircle} ${stepCircleStatusClass(s.status)}`}>
              {s.status === "complete" ? <Icon name="check" size={11} /> : s.id}
            </span>
            <span className={`${styles.stepLabel} ${s.status === "active" ? styles.stepLabelActive : ""}`}>
              {s.label}
            </span>
          </button>
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className={`${styles.connector} ${s.status === "complete" ? styles.connectorComplete : ""}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function scrollToAnchor(anchor: string) {
  const el = document.querySelector(anchor);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function stepButtonStatusClass(status: StepStatus): string {
  if (status === "active") return styles.stepButtonActive;
  if (status === "complete") return styles.stepButtonComplete;
  return styles.stepButtonPending;
}

function stepCircleStatusClass(status: StepStatus): string {
  if (status === "active") return styles.stepCircleActive;
  if (status === "complete") return styles.stepCircleComplete;
  return styles.stepCirclePending;
}

import { useId } from "react";
import { clsx } from "clsx";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "./TextOutputDefaultSelect.module.css";

export type TextOutputDefault = "" | "box" | "mask" | "both";

interface Props {
  value: TextOutputDefault;
  onChange: (v: TextOutputDefault) => void;
  className?: string;
  disabled?: boolean;
}

const OPTIONS: Array<{
  value: TextOutputDefault;
  icon: IconName;
  title: string;
  tag: string;
  desc: string;
}> = [
  {
    value: "",
    icon: "sparkles",
    title: "自动匹配",
    tag: "默认",
    desc: "image-det 走框，其它项目走掩膜",
  },
  {
    value: "box",
    icon: "rect",
    title: "框",
    tag: "快",
    desc: "检测框直出，适合目标检测",
  },
  {
    value: "mask",
    icon: "polygon",
    title: "掩膜",
    tag: "细",
    desc: "生成 mask / polygon，适合分割",
  },
  {
    value: "both",
    icon: "layers",
    title: "框 + 掩膜",
    tag: "全",
    desc: "同实例返回框与掩膜",
  },
];

/**
 * v0.9.6 · 共享组件 — SAM 文本预标默认输出 4 项选择.
 *
 * 由 MlBackendsSection (项目设置编辑) 与 CreateProjectWizard Step 4 (新建向导)
 * 共用; 改 4 项含义时只动这一处.
 */
export function TextOutputDefaultSelect({ value, onChange, className, disabled = false }: Props) {
  const groupName = `sam-output-default-${useId()}`;

  return (
    <div
      className={clsx(styles.outputSelect, className)}
      role="radiogroup"
      aria-label="SAM 文本预标默认输出"
    >
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value || "auto"}
            className={clsx(
              styles.option,
              selected && styles.optionSelected,
              disabled && styles.optionDisabled,
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className={styles.radioInput}
            />
            <span className={styles.optionShell}>
              <span className={styles.optionIcon}>
                <Icon name={option.icon} size={15} />
              </span>
              <span className={styles.optionBody}>
                <span className={styles.optionHead}>
                  <span className={styles.optionTitle}>{option.title}</span>
                  <span className={styles.optionTag}>{option.tag}</span>
                </span>
                <span className={styles.optionDesc}>{option.desc}</span>
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

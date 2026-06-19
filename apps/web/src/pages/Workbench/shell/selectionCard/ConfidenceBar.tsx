import type { CSSProperties } from "react";
import { confidenceTone } from "./IdentityHeader";
import styles from "./ConfidenceBar.module.css";

const TONE_CLASS = {
  high: styles.high,
  mid: styles.mid,
  low: styles.low,
} as const;

export interface ConfidenceBarProps {
  /** 0–1 置信度。 */
  value: number;
}

/**
 * v0.16.14 · AI 置信度大条。按阈值着色(≥0.8 success / 0.5–0.8 warning / <0.5 danger),
 * 填充宽度与数值都读同一局部色变量,保证条 / 数字同色。track / fill 走 tokens.css 语义色。
 */
export function ConfidenceBar({ value }: ConfidenceBarProps) {
  const pct = Math.round(value * 100);
  return (
    <div className={`${styles.wrap} ${TONE_CLASS[confidenceTone(value)]}`}>
      <span className={styles.label}>置信度</span>
      <div className={styles.track}>
        <div
          className={styles.fill}
          // eslint-disable-next-line no-restricted-syntax -- 填充宽度为动态数据值,经 CSS 变量注入。
          style={{ "--cf-fill": `${pct}%` } as CSSProperties}
        />
      </div>
      <span className={styles.value}>{pct}%</span>
    </div>
  );
}

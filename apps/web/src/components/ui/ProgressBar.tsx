import { useEffect, useRef } from "react";

import styles from "./ProgressBar.module.css";

interface ProgressBarProps {
  value: number;
  color?: string;
  aiValue?: number;
  /** v0.6.7：底层「已动工」副条（含 in_progress / review / completed），用淡色背景表示 */
  inProgressValue?: number;
  style?: React.CSSProperties;
}

function clampPct(value: number): string {
  return `${Math.min(100, Math.max(0, value))}%`;
}

function setVars(element: HTMLElement | null, vars: Record<string, string>): void {
  if (!element) return;
  for (const [name, value] of Object.entries(vars)) {
    element.style.setProperty(name, value);
  }
}

const UNITLESS_STYLE_KEYS = new Set([
  "flex",
  "flexGrow",
  "flexShrink",
  "fontWeight",
  "lineHeight",
  "opacity",
  "order",
  "zIndex",
]);

function toCssPropertyName(key: string): string {
  if (key.startsWith("--")) return key;
  return key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function serializeStyleValue(key: string, value: React.CSSProperties[keyof React.CSSProperties]): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (typeof value === "number" && value !== 0 && !UNITLESS_STYLE_KEYS.has(key)) {
    return `${value}px`;
  }
  return String(value);
}

export function ProgressBar({ value, color = "var(--color-accent)", aiValue, inProgressValue, style }: ProgressBarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const callerStyleKeysRef = useRef<Array<keyof React.CSSProperties>>([]);
  const normalizedAiValue = aiValue || 0;

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;

    for (const key of callerStyleKeysRef.current) {
      if (!style || !(key in style)) {
        element.style.removeProperty(toCssPropertyName(String(key)));
      }
    }

    if (style) {
      for (const [key, value] of Object.entries(style)) {
        element.style.setProperty(toCssPropertyName(key), serializeStyleValue(key, value));
      }
      callerStyleKeysRef.current = Object.keys(style) as Array<keyof React.CSSProperties>;
    } else {
      callerStyleKeysRef.current = [];
    }
  }, [style]);

  return (
    <div
      ref={rootRef}
      className={styles.root}
    >
      {/* 第 0 层：已动工（最浅） */}
      {inProgressValue !== undefined && inProgressValue > 0 && (
        <i
          ref={(element) => setVars(element, { "--progress-width": clampPct(inProgressValue) })}
          className={`${styles.segment} ${styles.inProgress}`}
        />
      )}
      {/* 第 1 层：AI 完成（紫色，从左 0 到 aiValue） */}
      {aiValue !== undefined && aiValue > 0 && (
        <i
          ref={(element) => setVars(element, { "--progress-width": clampPct(aiValue) })}
          className={`${styles.segment} ${styles.ai}`}
        />
      )}
      {/* 第 2 层：人工完成（accent，从 aiValue 到 value） */}
      <i
        ref={(element) =>
          setVars(element, {
            "--progress-left": normalizedAiValue ? clampPct(normalizedAiValue) : "0%",
            "--progress-width": clampPct(value - normalizedAiValue),
            "--progress-color": color,
          })
        }
        className={`${styles.segment} ${styles.value}`}
      />
    </div>
  );
}

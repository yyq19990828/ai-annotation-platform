import type { CSSProperties } from "react";

export type TextOutputDefault = "" | "box" | "mask" | "both";

interface Props {
  value: TextOutputDefault;
  onChange: (v: TextOutputDefault) => void;
  /** 透传到 <select> 的样式（保持调用方一致风格）。 */
  style?: CSSProperties;
}

/**
 * v0.9.6 · 共享组件 — SAM 文本预标默认输出 4 项下拉.
 *
 * 由 GeneralSection (项目设置编辑) 与 CreateProjectWizard Step 4 (新建向导)
 * 共用; 改 4 项含义时只动这一处.
 */
export function TextOutputDefaultSelect({ value, onChange, style }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as TextOutputDefault)}
      style={{ cursor: "pointer", ...style }}
    >
      <option value="">自动按项目类型（image-det → 框 / 其它 → 掩膜）</option>
      <option value="box">□ 框（仅 DINO，速度最快，image-det 项目首选）</option>
      <option value="mask">○ 掩膜（DINO + SAM，image-seg 项目首选）</option>
      <option value="both">⊕ 全部（同实例配对返回框 + 掩膜）</option>
    </select>
  );
}

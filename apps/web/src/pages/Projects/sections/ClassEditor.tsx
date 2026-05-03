/**
 * v0.7.0 · ClassEditor
 *
 * 从 ClassesSection 抽出的受控组件：颜色 + 排序 + 删除 + 新增。
 * 由 ClassesSection（保存按钮的薄外壳）和 CreateProjectWizard（向导步骤）共用。
 */
import { useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { classColor } from "@/pages/Workbench/stage/colors";

export interface ClassRow {
  name: string;
  color: string;
}

const inputStyle: CSSProperties = {
  boxSizing: "border-box",
  padding: "5px 8px",
  fontSize: 13,
  background: "var(--color-bg-sunken)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-fg)",
  outline: "none",
  fontFamily: "inherit",
};

function rgbToHex(rgb: string): string {
  if (rgb.startsWith("#") && rgb.length === 7) return rgb;
  try {
    const cvs = document.createElement("canvas");
    cvs.width = cvs.height = 1;
    const ctx = cvs.getContext("2d")!;
    ctx.fillStyle = rgb;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  } catch {
    return "#888888";
  }
}

export function defaultColorFor(name: string): string {
  return rgbToHex(classColor(name));
}

interface Props {
  value: ClassRow[];
  onChange: (next: ClassRow[]) => void;
  /** 限定最大数量（向导限 50 防止失误）；0 = 无限制 */
  max?: number;
  emptyHint?: string;
}

export function ClassEditor({ value, onChange, max = 0, emptyHint = "尚未配置任何类别" }: Props) {
  const [classInput, setClassInput] = useState("");

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const out = value.slice();
    [out[i], out[j]] = [out[j], out[i]];
    onChange(out);
  };

  const setColor = (i: number, color: string) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, color } : r)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  const add = () => {
    const v = classInput.trim();
    if (!v || value.some((r) => r.name === v)) {
      setClassInput("");
      return;
    }
    if (max > 0 && value.length >= max) {
      setClassInput("");
      return;
    }
    onChange([...value, { name: v, color: defaultColorFor(v) }]);
    setClassInput("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {value.length === 0 && (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            color: "var(--color-fg-subtle)",
            border: "1px dashed var(--color-border)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
          }}
        >
          {emptyHint}
        </div>
      )}

      {value.map((r, i) => (
        <div
          key={r.name}
          style={{
            display: "grid",
            gridTemplateColumns: "auto 24px 1fr 70px auto",
            gap: 8,
            alignItems: "center",
            padding: "6px 10px",
            background: "var(--color-bg-elev)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--color-fg-subtle)", width: 20, textAlign: "right" }}>
            {i + 1}
          </span>
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              background: r.color,
              border: "1px solid var(--color-border)",
              display: "inline-block",
            }}
          />
          <span style={{ fontSize: 13, color: "var(--color-fg)" }}>{r.name}</span>
          <input
            type="color"
            value={r.color}
            onChange={(e) => setColor(i, e.target.value)}
            style={{
              width: 60,
              height: 24,
              padding: 0,
              border: "1px solid var(--color-border)",
              borderRadius: 3,
              background: "transparent",
              cursor: "pointer",
            }}
          />
          <div style={{ display: "flex", gap: 4 }}>
            <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} title="上移">
              <Icon name="chevUp" size={11} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => move(i, 1)}
              disabled={i === value.length - 1}
              title="下移"
            >
              <Icon name="chevDown" size={11} />
            </Button>
            <Button size="sm" variant="danger" onClick={() => remove(i)} title="删除">
              <Icon name="trash" size={11} />
            </Button>
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <input
          value={classInput}
          onChange={(e) => setClassInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={
            max > 0 && value.length >= max
              ? `最多 ${max} 个类别`
              : "新增类别名（回车）"
          }
          maxLength={30}
          disabled={max > 0 && value.length >= max}
          style={{ ...inputStyle, flex: 1 }}
        />
        <Button onClick={add} disabled={!classInput.trim() || (max > 0 && value.length >= max)}>
          <Icon name="plus" size={12} />添加
        </Button>
      </div>
    </div>
  );
}

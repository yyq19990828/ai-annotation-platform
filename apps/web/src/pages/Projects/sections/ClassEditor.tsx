/**
 * v0.7.0 · ClassEditor
 *
 * 从 ClassesSection 抽出的受控组件：颜色 + 排序 + 删除 + 新增。
 * 由 ClassesSection（保存按钮的薄外壳）和 CreateProjectWizard（向导步骤）共用。
 */
import { useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { classColor } from "@/pages/Workbench/stage/colors";

export interface ClassRow {
  name: string;
  color: string;
  /** v0.9.5 · 英文 alias，供 SAM 文本预标 prompt 下拉直填。ASCII-only / max 50 字符。 */
  alias?: string;
}

const ALIAS_PATTERN = /^[a-zA-Z0-9 ,_-]*$/;

/** v0.9.6 · 与后端 ClassConfigEntry._normalize_alias 等价的前端实现.
 * blur 时规范化, 让所见即所得 + DINO 召回更稳; 后端 field_validator 兜底.
 */
function normalizeAlias(raw: string): string {
  let s = raw.toLowerCase().trim();
  if (!s) return s;
  // 折叠 [空白+逗号]+ 为单 ","; "a , , b" → "a,b"
  s = s.replace(/\s*,[\s,]*/g, ",");
  // 折叠多重空格
  s = s.replace(/\s+/g, " ");
  // 去掉首尾遗留逗号
  s = s.replace(/^,+|,+$/g, "").trim();
  return s;
}

const ALIAS_NORM_HINTED_KEY = "cfg:aliasNormHinted";

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
  const pushToast = useToastStore((s) => s.push);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const out = value.slice();
    [out[i], out[j]] = [out[j], out[i]];
    onChange(out);
  };

  const setColor = (i: number, color: string) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, color } : r)));
  const setAlias = (i: number, raw: string) => {
    // v0.9.6 · 输入时若含非 ASCII 提示一次 (沿用 pattern 拒绝, toast 友好提示).
    if (!ALIAS_PATTERN.test(raw)) {
      try {
        if (!sessionStorage.getItem("cfg:aliasAsciiHinted")) {
          sessionStorage.setItem("cfg:aliasAsciiHinted", "1");
          pushToast({
            msg: "alias 仅支持 ASCII",
            sub: "DINO 文本召回仅认英文 / 数字 / 空格 / , _ -",
            kind: "warning",
          });
        }
      } catch {
        // sessionStorage 不可用时静默
      }
      return;
    }
    const alias = raw.trim() === "" ? undefined : raw;
    onChange(value.map((r, idx) => (idx === i ? { ...r, alias } : r)));
  };

  /** v0.9.6 · onBlur 触发规范化: lower / strip / 折叠空格逗号; 与后端 schema 保持一致. */
  const normalizeAliasOnBlur = (i: number) => {
    const cur = value[i]?.alias ?? "";
    if (!cur) return;
    const next = normalizeAlias(cur);
    if (next === cur) return;
    onChange(value.map((r, idx) => (idx === i ? { ...r, alias: next || undefined } : r)));
    try {
      if (!sessionStorage.getItem(ALIAS_NORM_HINTED_KEY)) {
        sessionStorage.setItem(ALIAS_NORM_HINTED_KEY, "1");
        pushToast({
          msg: "alias 已自动规范化",
          sub: "DINO 推荐全小写英文; 重复空格 / 逗号已折叠",
          kind: "",
        });
      }
    } catch {
      // sessionStorage 不可用时静默
    }
  };
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
            gridTemplateColumns: "auto 24px minmax(0, 1.4fr) minmax(0, 1.2fr) 70px auto",
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
            value={r.alias ?? ""}
            onChange={(e) => setAlias(i, e.target.value)}
            onBlur={() => normalizeAliasOnBlur(i)}
            placeholder="英文 alias（SAM 提示用，可空）"
            maxLength={50}
            title="供 SAM 文本预标 prompt 下拉填入；ASCII 字母/数字/空格/逗号/下划线/连字符；blur 自动规范化"
            style={{ ...inputStyle, fontSize: 12 }}
          />
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

import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import type { ProjectResponse, ClassesConfig } from "@/api/projects";
import { classColor } from "@/pages/Workbench/stage/colors";

const inputStyle: CSSProperties = {
  boxSizing: "border-box", padding: "5px 8px", fontSize: 13,
  background: "var(--color-bg-sunken)", border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)", color: "var(--color-fg)",
  outline: "none", fontFamily: "inherit",
};

interface Row {
  name: string;
  color: string;
}

function rgbToHex(rgb: string): string {
  if (rgb.startsWith("#") && rgb.length === 7) return rgb;
  // 通过 canvas 换算 oklch / 任意 CSS 颜色 → hex（一次性）
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

function buildRows(project: ProjectResponse): Row[] {
  const cfg = project.classes_config ?? {};
  const ordered = (project.classes ?? []).slice().sort((a, b) => {
    const oa = cfg[a]?.order ?? Number.POSITIVE_INFINITY;
    const ob = cfg[b]?.order ?? Number.POSITIVE_INFINITY;
    return oa - ob;
  });
  return ordered.map((name) => ({
    name,
    color: cfg[name]?.color ?? rgbToHex(classColor(name)),
  }));
}

export function ClassesSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const update = useUpdateProject(project.id);
  const [rows, setRows] = useState<Row[]>(() => buildRows(project));
  const [classInput, setClassInput] = useState("");

  useEffect(() => { setRows(buildRows(project)); }, [project]);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    setRows((s) => {
      const out = s.slice();
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  };

  const setColor = (i: number, color: string) => setRows((s) => s.map((r, idx) => idx === i ? { ...r, color } : r));
  const remove = (i: number) => setRows((s) => s.filter((_, idx) => idx !== i));

  const add = () => {
    const v = classInput.trim();
    if (!v || rows.some((r) => r.name === v)) return setClassInput("");
    const fallbackHex = rgbToHex(classColor(v));
    setRows((s) => [...s, { name: v, color: fallbackHex }]);
    setClassInput("");
  };

  const initial = buildRows(project);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);

  const onSave = () => {
    const classes = rows.map((r) => r.name);
    const classes_config: ClassesConfig = {};
    rows.forEach((r, i) => {
      classes_config[r.name] = { color: r.color, order: i };
    });
    update.mutate(
      { classes, classes_config },
      {
        onSuccess: () => pushToast({ msg: "类别配置已保存", kind: "success" }),
        onError: (err) => pushToast({ msg: "保存失败", sub: (err as Error).message, kind: "error" }),
      },
    );
  };

  return (
    <Card>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>类别管理（颜色 + 排序）</h3>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ fontSize: 12, color: "var(--color-fg-muted)", margin: 0, lineHeight: 1.5 }}>
          每个类别可独立配置颜色（标注框 stroke / 标签底色）。顺序影响数字键 1-9 / a-z 映射与左侧类别面板展示。
        </p>

        {rows.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--color-fg-subtle)", border: "1px dashed var(--color-border)", borderRadius: "var(--radius-md)" }}>
            尚未配置任何类别
          </div>
        )}

        {rows.map((r, i) => (
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
            <span style={{ fontSize: 11, color: "var(--color-fg-subtle)", width: 20, textAlign: "right" }}>{i + 1}</span>
            <span style={{
              width: 18, height: 18, borderRadius: 4,
              background: r.color, border: "1px solid var(--color-border)",
              display: "inline-block",
            }} />
            <span style={{ fontSize: 13, color: "var(--color-fg)" }}>{r.name}</span>
            <input
              type="color"
              value={r.color}
              onChange={(e) => setColor(i, e.target.value)}
              style={{ width: 60, height: 24, padding: 0, border: "1px solid var(--color-border)", borderRadius: 3, background: "transparent", cursor: "pointer" }}
            />
            <div style={{ display: "flex", gap: 4 }}>
              <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} title="上移">
                <Icon name="chevUp" size={11} />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="下移">
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
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="新增类别名（回车）"
            maxLength={30}
            style={{ ...inputStyle, flex: 1 }}
          />
          <Button onClick={add} disabled={!classInput.trim()}>
            <Icon name="plus" size={12} />添加
          </Button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="primary" disabled={!dirty || update.isPending} onClick={onSave}>
            {update.isPending ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

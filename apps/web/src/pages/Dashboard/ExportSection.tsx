import { useState } from "react";
import { projectsApi, type ExportFormat } from "@/api/projects";
import { usePopover } from "@/hooks/usePopover";

interface ExportSectionProps {
  projectId: string;
}

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "coco", label: "COCO" },
  { value: "voc", label: "VOC" },
  { value: "yolo", label: "YOLO" },
];

/** 项目行的「导出」按钮 + 浮层。
 *  浮层包含格式选择 + 「包含属性数据」复选框（默认勾选 = 后端 default true）。
 *  取消勾选时附加 ?include_attributes=false，输出 v0.4.9 之前的兼容格式。 */
export function ExportSection({ projectId }: ExportSectionProps) {
  const pop = usePopover();
  const [format, setFormat] = useState<ExportFormat>("coco");
  const [includeAttributes, setIncludeAttributes] = useState(true);
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      await projectsApi.exportProject(projectId, format, { includeAttributes });
      pop.close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{ position: "relative", display: "inline-flex" }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={(el) => { pop.anchorRef.current = el; }}
        type="button"
        onClick={pop.toggle}
        title="导出标注数据"
        style={{
          padding: "4px 8px",
          fontSize: 11,
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-elev)",
          cursor: "pointer",
          color: "var(--color-fg-muted)",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        导出 ▾
      </button>
      {pop.open && (
        <div
          ref={(el) => { pop.popoverRef.current = el; }}
          role="dialog"
          aria-label="导出选项"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 30,
            minWidth: 180,
            padding: 12,
            background: "var(--color-bg-elev)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>格式</div>
            <div style={{ display: "flex", gap: 4 }}>
              {FORMATS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFormat(f.value)}
                  style={{
                    flex: 1,
                    padding: "4px 8px",
                    fontSize: 11,
                    borderRadius: "var(--radius-sm)",
                    border: `1px solid ${format === f.value ? "oklch(0.55 0.18 250)" : "var(--color-border)"}`,
                    background: format === f.value ? "oklch(0.55 0.18 250 / 0.10)" : "var(--color-bg-sunken)",
                    color: format === f.value ? "oklch(0.55 0.18 250)" : "var(--color-fg)",
                    cursor: "pointer",
                    fontWeight: format === f.value ? 600 : 400,
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={includeAttributes}
              onChange={(e) => setIncludeAttributes(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <span style={{ color: "var(--color-fg)" }}>包含属性数据</span>
          </label>
          <div style={{ fontSize: 10, color: "var(--color-fg-muted)", lineHeight: 1.4 }}>
            {includeAttributes
              ? "导出包将包含每个标注的 attributes 字段。"
              : "兼容旧版（v0.4.9 之前）格式，不含属性。"}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={handleExport}
            style={{
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: "var(--radius-sm)",
              border: "1px solid oklch(0.55 0.18 250)",
              background: "oklch(0.55 0.18 250)",
              color: "white",
              cursor: busy ? "wait" : "pointer",
              fontWeight: 600,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "导出中…" : "导出"}
          </button>
        </div>
      )}
    </div>
  );
}

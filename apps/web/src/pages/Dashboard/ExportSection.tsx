import { useState } from "react";
import { projectsApi, type ExportFormat, type VideoFrameMode } from "@/api/projects";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import styles from "./ExportSection.module.css";

interface ExportSectionProps {
  projectId: string;
  projectTypeKey?: string;
}

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "coco", label: "COCO" },
  { value: "voc", label: "VOC" },
  { value: "yolo", label: "YOLO" },
];

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

/** 项目行的「导出」按钮 + 浮层。
 *  浮层包含格式选择 + 「包含属性数据」复选框（默认勾选 = 后端 default true）。
 *  v0.9.3 · 改用 DropdownMenu content 模式（统一浮层骨架与键盘行为）。 */
export function ExportSection({ projectId, projectTypeKey }: ExportSectionProps) {
  return (
    <div className={styles.root} onClick={(e) => e.stopPropagation()}>
      <DropdownMenu
        align="end"
        minWidth={200}
        trigger={({ toggle, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={toggle}
            title="导出标注数据"
            className={styles.trigger}
          >
            导出 ▾
          </button>
        )}
        content={({ close }) => (
          <ExportForm
            projectId={projectId}
            projectTypeKey={projectTypeKey}
            onDone={close}
          />
        )}
      />
    </div>
  );
}

function ExportForm({ projectId, projectTypeKey, onDone }: { projectId: string; projectTypeKey?: string; onDone: () => void }) {
  const isVideoProject = projectTypeKey === "video-track";
  const [format, setFormat] = useState<ExportFormat>("coco");
  const [includeAttributes, setIncludeAttributes] = useState(true);
  const [videoFrameMode, setVideoFrameMode] = useState<VideoFrameMode>("keyframes");
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      await projectsApi.exportProject(projectId, isVideoProject ? "coco" : format, {
        includeAttributes,
        ...(isVideoProject ? { videoFrameMode } : {}),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="导出选项"
      className={styles.form}
    >
      {isVideoProject ? (
        <>
          <div className={styles.field}>
            <div className={styles.label}>格式</div>
            <div className={styles.readonlyValue}>
              Video JSON
            </div>
          </div>
          <div className={styles.field}>
            <div className={styles.label}>帧模式</div>
            <div className={styles.optionRow}>
              {[
                { value: "keyframes" as const, label: "关键帧" },
                { value: "all_frames" as const, label: "所有帧" },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setVideoFrameMode(item.value)}
                  className={cn(styles.optionButton, videoFrameMode === item.value && styles.optionButtonActive)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className={styles.field}>
          <div className={styles.label}>格式</div>
          <div className={styles.optionRow}>
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFormat(f.value)}
                className={cn(styles.optionButton, format === f.value && styles.optionButtonActive)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={includeAttributes}
          onChange={(e) => setIncludeAttributes(e.target.checked)}
          className={styles.checkbox}
        />
        <span className={styles.checkboxText}>包含属性数据</span>
      </label>
      <div className={styles.helpText}>
        {includeAttributes
          ? "导出包将包含每个标注的 attributes 字段。"
          : "兼容旧版（v0.4.9 之前）格式，不含属性。"}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={handleExport}
        className={styles.submitButton}
      >
        {busy ? "导出中…" : "导出"}
      </button>
    </div>
  );
}

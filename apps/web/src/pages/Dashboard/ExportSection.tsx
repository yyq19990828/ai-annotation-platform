import { useState } from "react";
import { projectsApi, type ExportFormat, type VideoFrameMode } from "@/api/projects";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { useToastStore } from "@/components/ui/Toast";
import styles from "./ExportSection.module.css";

interface ExportSectionProps {
  projectId: string;
  projectTypeKey?: string;
}

// v0.10.27 · VOC 隐藏（硬编码尺寸 bug + 少用），ExportFormat 类型保留兼容后端契约。
const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "coco", label: "COCO" },
  { value: "yolo", label: "YOLO" },
  // v0.10.15 · 平台原生无损中间格式 (含 predictions + annotations 双数组).
  { value: "aap_json", label: "AAP JSON" },
];

// v0.10.31 · Phase 4.7 · 视频项目导出格式。帧模式仅 Video JSON 有意义；
// MOT/KITTI 隐含「采样网格 + all_frames」(D2)，AAP 透传源帧。
const VIDEO_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "video_json", label: "Video JSON" },
  { value: "aap_json", label: "AAP JSON" },
  { value: "mot", label: "MOT" },
  { value: "kitti", label: "KITTI" },
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
  const [format, setFormat] = useState<ExportFormat>(isVideoProject ? "video_json" : "coco");
  const [includeAttributes, setIncludeAttributes] = useState(true);
  const [videoFrameMode, setVideoFrameMode] = useState<VideoFrameMode>("keyframes");
  const [busy, setBusy] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  // 帧模式仅对 Video JSON 有意义（MOT/KITTI 走采样网格，AAP 透传源帧）。
  const showFrameMode = isVideoProject && format === "video_json";

  const handleExport = async () => {
    setBusy(true);
    try {
      await projectsApi.exportProject(projectId, format, {
        includeAttributes,
        ...(showFrameMode ? { videoFrameMode } : {}),
      });
      pushToast({
        msg: "导出已入队",
        sub: "可在右上角任务铃查看进度并下载",
        kind: "success",
      });
      onDone();
    } catch (err) {
      pushToast({
        msg: "导出发起失败",
        sub: err instanceof Error ? err.message : undefined,
        kind: "error",
      });
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
      <div className={styles.field}>
        <div className={styles.label}>格式</div>
        <div className={styles.optionRow}>
          {(isVideoProject ? VIDEO_FORMATS : FORMATS).map((f) => (
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
      {showFrameMode && (
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

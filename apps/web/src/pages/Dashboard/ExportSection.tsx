import { useState } from "react";
import { projectsApi, type ExportFormat, type VideoFrameMode } from "@/api/projects";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/components/ui/Toast";
import styles from "./ExportSection.module.css";

interface ExportSectionProps {
  projectId: string;
  projectTypeKey?: string;
}

// v0.10.27 · VOC 隐藏（硬编码尺寸 bug + 少用），ExportFormat 类型保留兼容后端契约。
const FORMATS: { value: ExportFormat; label: string; description: string }[] = [
  { value: "coco", label: "COCO", description: "通用检测 / 分割标准，单 annotations.json。" },
  { value: "yolo", label: "YOLO", description: "每图一个 .txt + classes.txt，适合 YOLOv8 训练。" },
  // v0.10.15 · 平台原生无损中间格式 (含 predictions + annotations 双数组).
  { value: "aap_json", label: "AAP JSON", description: "平台原生无损，含 predictions + annotations 双数组。" },
];

// v0.10.31 · Phase 4.7 · 视频项目导出格式。帧模式仅 Video JSON 有意义；
// MOT/KITTI 隐含「采样网格 + all_frames」(D2)，AAP 透传源帧。
const VIDEO_FORMATS: { value: ExportFormat; label: string; description: string }[] = [
  { value: "video_json", label: "Video JSON", description: "平台视频轨迹 JSON，可选关键帧或展开所有帧。" },
  { value: "aap_json", label: "AAP JSON", description: "无损保留 video_track geometry 与项目配置。" },
  { value: "mot", label: "MOT", description: "MOT 16/17/20 跟踪评测格式，按采样网格重排帧号。" },
  { value: "kitti", label: "KITTI", description: "KITTI Tracking 2D labels，适配 KITTI 工具链。" },
];

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

/** 项目行的「导出」按钮 + Modal。
 *  Modal 包含格式选择 + 「包含属性数据」复选框（默认勾选 = 后端 default true）。 */
export function ExportSection({ projectId, projectTypeKey }: ExportSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.root} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="导出标注数据"
        className={styles.trigger}
      >
        导出
      </button>
      <Modal
        open={open}
        title="导出标注数据"
        width={520}
        onClose={() => setOpen(false)}
      >
        <ExportForm
          projectId={projectId}
          projectTypeKey={projectTypeKey}
          onDone={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </Modal>
    </div>
  );
}

function ExportForm({
  projectId,
  projectTypeKey,
  onDone,
  onCancel,
}: {
  projectId: string;
  projectTypeKey?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
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
    <div className={styles.form}>
      <div className={styles.field}>
        <div className={styles.label}>格式</div>
        <div className={styles.optionList}>
          {(isVideoProject ? VIDEO_FORMATS : FORMATS).map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFormat(f.value)}
              aria-pressed={format === f.value}
              className={cn(styles.optionButton, format === f.value && styles.optionButtonActive)}
            >
              <span className={styles.optionLabel}>{f.label}</span>
              <span className={styles.optionDescription}>{f.description}</span>
            </button>
          ))}
        </div>
      </div>
      {showFrameMode && (
        <div className={styles.field}>
          <div className={styles.label}>帧模式</div>
          <div className={styles.frameModeRow}>
            {[
              { value: "keyframes" as const, label: "关键帧", description: "只导出人工 / 预测关键帧。" },
              { value: "all_frames" as const, label: "所有帧", description: "按相邻有效关键帧线性插值展开。" },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setVideoFrameMode(item.value)}
                aria-pressed={videoFrameMode === item.value}
                className={cn(styles.optionButton, videoFrameMode === item.value && styles.optionButtonActive)}
              >
                <span className={styles.optionLabel}>{item.label}</span>
                <span className={styles.optionDescription}>{item.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={styles.attributesPanel}>
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
      </div>
      <div className={styles.footer}>
        <button
          type="button"
          onClick={onCancel}
          className={styles.cancelButton}
        >
          取消
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleExport}
          className={styles.submitButton}
        >
          {busy ? "导出中…" : "开始导出"}
        </button>
      </div>
    </div>
  );
}

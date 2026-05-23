import { useState } from "react";
import { projectsApi, type ExportTarget, type VideoFrameMode } from "@/api/projects";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import styles from "./ExportSection.module.css";

interface ExportSectionProps {
  projectId: string;
  projectTypeKey?: string;
}

interface TargetOption {
  value: ExportTarget;
  label: string;
  description: string;
}

// v0.10.43 · 多目标导出。图像项目：COCO / AAP 单选卡 + YOLO 三变体分组（几何映射不同）。
type ImageOption =
  | ({ kind: "single" } & TargetOption)
  | { kind: "group"; label: string; description: string; members: TargetOption[] };

const IMAGE_OPTIONS: ImageOption[] = [
  { kind: "single", value: "coco", label: "COCO", description: "通用检测 / 分割 / 关键点，单 annotations.json。" },
  {
    kind: "group",
    label: "YOLO",
    description: "按标注几何选变体，可多选。",
    members: [
      { value: "yolo-det", label: "检测", description: "矩形框 cls cx cy w h，YOLOv8 检测。" },
      { value: "yolo-obb", label: "旋转框", description: "rotated_bbox 四角坐标（OBB）。" },
      { value: "yolo-seg", label: "分割", description: "polygon / mask 归一化多边形。" },
    ],
  },
  { kind: "single", value: "aap_json", label: "AAP JSON", description: "平台原生无损，含 predictions + annotations 双数组。" },
];

const VIDEO_OPTIONS: TargetOption[] = [
  { value: "video_json", label: "Video JSON", description: "平台视频轨迹 JSON，可选关键帧或展开所有帧。" },
  { value: "aap_json", label: "AAP JSON", description: "无损保留 video_track geometry 与项目配置。" },
  { value: "mot", label: "MOT", description: "MOT 16/17/20 跟踪评测格式，按采样网格重排帧号。" },
  { value: "kitti", label: "KITTI", description: "KITTI Tracking 2D labels，适配 KITTI 工具链。" },
];

const FRAME_MODES: { value: VideoFrameMode; label: string; description: string }[] = [
  { value: "keyframes", label: "关键帧", description: "只导出人工 / 预测关键帧。" },
  { value: "all_frames", label: "所有帧", description: "按相邻有效关键帧线性插值展开。" },
];

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

/** 项目行的「导出」按钮 + Modal（v0.10.43 多目标多选）。 */
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

/** 多选选项卡（带勾选方块）。 */
function CheckCard({
  option,
  active,
  onToggle,
}: {
  option: TargetOption;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(styles.optionButton, active && styles.optionButtonActive)}
    >
      <span className={cn(styles.check, active && styles.checkOn)} aria-hidden>
        {active && <Icon name="check" size={12} />}
      </span>
      <span className={styles.optionText}>
        <span className={styles.optionLabel}>{option.label}</span>
        <span className={styles.optionDescription}>{option.description}</span>
      </span>
    </button>
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
  const [targets, setTargets] = useState<ExportTarget[]>(
    isVideoProject ? ["video_json"] : ["coco"],
  );
  const [yoloExpanded, setYoloExpanded] = useState(false);
  const [includeAttributes, setIncludeAttributes] = useState(true);
  const [videoFrameMode, setVideoFrameMode] = useState<VideoFrameMode>("keyframes");
  const [busy, setBusy] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  // 帧模式仅对 Video JSON 有意义（MOT/KITTI 走采样网格，AAP 透传源帧）。
  const showFrameMode = isVideoProject && targets.includes("video_json");

  const toggleTarget = (value: ExportTarget) => {
    setTargets((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value],
    );
  };

  const handleExport = async () => {
    if (targets.length === 0) return;
    setBusy(true);
    try {
      await projectsApi.exportProject(projectId, targets, {
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
        <div className={styles.label}>导出目标（可多选）</div>
        <div className={styles.optionList}>
          {isVideoProject
            ? VIDEO_OPTIONS.map((o) => (
                <CheckCard
                  key={o.value}
                  option={o}
                  active={targets.includes(o.value)}
                  onToggle={() => toggleTarget(o.value)}
                />
              ))
            : IMAGE_OPTIONS.map((o) =>
                o.kind === "single" ? (
                  <CheckCard
                    key={o.value}
                    option={o}
                    active={targets.includes(o.value)}
                    onToggle={() => toggleTarget(o.value)}
                  />
                ) : (
                  <div key={o.label} className={styles.group}>
                    <button
                      type="button"
                      onClick={() => setYoloExpanded((v) => !v)}
                      aria-expanded={yoloExpanded}
                      className={styles.groupHeader}
                    >
                      <Icon name={yoloExpanded ? "chevDown" : "chevRight"} size={14} />
                      <span className={styles.optionLabel}>{o.label}</span>
                      {(() => {
                        const n = o.members.filter((m) => targets.includes(m.value)).length;
                        return n > 0 ? (
                          <span className={styles.countBadge}>
                            {n}/{o.members.length}
                          </span>
                        ) : null;
                      })()}
                      <span className={styles.optionDescription}>{o.description}</span>
                    </button>
                    {yoloExpanded && (
                      <div className={styles.groupMembers}>
                        {o.members.map((m) => (
                          <CheckCard
                            key={m.value}
                            option={m}
                            active={targets.includes(m.value)}
                            onToggle={() => toggleTarget(m.value)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ),
              )}
        </div>
        <div className={styles.summary}>
          {targets.length === 0 ? (
            <span className={styles.summaryWarn}>请至少选择一个导出目标</span>
          ) : targets.length === 1 ? (
            "将导出 1 个目标，产出单个压缩包。"
          ) : (
            `已选 ${targets.length} 个目标 → 打包为 1 个 zip（各目标分子目录）。`
          )}
        </div>
      </div>
      {showFrameMode && (
        <div className={styles.field}>
          <div className={styles.label}>帧模式（单选）</div>
          <div className={styles.radioRow} role="radiogroup">
            {FRAME_MODES.map((item) => {
              const on = videoFrameMode === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setVideoFrameMode(item.value)}
                  className={cn(styles.radioButton, on && styles.radioButtonActive)}
                >
                  <span className={cn(styles.radioDot, on && styles.radioDotOn)} aria-hidden />
                  <span className={styles.optionText}>
                    <span className={styles.optionLabel}>{item.label}</span>
                    <span className={styles.optionDescription}>{item.description}</span>
                  </span>
                </button>
              );
            })}
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
        <div className={styles.helpText}>
          仅对 COCO / YOLO / Video JSON 生效（YOLO 写为伴生 .attrs.json）；AAP JSON 始终包含，MOT / KITTI 无此字段。
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
          disabled={busy || targets.length === 0}
          onClick={handleExport}
          className={styles.submitButton}
        >
          {busy ? "导出中…" : "开始导出"}
        </button>
      </div>
    </div>
  );
}

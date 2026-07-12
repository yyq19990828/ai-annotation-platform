import { useState } from "react";
import { projectsApi, type ExportTarget, type VideoFrameMode } from "@/api/projects";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";

// 多选选项卡 / 单选帧模式卡共用的基线（UA-safe：消原生 button 默认样式）。
const OPTION_BUTTON_CLASS =
  "flex min-w-0 cursor-pointer appearance-none flex-row items-start gap-2.5 rounded-md border border-border bg-muted px-3 py-2.5 text-left text-xs font-normal leading-snug text-foreground hover:border-border hover:bg-muted";
const OPTION_BUTTON_ACTIVE_CLASS = "border-brand bg-brand/10 font-semibold text-brand";
const OPTION_LABEL_CLASS = "font-semibold text-inherit";

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
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
  { value: "yolo-frames-det", label: "YOLO 逐帧", description: "按采样网格抽帧，导出检测训练用 labels。" },
  {
    value: "yolo-frames-seg",
    label: "YOLO 逐帧分割",
    description: "按采样网格抽帧，导出分割训练用 labels（保留多边形顶点；bbox / polyline 跳过）。",
  },
  {
    value: "coco-frames-seg",
    label: "COCO 逐帧分割",
    description: "按采样网格抽帧，导出 COCO 分割数据集（保留多边形顶点；bbox / polyline 跳过）。",
  },
  { value: "aap_json", label: "AAP JSON", description: "无损保留 video_track geometry 与项目配置。" },
  { value: "mot", label: "MOT", description: "MOT 16/17/20 跟踪评测格式，按采样网格重排帧号。" },
  { value: "kitti", label: "KITTI", description: "KITTI Tracking 2D labels，适配 KITTI 工具链。" },
];

const LIDAR_OPTIONS: TargetOption[] = [
  { value: "aap_json", label: "AAP JSON", description: "平台原生无损，保留 3D 几何与项目配置。" },
  { value: "kitti", label: "KITTI 3D", description: "逐帧 label_2 + calib，输出 KITTI camera 坐标。" },
  { value: "nuscenes", label: "nuScenes JSON", description: "单帧 sample 风格，ego 坐标 + 占位 ego_pose。" },
  { value: "pointmask", label: "Point Mask", description: "逐点 uint32 label + 类别映射，适配 3D 分割训练前处理。" },
];

const FRAME_MODES: { value: VideoFrameMode; label: string; description: string }[] = [
  { value: "keyframes", label: "关键帧", description: "只导出人工 / 预测关键帧。" },
  { value: "all_frames", label: "所有帧", description: "按相邻有效关键帧线性插值展开。" },
];

/** 导出 Modal（v0.10.43 多目标多选）。受控开关，供独立触发器或 ⋮ 菜单复用。 */
export function ExportModal({
  open,
  onClose,
  projectId,
  projectTypeKey,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectTypeKey?: string;
}) {
  return (
    <Modal open={open} title="导出标注数据" width={520} onClose={onClose}>
      <ExportForm
        projectId={projectId}
        projectTypeKey={projectTypeKey}
        onDone={onClose}
        onCancel={onClose}
      />
    </Modal>
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
      className={cn(OPTION_BUTTON_CLASS, active && OPTION_BUTTON_ACTIVE_CLASS)}
    >
      <span
        className={cn(
          "mt-px flex size-4 flex-shrink-0 items-center justify-center rounded-sm border-[1.5px] border-border bg-card",
          active && "border-brand bg-brand text-card",
        )}
        aria-hidden
      >
        {active && <Icon name="check" size={12} />}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className={OPTION_LABEL_CLASS}>{option.label}</span>
        <span className="text-xs font-normal text-muted-foreground">{option.description}</span>
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
  const isLidarProject = projectTypeKey === "lidar";
  const [targets, setTargets] = useState<ExportTarget[]>(
    isVideoProject ? ["video_json"] : isLidarProject ? ["aap_json"] : ["coco"],
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold text-foreground">导出目标（可多选）</div>
        <div className="flex flex-col gap-2">
          {isVideoProject || isLidarProject
            ? (isVideoProject ? VIDEO_OPTIONS : LIDAR_OPTIONS).map((o) => (
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
                  <div key={o.label} className="overflow-hidden rounded-md border border-border bg-muted">
                    <button
                      type="button"
                      onClick={() => setYoloExpanded((v) => !v)}
                      aria-expanded={yoloExpanded}
                      className="flex w-full cursor-pointer appearance-none items-center gap-2 border-0 bg-transparent px-3 py-2.5 text-left text-xs text-foreground hover:bg-muted"
                    >
                      <Icon name={yoloExpanded ? "chevDown" : "chevRight"} size={14} />
                      <span className={OPTION_LABEL_CLASS}>{o.label}</span>
                      {(() => {
                        const n = o.members.filter((m) => targets.includes(m.value)).length;
                        return n > 0 ? (
                          <span className="rounded-full bg-brand/10 px-1.5 py-px text-2xs font-semibold text-brand">
                            {n}/{o.members.length}
                          </span>
                        ) : null;
                      })()}
                      <span className="text-xs font-normal text-muted-foreground">{o.description}</span>
                    </button>
                    {yoloExpanded && (
                      <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
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
        <div className="text-xs leading-snug text-muted-foreground">
          {targets.length === 0 ? (
            <span className="text-status-caution">请至少选择一个导出目标</span>
          ) : targets.length === 1 ? (
            "将导出 1 个目标，产出单个压缩包。"
          ) : (
            `已选 ${targets.length} 个目标 → 打包为 1 个 zip（各目标分子目录）。`
          )}
        </div>
      </div>
      {showFrameMode && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-foreground">帧模式（单选）</div>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {FRAME_MODES.map((item) => {
              const on = videoFrameMode === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setVideoFrameMode(item.value)}
                  className={cn(OPTION_BUTTON_CLASS, on && OPTION_BUTTON_ACTIVE_CLASS)}
                >
                  <span
                    className={cn(
                      "mt-px size-4 flex-shrink-0 rounded-full border-[1.5px] border-border bg-card",
                      on && "border-[4px] border-brand",
                    )}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className={OPTION_LABEL_CLASS}>{item.label}</span>
                    <span className="text-xs font-normal text-muted-foreground">{item.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted px-3 py-2.5">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={includeAttributes}
            onChange={(e) => setIncludeAttributes(e.target.checked)}
            className="cursor-pointer"
          />
          <span className="text-foreground">包含属性数据</span>
        </label>
        <div className="text-xs leading-snug text-muted-foreground">
          {includeAttributes
            ? "导出包将包含每个标注的 attributes 字段。"
            : "兼容旧版（v0.4.9 之前）格式，不含属性。"}
        </div>
        <div className="text-xs leading-snug text-muted-foreground">
          仅对 COCO / YOLO / Video JSON / LiDAR 标准格式生效；AAP JSON 始终包含，MOT 无此字段。
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer appearance-none rounded-sm border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          取消
        </button>
        <button
          type="button"
          disabled={busy || targets.length === 0}
          onClick={handleExport}
          className="cursor-pointer appearance-none rounded-sm border border-brand bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground hover:bg-brand/90 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "导出中…" : "开始导出"}
        </button>
      </div>
    </div>
  );
}

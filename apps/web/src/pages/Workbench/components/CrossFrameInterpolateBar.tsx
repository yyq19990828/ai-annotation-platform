/**
 * v0.15.1 · 跨帧批量延续 / 区间插值入口(3D 工作台,scene 任务专用)。
 *
 * 工作流:
 * 1. 「批量延续→」把当前帧全部 box_3d 运动补偿到下一帧(= Ctrl+Shift+→)。
 * 2. 插值:选中一个 box_3d → 填目标帧 → 「延续到帧」把链建到区间终点(微调后)
 *    → 回到起点帧选中该框 → 「插值填充」生成中间帧(source=interpolated)。
 *
 * 目标帧的 task 经 neighbors(k=20) 反查,超出 ±20 帧提示分段操作。
 */
import { useMemo, useState } from "react";
import { useFrameNeighbors } from "@/hooks/useFrameNeighbors";
import styles from "./CrossFrameInterpolateBar.module.css";

export function CrossFrameInterpolateBar({
  taskId,
  frameIndex,
  sceneTotalFrames,
  selectedGroupId,
  selectedIsBox3d,
  readOnly,
  onPropagateBatch,
  onPropagateToTask,
  onInterpolate,
  pushToast,
}: {
  taskId: string;
  frameIndex: number | null;
  sceneTotalFrames: number | null;
  selectedGroupId: number | null;
  selectedIsBox3d: boolean;
  readOnly: boolean;
  onPropagateBatch: (direction: "next" | "prev") => void;
  onPropagateToTask: (targetTaskId: string, targetFrameIndex: number) => void;
  onInterpolate: (groupId: number, toTaskId: string) => void;
  pushToast: (t: { msg: string; kind?: "success" | "warning" | "error" | "" }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [targetFrameRaw, setTargetFrameRaw] = useState("");
  // 展开才拉 k=20 邻帧(目标帧 task 反查表),折叠态零请求。
  const { data: neighbors } = useFrameNeighbors(open ? taskId : null, 20);
  const taskByFrame = useMemo(() => {
    const m = new Map<number, string>();
    for (const n of [...(neighbors?.prev ?? []), ...(neighbors?.next ?? [])]) {
      m.set(n.frame_index, n.task_id);
    }
    return m;
  }, [neighbors]);

  const maxFrame = sceneTotalFrames != null ? sceneTotalFrames - 1 : null;
  const targetFrame = targetFrameRaw === "" ? null : Number(targetFrameRaw);
  const resolveTarget = (): { taskId: string; frame: number } | null => {
    if (targetFrame == null || !Number.isInteger(targetFrame)) {
      pushToast({ msg: "请填写目标帧号", kind: "" });
      return null;
    }
    if (targetFrame === frameIndex) {
      pushToast({ msg: "目标帧不能是当前帧", kind: "" });
      return null;
    }
    if (maxFrame != null && (targetFrame < 0 || targetFrame > maxFrame)) {
      pushToast({ msg: `目标帧超出范围 (0–${maxFrame})`, kind: "" });
      return null;
    }
    const tid = taskByFrame.get(targetFrame);
    if (!tid) {
      pushToast({ msg: "目标帧超出 ±20 帧反查范围, 请先跳到更近的帧分段操作", kind: "warning" });
      return null;
    }
    return { taskId: tid, frame: targetFrame };
  };

  if (!open) {
    return (
      <button
        type="button"
        className={styles.toggle}
        title="跨帧批量延续 / 区间插值"
        onClick={() => setOpen(true)}
      >
        跨帧工具
      </button>
    );
  }

  return (
    <div className={styles.wrap} role="group" aria-label="跨帧工具">
      <button
        type="button"
        className={styles.btn}
        disabled={readOnly}
        title="当前帧全部 3D 框运动补偿延续到下一帧 (Ctrl+Shift+→)"
        onClick={() => onPropagateBatch("next")}
      >
        批量延续→
      </button>
      <span className={styles.sep} />
      <label className={styles.label}>
        目标帧
        <input
          type="number"
          className={styles.input}
          min={0}
          max={maxFrame ?? undefined}
          value={targetFrameRaw}
          placeholder={frameIndex != null ? String(Math.min(frameIndex + 5, maxFrame ?? frameIndex + 5)) : ""}
          onChange={(e) => setTargetFrameRaw(e.target.value)}
        />
      </label>
      <button
        type="button"
        className={styles.btn}
        disabled={readOnly || !selectedIsBox3d}
        title={selectedIsBox3d ? "把选中框延续到目标帧(建插值链)" : "先选中一个 3D 框"}
        onClick={() => {
          const t = resolveTarget();
          if (t) onPropagateToTask(t.taskId, t.frame);
        }}
      >
        延续到帧
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={readOnly || selectedGroupId == null}
        title={
          selectedGroupId != null
            ? "当前帧与目标帧的同链框之间插值填充中间帧"
            : "选中的框需已有跨帧链(先延续一次建链)"
        }
        onClick={() => {
          const t = resolveTarget();
          if (t && selectedGroupId != null) onInterpolate(selectedGroupId, t.taskId);
        }}
      >
        插值填充
      </button>
      <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="收起跨帧工具">
        ×
      </button>
    </div>
  );
}

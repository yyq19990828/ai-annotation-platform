/**
 * I18 · 创建 pixel-anchored issue 的简易 modal.
 *
 * v0.10.19 形态:
 * - 输入 title / severity / body
 * - anchor 默认走 task 级 (anchor_type='task'); 用户可选填 x/y (0-1 相对坐标) 升级为 pixel anchor
 * - 不挂截图 / 不挂图上单击落点 (留 v0.10.20 接 ImageStage 时做)
 *
 * 提交成功后调用 onSuccess 让 useFeedbacks 失效重拉.
 */
import { useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useCreateFeedback } from "@/hooks/useFeedbacks";
import type {
  FeedbackSeverity,
  ListFeedbacksParams,
} from "@/api/feedbacks";
import styles from "./IssueCreateModal.module.css";

interface Props {
  open: boolean;
  projectId: string;
  taskId: string;
  /** useFeedbacks 当前订阅的 params; 提交后 invalidate 这个 key. */
  listParams: ListFeedbacksParams;
  onClose: () => void;
}

export function IssueCreateModal({ open, projectId, taskId, listParams, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<FeedbackSeverity>("warn");
  const [x, setX] = useState<string>("");
  const [y, setY] = useState<string>("");
  const createMut = useCreateFeedback(listParams);

  if (!open) return null;

  const parsedX = parseFloat(x);
  const parsedY = parseFloat(y);
  const hasValidPixel =
    Number.isFinite(parsedX) && Number.isFinite(parsedY) &&
    parsedX >= 0 && parsedX <= 1 && parsedY >= 0 && parsedY <= 1;
  const pixelMode = x !== "" || y !== "";
  const pixelInvalid = pixelMode && !hasValidPixel;

  const canSubmit = body.trim().length > 0 && !pixelInvalid && !createMut.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    createMut.mutate(
      {
        kind: "issue",
        anchor_type: pixelMode ? "pixel" : "task",
        project_id: projectId,
        task_id: taskId,
        anchor_position: pixelMode ? { x: parsedX, y: parsedY } : null,
        severity,
        title: title.trim() || null,
        body: body.trim(),
      },
      {
        onSuccess: () => {
          setTitle("");
          setBody("");
          setX("");
          setY("");
          onClose();
        },
      },
    );
  };

  return (
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <b className={styles.title}><Icon name="flag" size={14} /> 标记问题 (Issue)</b>
          <Button variant="ghost" size="sm" onClick={onClose} title="关闭"><Icon name="x" size={12} /></Button>
        </div>

        <div className={styles.row}>
          <label className={styles.label}>标题（可选）</label>
          <input
            className={styles.input}
            value={title}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            placeholder="一句话概括"
            maxLength={500}
          />
        </div>

        <div className={styles.row}>
          <label className={styles.label}>严重度</label>
          <div className={styles.severityRow}>
            {(["info", "warn", "blocker"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                className={`${styles.severityChip} ${severity === s ? styles.severityChipActive : ""}`}
                data-severity={s}
              >
                {s === "info" ? "提示" : s === "warn" ? "警告" : "阻断"}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.row}>
          <label className={styles.label}>详情 <span className={styles.required}>*</span></label>
          <textarea
            className={styles.textarea}
            value={body}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
            placeholder="描述问题位置 / 现象 / 期望行为"
            rows={4}
          />
        </div>

        <div className={styles.row}>
          <label className={styles.label}>像素锚点（可选, 0-1 相对坐标）</label>
          <div className={styles.pixelRow}>
            <input
              className={styles.coordInput}
              value={x}
              onChange={(e) => setX(e.target.value)}
              placeholder="x (0-1)"
              type="number"
              step="0.01"
              min="0"
              max="1"
            />
            <input
              className={styles.coordInput}
              value={y}
              onChange={(e) => setY(e.target.value)}
              placeholder="y (0-1)"
              type="number"
              step="0.01"
              min="0"
              max="1"
            />
          </div>
          {pixelInvalid && (
            <span className={styles.hintError}>x/y 必须在 0-1 范围;留空则按任务级 issue 创建</span>
          )}
        </div>

        <div className={styles.footer}>
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
            {createMut.isPending ? "提交中…" : "提交"}
          </Button>
        </div>
      </div>
    </div>
  );
}

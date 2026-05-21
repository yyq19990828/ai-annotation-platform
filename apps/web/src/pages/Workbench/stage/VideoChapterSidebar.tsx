import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  useCreateVideoChapter,
  useDeleteVideoChapter,
  useUpdateVideoChapter,
  useVideoChapters,
} from "@/hooks/useVideoChapters";

import type { FrameTimebase } from "./frameTimebase";
import styles from "./VideoChapterSidebar.module.css";

const CHAPTER_PALETTE = [
  "oklch(0.62 0.18 252)",
  "oklch(0.65 0.18 152)",
  "oklch(0.68 0.16 75)",
  "oklch(0.62 0.20 25)",
  "oklch(0.60 0.20 295)",
];

const PALETTE_CLASSES = [
  styles.paletteBlue,
  styles.paletteGreen,
  styles.paletteAmber,
  styles.paletteRed,
  styles.palettePurple,
];

interface VideoChapterSidebarProps {
  datasetItemId: string | null;
  frameIndex: number;
  maxFrame: number;
  timebase?: FrameTimebase;
  canEdit: boolean;
  onSeekFrame?: (frameIndex: number) => void;
}

function formatChapterDuration(start: number, end: number, timebase?: FrameTimebase) {
  if (!timebase || !Number.isFinite(timebase.fps) || timebase.fps <= 0) {
    return `${end - start + 1} 帧`;
  }
  const seconds = (end - start + 1) / timebase.fps;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function defaultChapterColor(index: number): string {
  return CHAPTER_PALETTE[index % CHAPTER_PALETTE.length];
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

interface ChapterFormState {
  chapterId: string | null;
  title: string;
  startFrame: number;
  endFrame: number;
  color: string;
}

export function VideoChapterSidebar({
  datasetItemId,
  frameIndex,
  maxFrame,
  timebase,
  canEdit,
  onSeekFrame,
}: VideoChapterSidebarProps) {
  const { data: chapters = [], isLoading } = useVideoChapters(datasetItemId);
  const createMutation = useCreateVideoChapter(datasetItemId);
  const updateMutation = useUpdateVideoChapter(datasetItemId);
  const deleteMutation = useDeleteVideoChapter(datasetItemId);

  const [editing, setEditing] = useState<ChapterFormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [editing?.chapterId]);

  const sortedChapters = useMemo(
    () => [...chapters].sort((a, b) => a.start_frame - b.start_frame),
    [chapters],
  );

  const startCreate = () => {
    const fallbackColor = defaultChapterColor(chapters.length);
    setEditing({
      chapterId: null,
      title: "",
      startFrame: frameIndex,
      endFrame: Math.min(maxFrame, frameIndex + Math.max(0, Math.round(maxFrame * 0.1))),
      color: fallbackColor,
    });
  };

  const startEdit = (chapterId: string) => {
    const chapter = chapters.find((c) => c.id === chapterId);
    if (!chapter) return;
    setEditing({
      chapterId: chapter.id,
      title: chapter.title,
      startFrame: chapter.start_frame,
      endFrame: chapter.end_frame,
      color: chapter.color ?? defaultChapterColor(0),
    });
  };

  const cancelForm = () => {
    setEditing(null);
    setError(null);
  };

  const submitForm = async () => {
    if (!editing) return;
    const title = editing.title.trim();
    if (!title) {
      setError("标题不可为空");
      return;
    }
    if (editing.endFrame < editing.startFrame) {
      setError("结束帧必须 ≥ 起始帧");
      return;
    }
    const payload = {
      title,
      start_frame: editing.startFrame,
      end_frame: editing.endFrame,
      color: editing.color,
    };
    try {
      if (editing.chapterId) {
        await updateMutation.mutateAsync({
          chapterId: editing.chapterId,
          payload,
        });
      } else {
        await createMutation.mutateAsync(payload);
      }
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };

  const onDelete = async (chapterId: string) => {
    try {
      await deleteMutation.mutateAsync(chapterId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  if (!datasetItemId) return null;

  return (
    <div
      data-testid="video-chapter-sidebar"
      className={styles.sidebar}
    >
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <b className={styles.title}>章节</b>
          <span className={cn("mono", styles.count)}>
            {sortedChapters.length}
          </span>
        </div>
        {canEdit && (
          <Button
            size="sm"
            className={styles.createButton}
            disabled={Boolean(editing)}
            onClick={startCreate}
            title="新建章节"
          >
            <Icon name="plus" size={13} />新建
          </Button>
        )}
      </div>

      {isLoading && sortedChapters.length === 0 && (
        <div className={styles.stateMessage}>载入中…</div>
      )}

      {sortedChapters.length === 0 && !isLoading && !editing && (
        <div className={styles.emptyMessage}>
          暂无章节。用 PageDown / PageUp 在章节之间跳转。
        </div>
      )}

      <div className={styles.list}>
        {sortedChapters.map((chapter, idx) => {
          const isInside = frameIndex >= chapter.start_frame && frameIndex <= chapter.end_frame;
          const color = chapter.color ?? defaultChapterColor(idx);
          return (
            <div
              key={chapter.id}
              data-testid="video-chapter-row"
              aria-selected={isInside}
              className={cn(styles.row, isInside && styles.rowActive)}
            >
              <svg className={styles.colorDot} viewBox="0 0 10 10" aria-hidden="true">
                <circle cx="5" cy="5" r="5" fill={color} />
              </svg>
              <button
                type="button"
                onClick={() => onSeekFrame?.(chapter.start_frame)}
                className={styles.chapterButton}
              >
                <b className={styles.chapterTitle}>
                  {idx + 1}. {chapter.title}
                  {chapter.source === "sampled" && (
                    <span className={styles.sampledBadge} title="由采样网格派生">
                      采样
                    </span>
                  )}
                </b>
                <span className={cn("mono", styles.chapterMeta)}>
                  F{chapter.start_frame}–F{chapter.end_frame} · {formatChapterDuration(chapter.start_frame, chapter.end_frame, timebase)}
                  {chapter.frame_step != null && ` · 步长 ${chapter.frame_step}`}
                </span>
              </button>
              {canEdit && (
                <div className={styles.rowActions}>
                  <Button
                    size="sm"
                    className={styles.iconButton}
                    title="编辑章节"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(chapter.id);
                    }}
                  >
                    <Icon name="edit" size={13} />
                  </Button>
                  <Button
                    size="sm"
                    className={cn(styles.iconButton, styles.deleteButton)}
                    title="删除章节"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(chapter.id);
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <div
          data-testid="video-chapter-form"
          className={styles.form}
        >
          <input
            type="text"
            placeholder="章节标题"
            value={editing.title}
            onChange={(e) =>
              setEditing((prev) => (prev ? { ...prev, title: e.target.value } : prev))
            }
            className={styles.textInput}
          />
          <div className={styles.fieldsGrid}>
            <label className={styles.field}>
              起始帧
              <div className={styles.fieldControl}>
                <input
                  type="number"
                  min={0}
                  max={maxFrame}
                  value={editing.startFrame}
                  onChange={(e) =>
                    setEditing((prev) =>
                      prev ? { ...prev, startFrame: Number(e.target.value) } : prev,
                    )
                  }
                  className={styles.numberInput}
                />
                <Button
                  size="sm"
                  className={styles.currentButton}
                  title="使用当前帧"
                  onClick={() =>
                    setEditing((prev) =>
                      prev ? { ...prev, startFrame: frameIndex } : prev,
                    )
                  }
                >
                  当前
                </Button>
              </div>
            </label>
            <label className={styles.field}>
              结束帧
              <div className={styles.fieldControl}>
                <input
                  type="number"
                  min={0}
                  max={maxFrame}
                  value={editing.endFrame}
                  onChange={(e) =>
                    setEditing((prev) =>
                      prev ? { ...prev, endFrame: Number(e.target.value) } : prev,
                    )
                  }
                  className={styles.numberInput}
                />
                <Button
                  size="sm"
                  className={styles.currentButton}
                  title="使用当前帧"
                  onClick={() =>
                    setEditing((prev) =>
                      prev ? { ...prev, endFrame: frameIndex } : prev,
                    )
                  }
                >
                  当前
                </Button>
              </div>
            </label>
          </div>
          <label className={styles.field}>
            颜色
            <div className={styles.palette}>
              {CHAPTER_PALETTE.map((c, idx) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEditing((prev) => (prev ? { ...prev, color: c } : prev))}
                  className={cn(
                    styles.colorSwatch,
                    PALETTE_CLASSES[idx],
                    editing.color === c && styles.colorSwatchSelected,
                  )}
                  aria-label={`color ${c}`}
                />
              ))}
            </div>
          </label>
          {error && (
            <div className={styles.error}>{error}</div>
          )}
          <div className={styles.formActions}>
            <Button size="sm" className={styles.formButton} variant="ghost" onClick={cancelForm}>
              取消
            </Button>
            <Button
              size="sm"
              className={styles.formButton}
              onClick={submitForm}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editing.chapterId ? "保存" : "创建"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function pickChapterTargetFrame(
  chapters: { id: string; start_frame: number; end_frame: number }[],
  currentFrame: number,
  direction: "next" | "prev",
): number | null {
  if (chapters.length === 0) return null;
  const sorted = [...chapters].sort((a, b) => a.start_frame - b.start_frame);
  if (direction === "next") {
    for (const c of sorted) {
      if (c.start_frame > currentFrame) return c.start_frame;
    }
    return null;
  }
  // prev：若处于章节内部（非起点），跳回当前章节起点；否则去上一章
  for (let i = sorted.length - 1; i >= 0; i--) {
    const c = sorted[i];
    if (currentFrame > c.start_frame && currentFrame <= c.end_frame) {
      return c.start_frame;
    }
    if (c.start_frame < currentFrame) return c.start_frame;
  }
  return null;
}

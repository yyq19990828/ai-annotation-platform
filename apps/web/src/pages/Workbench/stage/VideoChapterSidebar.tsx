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

const CHAPTER_PALETTE = [
  "oklch(0.62 0.18 252)",
  "oklch(0.65 0.18 152)",
  "oklch(0.68 0.16 75)",
  "oklch(0.62 0.20 25)",
  "oklch(0.60 0.20 295)",
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
      style={{
        display: "grid",
        gap: 8,
        padding: "10px 12px",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        background: "var(--color-bg-elev)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <b style={{ fontSize: 13 }}>章节</b>
          <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
            {sortedChapters.length}
          </span>
        </div>
        {canEdit && (
          <Button
            size="sm"
            style={{ borderRadius: 8, padding: "4px 8px" }}
            disabled={Boolean(editing)}
            onClick={startCreate}
            title="新建章节"
          >
            <Icon name="plus" size={13} />新建
          </Button>
        )}
      </div>

      {isLoading && sortedChapters.length === 0 && (
        <div style={{ color: "var(--color-fg-muted)", fontSize: 12 }}>载入中…</div>
      )}

      {sortedChapters.length === 0 && !isLoading && !editing && (
        <div style={{ color: "var(--color-fg-muted)", fontSize: 12, lineHeight: 1.6 }}>
          暂无章节。用 PageDown / PageUp 在章节之间跳转。
        </div>
      )}

      <div style={{ display: "grid", gap: 6 }}>
        {sortedChapters.map((chapter, idx) => {
          const isInside = frameIndex >= chapter.start_frame && frameIndex <= chapter.end_frame;
          const color = chapter.color ?? defaultChapterColor(idx);
          return (
            <div
              key={chapter.id}
              data-testid="video-chapter-row"
              aria-selected={isInside}
              style={{
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr) auto",
                gap: 8,
                alignItems: "center",
                padding: "7px 10px",
                border: `1px solid ${isInside ? "var(--color-accent)" : "var(--color-border)"}`,
                borderRadius: 8,
                background: isInside
                  ? "color-mix(in oklab, var(--color-accent) 10%, var(--color-bg-elev))"
                  : "var(--color-bg)",
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 999, background: color }} />
              <button
                type="button"
                onClick={() => onSeekFrame?.(chapter.start_frame)}
                style={{
                  display: "grid",
                  gap: 2,
                  alignItems: "start",
                  textAlign: "left",
                  border: 0,
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--color-fg)",
                  padding: 0,
                  minWidth: 0,
                }}
              >
                <b style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {idx + 1}. {chapter.title}
                </b>
                <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
                  F{chapter.start_frame}–F{chapter.end_frame} · {formatChapterDuration(chapter.start_frame, chapter.end_frame, timebase)}
                </span>
              </button>
              {canEdit && (
                <div style={{ display: "flex", gap: 4 }}>
                  <Button
                    size="sm"
                    style={{ width: 26, height: 26, padding: 0, justifyContent: "center", borderRadius: 8 }}
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
                    style={{ width: 26, height: 26, padding: 0, justifyContent: "center", borderRadius: 8, color: "var(--color-danger)" }}
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
          style={{
            display: "grid",
            gap: 6,
            padding: "8px 10px",
            border: "1px solid var(--color-accent)",
            borderRadius: 8,
            background: "color-mix(in oklab, var(--color-accent) 6%, var(--color-bg-elev))",
          }}
        >
          <input
            type="text"
            placeholder="章节标题"
            value={editing.title}
            onChange={(e) =>
              setEditing((prev) => (prev ? { ...prev, title: e.target.value } : prev))
            }
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              background: "var(--color-bg)",
              color: "var(--color-fg)",
              fontSize: 13,
              padding: "5px 8px",
            }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, alignItems: "center" }}>
            <label style={{ display: "grid", gap: 2, fontSize: 11, color: "var(--color-fg-muted)" }}>
              起始帧
              <div style={{ display: "flex", gap: 4 }}>
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
                  style={{
                    flex: 1,
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    background: "var(--color-bg)",
                    color: "var(--color-fg)",
                    fontSize: 12,
                    padding: "4px 6px",
                  }}
                />
                <Button
                  size="sm"
                  style={{ borderRadius: 6, padding: "0 6px" }}
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
            <label style={{ display: "grid", gap: 2, fontSize: 11, color: "var(--color-fg-muted)" }}>
              结束帧
              <div style={{ display: "flex", gap: 4 }}>
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
                  style={{
                    flex: 1,
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    background: "var(--color-bg)",
                    color: "var(--color-fg)",
                    fontSize: 12,
                    padding: "4px 6px",
                  }}
                />
                <Button
                  size="sm"
                  style={{ borderRadius: 6, padding: "0 6px" }}
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
          <label style={{ display: "grid", gap: 2, fontSize: 11, color: "var(--color-fg-muted)" }}>
            颜色
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {CHAPTER_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEditing((prev) => (prev ? { ...prev, color: c } : prev))}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    background: c,
                    border:
                      editing.color === c
                        ? "2px solid var(--color-fg)"
                        : "1px solid var(--color-border)",
                    cursor: "pointer",
                  }}
                  aria-label={`color ${c}`}
                />
              ))}
            </div>
          </label>
          {error && (
            <div style={{ color: "var(--color-danger)", fontSize: 11 }}>{error}</div>
          )}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <Button size="sm" style={{ borderRadius: 6 }} variant="ghost" onClick={cancelForm}>
              取消
            </Button>
            <Button
              size="sm"
              style={{ borderRadius: 6 }}
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

/**
 * v0.6.6 · 评论 hover → ImageStage 历史回看叠加。
 *
 * CommentsPanel 中 onMouseEnter 写入 hoveredCanvasDrawing；ImageStage 读
 * historicalShapes，叠加只读半透明笔触。鼠标移开 → 清空 → 叠加层消失。
 */
import { create } from "zustand";
import type { CommentCanvasDrawing } from "@/api/comments";

interface HoveredCommentState {
  shapes: NonNullable<CommentCanvasDrawing["shapes"]> | null;
  setShapes: (shapes: NonNullable<CommentCanvasDrawing["shapes"]> | null) => void;
}

export const useHoveredCommentStore = create<HoveredCommentState>((set) => ({
  shapes: null,
  setShapes: (shapes) => set({ shapes }),
}));

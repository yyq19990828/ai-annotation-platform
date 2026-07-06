/**
 * 视频舞台命令式控制句柄(forwardRef 暴露给工作台热键 / shell)。
 *
 * 与具体渲染实现解耦:由 VideoKonvaStage 实现,经 useImperativeHandle 暴露。
 * (原定义在已删除的旧 SVG VideoStage.tsx,v0.16.5 统一到 Konva 后抽到本文件。)
 */
export interface VideoStageControls {
  togglePlayback: () => void;
  jogPlayback: (dir: -1 | 1) => void;
  pausePlayback: () => void;
  seekByFrames: (delta: number, options?: { recordHistory?: boolean }) => void;
  /** 软网格跳:采样开启时 ←/→ 跳到严格大/小的最近网格点。 */
  seekGrid: (dir: -1 | 1, options?: { recordHistory?: boolean }) => void;
  /** 逃生口:±1 源帧微调 (off-grid)。 */
  microStep: (dir: -1 | 1, options?: { recordHistory?: boolean }) => void;
  seekToKeyframe: (dir: -1 | 1, options?: { recordHistory?: boolean }) => void;
  seekToFrame: (frameIndex: number, options?: { recordHistory?: boolean }) => void;
  toggleBookmark: () => void;
  jumpHistory: (dir: -1 | 1) => void;
  clearLoopRegion: () => void;
  toggleSelectedTrackOutside: () => void;
  toggleSelectedTrackOccluded: () => void;
  toggleSelectedTrackHidden: () => void;
  toggleSelectedTrackLocked: () => void;
  propagateSelectedTrack: () => void;
  deleteSelectedTrackKeyframe: () => boolean;
  /**
   * v0.21.11 · 当前帧「同类流转」(Tab/Shift+Tab): 按当前选中对象所属类别(AI 待审 / 人工 / 轨迹)
   * 在该类当前帧对象里环内循环, 共用 selectedId。无选中时落到当前帧第一个非空类首对象。
   */
  cycleInCategory: (dir: -1 | 1) => void;
  /**
   * v0.21.11 · 当前帧「跨类跳转」(` / Shift+`): 跳到下一/上一非空类的首对象
   * (AI 待审 → 人工 → 轨迹 → 回环)。
   */
  stepCategory: (dir: -1 | 1) => void;
  /**
   * v0.21.4 · 把当前帧解码后的 ImageBitmap 编码成 JPEG Blob(单题 AI 供图路径用)。
   * 当前帧尚未解出位图时返回 null。
   */
  captureCurrentFrameJpeg: (quality?: number) => Promise<Blob | null>;
}

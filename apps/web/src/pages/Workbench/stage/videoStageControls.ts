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
  /**
   * v0.21.23 · 归一化画布坐标 → 屏幕坐标 (fixed 定位)。
   * 视频侧的类选择器 popover 走 fixed anchor (图片侧走 geom + vp 换算, 见 WorkbenchOverlays),
   * 而只有画布持有 containerRect / vp / 视频像素尺寸。返回 null 表示画布尚未挂载。
   */
  normToClient: (pt: { x: number; y: number }) => { left: number; top: number } | null;
  cycleInCategory: (dir: -1 | 1) => void;
  /**
   * v0.21.11 · 当前帧「跨类跳转」(` / Shift+`): 跳到下一/上一非空类的首对象
   * (AI 待审 → 人工 → 轨迹 → 回环)。
   */
  stepCategory: (dir: -1 | 1) => void;
  /**
   * v0.21.11 WS2 · 焦点联动: 把对象平移居中到画布(仅当出视口/过小才动, 保守不打断已在视口的选中)。
   * 键盘两级循环 / 侧栏点选 / 画布点选 统一经选中变化触发。
   */
  focusObject: (id: string) => void;
  /**
   * v0.21.4 · 把当前帧解码后的 ImageBitmap 编码成 JPEG Blob(单题 AI 供图路径用)。
   * 当前帧尚未解出位图时返回 null。
   */
  captureCurrentFrameJpeg: (quality?: number) => Promise<Blob | null>;
}

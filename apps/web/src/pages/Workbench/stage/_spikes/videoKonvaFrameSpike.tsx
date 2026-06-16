/**
 * videoKonvaFrameSpike — v0.16.0「画布栈统一」决策 A 的隔离性能 spike。
 *
 * ⚠️ 非生产路径。不接生产数据、不挂生产路由。验收后(epic 完成)可删。
 *
 * 目的:量化「一帧像素 → Konva.Image → batchDraw」的逐帧合成开销,为决策 A
 *      (A1 帧合成进 Konva vs A2 透明 Konva 盖在 <video> 上)提供闸门数据。
 *      见 docs/plans/2026-06-16-v0.16.0-konva-test-harness-and-stage-primitives.md §3.2
 *      与 docs/plans/2026-06-16-v0.16.x-canvas-unification-epic.md §2 决策 A。
 *
 * 帧源用「合成 canvas」(离屏 canvas 每帧画动图案),刻意不依赖任何视频资产:
 *   - 真实 <video> 的解码开销 A1/A2 都有、可比掉(文档已注明),本 spike 隔离出
 *     A1 相对 A2 的真正差量 —— 即「把一帧像素灌进 Konva.Image 并 batchDraw」的成本。
 *
 * 两种布局对照(A1 成败关键变量):
 *   - 分层:视频帧在独立 Layer,标注 Rect 在另一 Layer;动画循环只重绘视频层。
 *   - 单层混画:视频帧 + 标注 Rect 同一 Layer,每帧整层重绘。
 *
 * 用法:不挂路由也能跑。挂载说明见
 *   docs/plans/_spike-results/2026-06-16-video-konva-frame-perf.md「如何挂载运行」。
 */
/* eslint-disable no-restricted-syntax -- 一次性 dev-only perf spike:调试控制面板用内联
   style 即可,无需为验收后即删的非生产组件建 CSS module。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Stage, Layer, Image as KonvaImage, Rect } from "react-konva";
import type Konva from "konva";

type ResolutionKey = "720p" | "1080p" | "4K";
type Layout = "layered" | "single";

const RESOLUTIONS: Record<ResolutionKey, { w: number; h: number }> = {
  "720p": { w: 1280, h: 720 },
  "1080p": { w: 1920, h: 1080 },
  "4K": { w: 3840, h: 2160 },
};

interface MatrixConfig {
  resolution: ResolutionKey;
  fpsTarget: number;
  boxCount: number;
  layout: Layout;
}

/** 全矩阵:{720p,1080p,4K} × {30,60} × {0,20框} × {分层,单层} = 24 格。
 *  「运行全矩阵」按钮自动顺序跑完,每格自动采样后冻结并把结果累积到 window.__spikeMatrix。 */
const MATRIX_CONFIGS: MatrixConfig[] = (() => {
  const out: MatrixConfig[] = [];
  for (const resolution of ["720p", "1080p", "4K"] as ResolutionKey[])
    for (const fpsTarget of [30, 60])
      for (const boxCount of [0, 20])
        for (const layout of ["layered", "single"] as Layout[])
          out.push({ resolution, fpsTarget, boxCount, layout });
  return out;
})();

/** 批处理每格自动采样秒数。 */
const MATRIX_SECONDS = 5;

/** 舞台显示尺寸(视频帧无论分辨率多大都缩放进这个视口绘制,贴合真实工作台)。 */
const STAGE_W = 960;
const STAGE_H = 540;

/** 实时统计窗口:最近 N 帧 batchDraw 耗时样本。 */
const SAMPLE_WINDOW = 180;

interface SpikeStats {
  /** 配置摘要,便于截图/自动化区分跑的是哪一格。 */
  config: {
    resolution: ResolutionKey;
    fpsTarget: number;
    boxCount: number;
    layout: Layout;
  };
  /** 单帧 batchDraw 耗时(ms)。 */
  frameMs: { mean: number; p95: number; max: number };
  /** 实际达成帧率与掉帧率。 */
  achievedFps: number;
  dropRate: number;
  /** 采样帧数 / 运行时长(s)。 */
  frames: number;
  elapsedSec: number;
  /** 是否已冻结(自动采样模式跑完)。 */
  frozen: boolean;
}

declare global {
  var __spikeStats: SpikeStats | undefined;
  var __spikeMatrix: SpikeStats[] | undefined;
  var __spikeMatrixDone: boolean | undefined;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * 造一个离屏 canvas 作为「视频帧源」。每帧调用 draw(t) 重画一个会动的图案
 * (移动渐变 + 噪声块),模拟视频帧的全画面像素变化 —— 这是逐帧 batchDraw
 * 必须重新上传整张纹理的最坏情况,正是决策 A 关心的合成开销。
 */
function useSyntheticFrameSource(w: number, h: number) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  if (canvasRef.current === null || canvasRef.current.width !== w || canvasRef.current.height !== h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    canvasRef.current = c;
  }
  const canvas = canvasRef.current;
  const ctx = useMemo(() => canvas.getContext("2d"), [canvas]);

  const draw = useCallback(
    (t: number) => {
      if (!ctx) return;
      // 移动渐变:相位随时间漂移,保证每帧像素都变(避免被 GPU 当静态纹理跳过)。
      const phase = (t / 1000) % 1;
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, `hsl(${(phase * 360) | 0}, 70%, 45%)`);
      grad.addColorStop(1, `hsl(${((phase * 360 + 120) | 0) % 360}, 70%, 25%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      // 噪声块:一排随时间平移的方块,制造高频局部变化。
      const block = Math.max(24, (w / 32) | 0);
      const offset = (t / 8) % (block * 2);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      for (let y = 0; y < h; y += block * 2) {
        for (let x = -block * 2; x < w; x += block * 2) {
          ctx.fillRect(x + offset, y, block, block);
        }
      }
    },
    [ctx, w, h]
  );

  return { canvas, draw };
}

/** 在视口内均匀铺 n 个标注框的几何(屏幕坐标,直接喂 Konva Rect)。 */
function makeBoxes(n: number): { x: number; y: number; w: number; h: number }[] {
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cw = STAGE_W / cols;
  const ch = STAGE_H / rows;
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    boxes.push({ x: c * cw + cw * 0.12, y: r * ch + ch * 0.12, w: cw * 0.76, h: ch * 0.76 });
  }
  return boxes;
}

export default function VideoKonvaFrameSpike() {
  const [resolution, setResolution] = useState<ResolutionKey>("1080p");
  const [fpsTarget, setFpsTarget] = useState(30);
  const [boxCount, setBoxCount] = useState(0);
  const [layout, setLayout] = useState<Layout>("layered");
  const [running, setRunning] = useState(false);
  /** 自动采样模式:跑 autoSeconds 秒后冻结结果。0 = 手动(开始/停止)。 */
  const [autoSeconds, setAutoSeconds] = useState(0);

  const [stats, setStats] = useState<SpikeStats | null>(null);

  /** 批处理:正在跑的矩阵格子下标,null = 未跑矩阵。ref 供 stop 闭包读取避免 stale。 */
  const [matrixIdx, setMatrixIdx] = useState<number | null>(null);
  const matrixIdxRef = useRef<number | null>(null);
  matrixIdxRef.current = matrixIdx;

  const { w, h } = RESOLUTIONS[resolution];
  const { canvas, draw } = useSyntheticFrameSource(w, h);
  const boxes = useMemo(() => makeBoxes(boxCount), [boxCount]);

  // 视频帧的 Konva.Image ref + 它所在层 ref。分层时只重绘 videoLayer;
  // 单层时视频帧与标注同在一层,重绘 videoLayer 即整层。
  const imageRef = useRef<Konva.Image>(null);
  const videoLayerRef = useRef<Konva.Layer>(null);

  const rafRef = useRef<number | null>(null);
  const samplesRef = useRef<number[]>([]);
  const lastFrameTsRef = useRef<number>(0);
  const startTsRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const droppedRef = useRef<number>(0);

  const computeStats = useCallback(
    (frozen: boolean): SpikeStats => {
      const sorted = [...samplesRef.current].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, v) => acc + v, 0);
      const elapsedSec = (performance.now() - startTsRef.current) / 1000;
      const frames = frameCountRef.current;
      return {
        config: { resolution, fpsTarget, boxCount, layout },
        frameMs: {
          mean: sorted.length ? sum / sorted.length : 0,
          p95: percentile(sorted, 95),
          max: sorted.length ? sorted[sorted.length - 1] : 0,
        },
        achievedFps: elapsedSec > 0 ? frames / elapsedSec : 0,
        dropRate: frames + droppedRef.current > 0 ? droppedRef.current / (frames + droppedRef.current) : 0,
        frames,
        elapsedSec,
        frozen,
      };
    },
    [resolution, fpsTarget, boxCount, layout]
  );

  const stop = useCallback(
    (frozen: boolean) => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setRunning(false);
      const s = computeStats(frozen);
      window.__spikeStats = s;
      setStats(s);
      // 批处理:本格自动采样结束(frozen)→ 记录结果并推进到下一格;最后一格收尾置 done。
      const mi = matrixIdxRef.current;
      if (frozen && mi !== null) {
        window.__spikeMatrix = [...(window.__spikeMatrix ?? []), s];
        const next = mi + 1;
        if (next < MATRIX_CONFIGS.length) {
          setMatrixIdx(next);
        } else {
          setMatrixIdx(null);
          window.__spikeMatrixDone = true;
        }
      }
    },
    [computeStats]
  );

  // 批处理驱动:matrixIdx 变化 → 应用该格配置 + 开 5s 自动采样。配置 setState 先刷新
  // (canvas 在 render 期按新分辨率同步重建),延一拍再开跑确保新源就绪。
  useEffect(() => {
    if (matrixIdx === null) return;
    const cfg = MATRIX_CONFIGS[matrixIdx];
    setResolution(cfg.resolution);
    setFpsTarget(cfg.fpsTarget);
    setBoxCount(cfg.boxCount);
    setLayout(cfg.layout);
    setAutoSeconds(MATRIX_SECONDS);
    setStats(null);
    const id = window.setTimeout(() => setRunning(true), 120);
    return () => window.clearTimeout(id);
  }, [matrixIdx]);

  // 动画循环。每帧:重画合成帧源 → 触发 Konva.Image 重读 source → 同步 draw(),
  // 用 performance.now() 夹住 draw() 测单帧整帧合成耗时(见下方 draw() 处说明)。
  useEffect(() => {
    if (!running) return;
    const minInterval = 1000 / fpsTarget;
    samplesRef.current = [];
    frameCountRef.current = 0;
    droppedRef.current = 0;
    startTsRef.current = performance.now();
    lastFrameTsRef.current = performance.now();

    const tick = (now: number) => {
      const sinceLast = now - lastFrameTsRef.current;
      // 节流到目标帧率:未到间隔则跳过(不计帧,也不算掉帧)。
      if (sinceLast < minInterval - 1) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      // 掉帧检测:实际间隔超过 1.5× 目标间隔,视为掉了若干帧。
      if (lastFrameTsRef.current > 0 && sinceLast > minInterval * 1.5) {
        droppedRef.current += Math.round(sinceLast / minInterval) - 1;
      }
      lastFrameTsRef.current = now;

      draw(now);
      const img = imageRef.current;
      const layer = videoLayerRef.current;
      if (img && layer) {
        const t0 = performance.now();
        // Konva.Image 的 image 已指向同一 canvas;重画 canvas 后需让 Konva 重读纹理。
        img.image(canvas);
        // 用同步 draw() 而非 batchDraw():batchDraw 把实际光栅化合批到下一 rAF 且会
        // 合并多次调用,同步计时只能量到调度调用(≈0ms),量不到真实整帧合成开销。
        // draw() 立即执行 Konva.Image 的 drawImage(全帧纹理上传+缩放)+ 标注绘制,
        // 正是决策 A 关心的「播放时每帧重绘视频层」的单帧成本。
        layer.draw();
        const dt = performance.now() - t0;
        const buf = samplesRef.current;
        buf.push(dt);
        if (buf.length > SAMPLE_WINDOW) buf.shift();
        frameCountRef.current += 1;

        // 实时挂 window.__spikeStats(便于自动化读取)+ 每 ~10 帧刷新一次面板。
        if (frameCountRef.current % 10 === 0) {
          const s = computeStats(false);
          window.__spikeStats = s;
          setStats(s);
        }
      }

      if (autoSeconds > 0 && (now - startTsRef.current) / 1000 >= autoSeconds) {
        stop(true);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [running, fpsTarget, autoSeconds, draw, canvas, computeStats, stop]);

  const boxRects = boxes.map((b, i) => (
    <Rect
      key={i}
      x={b.x}
      y={b.y}
      width={b.w}
      height={b.h}
      stroke="#10b981"
      strokeWidth={1.5}
      listening={false}
    />
  ));

  return (
    <div style={{ padding: 16, fontFamily: "ui-monospace, monospace", color: "#e5e7eb", background: "#0b0f17", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 16, margin: "0 0 4px" }}>Konva 视频帧合成 perf spike (决策 A · 非生产)</h1>
      <p style={{ fontSize: 12, opacity: 0.7, margin: "0 0 12px" }}>
        合成 canvas 帧源 → Konva.Image → batchDraw。隔离 A1 相对 A2 的逐帧合成差量(真实 video 解码开销两方案都有,已比掉)。
      </p>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 12, fontSize: 13 }}>
        <label>
          分辨率{" "}
          <select value={resolution} onChange={(e) => setResolution(e.target.value as ResolutionKey)} disabled={running}>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="4K">4K</option>
          </select>
        </label>
        <label>
          帧率{" "}
          <select value={fpsTarget} onChange={(e) => setFpsTarget(Number(e.target.value))} disabled={running}>
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </label>
        <label>
          标注框{" "}
          <select value={boxCount} onChange={(e) => setBoxCount(Number(e.target.value))} disabled={running}>
            <option value={0}>0</option>
            <option value={20}>20</option>
          </select>
        </label>
        <label>
          布局{" "}
          <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)} disabled={running}>
            <option value="layered">分层</option>
            <option value="single">单层混画</option>
          </select>
        </label>
        <label>
          自动采样(秒){" "}
          <select value={autoSeconds} onChange={(e) => setAutoSeconds(Number(e.target.value))} disabled={running}>
            <option value={0}>手动</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
          </select>
        </label>
        {!running ? (
          <button onClick={() => { setStats(null); setRunning(true); }} disabled={matrixIdx !== null}>开始</button>
        ) : (
          <button onClick={() => stop(false)}>停止</button>
        )}
        <button
          onClick={() => {
            window.__spikeMatrix = [];
            window.__spikeMatrixDone = false;
            setMatrixIdx(0);
          }}
          disabled={running || matrixIdx !== null}
        >
          运行全矩阵({MATRIX_CONFIGS.length})
        </button>
        {matrixIdx !== null && (
          <span style={{ fontWeight: 700 }}>
            矩阵 {matrixIdx + 1}/{MATRIX_CONFIGS.length}:{MATRIX_CONFIGS[matrixIdx].resolution}@
            {MATRIX_CONFIGS[matrixIdx].fpsTarget} · {MATRIX_CONFIGS[matrixIdx].boxCount}框 ·{" "}
            {MATRIX_CONFIGS[matrixIdx].layout === "layered" ? "分层" : "单层"}…
          </span>
        )}
      </div>

      <StatsPanel stats={stats} />

      <div style={{ marginTop: 12, border: "1px solid #1f2937", display: "inline-block", lineHeight: 0 }}>
        <Stage width={STAGE_W} height={STAGE_H}>
          {/* 视频帧层:始终承载 Konva.Image。分层模式下它独占一层。 */}
          <Layer ref={videoLayerRef} listening={false}>
            <KonvaImage ref={imageRef} image={canvas} width={STAGE_W} height={STAGE_H} />
            {/* 单层混画:标注 Rect 与视频帧同层(每帧整层 batchDraw)。 */}
            {layout === "single" ? boxRects : null}
          </Layer>
          {/* 分层:标注独占一层,动画循环不重绘它(静止)。 */}
          {layout === "layered" ? <Layer listening={false}>{boxRects}</Layer> : null}
        </Stage>
      </div>
    </div>
  );
}

function StatsPanel({ stats }: { stats: SpikeStats | null }) {
  if (!stats) {
    return <div style={{ fontSize: 13, opacity: 0.6 }}>未运行。点「开始」采样;数字会实时显示并挂到 window.__spikeStats。</div>;
  }
  const fmt = (n: number) => n.toFixed(2);
  const cell: CSSProperties = { padding: "2px 12px 2px 0" };
  return (
    <div style={{ fontSize: 13, border: "1px solid #1f2937", padding: 10, borderRadius: 6, background: "#111827", display: "inline-block" }}>
      <div style={{ marginBottom: 6, opacity: 0.8 }}>
        {stats.config.resolution} @ {stats.config.fpsTarget}fps · {stats.config.boxCount} 框 ·{" "}
        {stats.config.layout === "layered" ? "分层" : "单层混画"}
        {stats.frozen ? "  [已冻结]" : ""}
      </div>
      <table style={{ borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={cell}>单帧 batchDraw 均值</td>
            <td style={{ ...cell, fontWeight: 700 }}>{fmt(stats.frameMs.mean)} ms</td>
            <td style={cell}>p95</td>
            <td style={{ ...cell, fontWeight: 700 }}>{fmt(stats.frameMs.p95)} ms</td>
            <td style={cell}>max</td>
            <td style={{ ...cell, fontWeight: 700 }}>{fmt(stats.frameMs.max)} ms</td>
          </tr>
          <tr>
            <td style={cell}>达成帧率</td>
            <td style={{ ...cell, fontWeight: 700 }}>{fmt(stats.achievedFps)} fps</td>
            <td style={cell}>掉帧率</td>
            <td style={{ ...cell, fontWeight: 700 }}>{(stats.dropRate * 100).toFixed(1)} %</td>
            <td style={cell}>采样帧</td>
            <td style={{ ...cell, fontWeight: 700 }}>{stats.frames}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

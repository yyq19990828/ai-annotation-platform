/**
 * M3 · video → GIF/WebM 转换流水线。
 *
 * 依赖：ffmpeg（系统路径 or 环境变量 FFMPEG_PATH）。
 * 没有 ffmpeg 时跳过 GIF 转换并打印警告。
 *
 * 使用方式（flows.spec.ts 内部调用）：
 *   const cleanup = await startRecording(page, context, { fps: 10, width: 1280, height: 720 });
 *   await doInteractions(page);
 *   const videoPath = await cleanup();               // .webm 路径
 *   await convertToGif(videoPath, "outputs/flows/e2e-quickstart.gif", { fps: 10, maxWidth: 1280 });
 */
import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import type { BrowserContext } from "@playwright/test";

export interface RecordOptions {
  fps?: number;
  width?: number;
  height?: number;
}

export interface ConvertOptions {
  fps?: number;
  maxWidth?: number;
  /** 裁剪起点（秒）：跳过录屏开头的准备动作（加载 / 隐藏预测 / 选工具）。 */
  startSec?: number;
  /** 裁剪时长（秒）：只保留这段（如绘制过程），裁掉结尾的清理动作。 */
  durationSec?: number;
}

export interface WebmOptions extends ConvertOptions {
  /** 从转码后视频的第几秒抽取首页静态海报。 */
  posterAtSec?: number;
  /** WebM 同步产出的静态海报路径（WebP）。 */
  posterPath?: string;
}

/** 检测 ffmpeg 是否可用；返回路径或 null。 */
export function detectFfmpeg(): string | null {
  const env = process.env.FFMPEG_PATH;
  if (env && fs.existsSync(env)) return env;
  try {
    const result = execSync("which ffmpeg 2>/dev/null || where ffmpeg 2>/dev/null", {
      encoding: "utf8",
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * video 录制由 Playwright 的 `context.newPage()` 时自动开启（需在 project 里设置 video:on）。
 * 此函数在 flows spec 跑完交互后，从 context 取出 video 路径。
 */
export async function getVideoPath(context: BrowserContext): Promise<string | null> {
  const pages = context.pages();
  if (pages.length === 0) return null;
  const video = pages[0].video();
  if (!video) return null;
  return video.path();
}

/**
 * 用 ffmpeg 把 .webm 转成 GIF。
 * 采用两遍法（生成调色板 → 渲染），体积最小、质量最优。
 */
export async function convertToGif(
  inputPath: string,
  outputPath: string,
  opts: ConvertOptions = {},
): Promise<void> {
  const ffmpeg = detectFfmpeg();
  if (!ffmpeg) {
    console.warn(
      `[recorder] ffmpeg 不可用，跳过 GIF 转换。\n` +
        `  输入：${inputPath}\n` +
        `  可设置 FFMPEG_PATH 环境变量指向 ffmpeg 可执行文件。`,
    );
    return;
  }

  const fps = opts.fps ?? 10;
  const maxWidth = opts.maxWidth ?? 1280;
  const palettePath = outputPath.replace(/\.gif$/, ".palette.png");

  // 裁剪参数（-ss 起点 / -t 时长，放在 -i 前做快速 seek，两遍一致）
  const trim: string[] = [];
  if (opts.startSec && opts.startSec > 0) trim.push("-ss", String(opts.startSec));
  if (opts.durationSec && opts.durationSec > 0) trim.push("-t", String(opts.durationSec));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // 第一遍：生成调色板
  const pass1 = spawnSync(
    ffmpeg,
    [
      "-y",
      ...trim,
      "-i",
      inputPath,
      "-vf",
      `fps=${fps},scale=${maxWidth}:-1:flags=lanczos,palettegen`,
      palettePath,
    ],
    { encoding: "utf8" },
  );

  if (pass1.status !== 0) {
    throw new Error(`ffmpeg 调色板生成失败:\n${pass1.stderr}`);
  }

  // 第二遍：渲染 GIF
  const pass2 = spawnSync(
    ffmpeg,
    [
      "-y",
      ...trim,
      "-i",
      inputPath,
      "-i",
      palettePath,
      "-lavfi",
      `fps=${fps},scale=${maxWidth}:-1:flags=lanczos[x];[x][1:v]paletteuse`,
      outputPath,
    ],
    { encoding: "utf8" },
  );

  if (pass2.status !== 0) {
    throw new Error(`ffmpeg GIF 渲染失败:\n${pass2.stderr}`);
  }

  // 清理调色板临时文件
  fs.rmSync(palettePath, { force: true });

  const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
  console.log(`[recorder] ✓ GIF 产出：${outputPath} (${sizeMB} MB)`);

  if (parseFloat(sizeMB) > 5) {
    console.warn(`[recorder] ⚠ GIF 超过 5MB，建议降低 fps 或 maxWidth`);
  }
}

/**
 * 把 .webm 转成 WebM（仅改容器，不重新编码，速度极快）。
 * 用于直接在文档站嵌入 <video> 标签。
 */
export async function copyAsWebm(inputPath: string, outputPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.copyFileSync(inputPath, outputPath);
  const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
  console.log(`[recorder] ✓ WebM 复制：${outputPath} (${sizeMB} MB)`);
}

/**
 * 裁剪并压缩首页使用的 WebM，同时可抽取一张静态 WebP 海报。
 * 首页媒体保持 16:9 全界面证据；移动端与 reduced-motion 只加载海报。
 */
export async function convertToWebm(
  inputPath: string,
  outputPath: string,
  opts: WebmOptions = {},
): Promise<void> {
  const ffmpeg = detectFfmpeg();
  if (!ffmpeg) {
    throw new Error("[recorder] ffmpeg 不可用，无法生成首页 WebM");
  }

  const fps = opts.fps ?? 12;
  const maxWidth = opts.maxWidth ?? 960;
  const trim: string[] = [];
  if (opts.startSec && opts.startSec > 0) trim.push("-ss", String(opts.startSec));
  if (opts.durationSec && opts.durationSec > 0) trim.push("-t", String(opts.durationSec));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const video = spawnSync(
    ffmpeg,
    [
      "-y",
      ...trim,
      "-i",
      inputPath,
      "-an",
      "-vf",
      `fps=${fps},scale=${maxWidth}:-2:flags=lanczos`,
      "-c:v",
      "libvpx-vp9",
      "-crf",
      "34",
      "-b:v",
      "0",
      "-deadline",
      "good",
      "-cpu-used",
      "2",
      "-row-mt",
      "1",
      outputPath,
    ],
    { encoding: "utf8" },
  );
  if (video.status !== 0) {
    throw new Error(`ffmpeg WebM 转码失败:\n${video.stderr}`);
  }

  if (opts.posterPath) {
    fs.mkdirSync(path.dirname(opts.posterPath), { recursive: true });
    const poster = spawnSync(
      ffmpeg,
      [
        "-y",
        "-ss",
        String(opts.posterAtSec ?? 2.5),
        "-i",
        outputPath,
        "-frames:v",
        "1",
        "-c:v",
        "libwebp",
        "-quality",
        "84",
        opts.posterPath,
      ],
      { encoding: "utf8" },
    );
    if (poster.status !== 0) {
      throw new Error(`ffmpeg 首页海报抽帧失败:\n${poster.stderr}`);
    }
  }

  const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
  console.log(`[recorder] ✓ 首页 WebM：${outputPath} (${sizeMB} MB)`);
}

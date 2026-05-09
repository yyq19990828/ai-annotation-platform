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

  const fps      = opts.fps      ?? 10;
  const maxWidth = opts.maxWidth ?? 1280;
  const palettePath = outputPath.replace(/\.gif$/, ".palette.png");

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // 第一遍：生成调色板
  const pass1 = spawnSync(ffmpeg, [
    "-y", "-i", inputPath,
    "-vf", `fps=${fps},scale=${maxWidth}:-1:flags=lanczos,palettegen`,
    palettePath,
  ], { encoding: "utf8" });

  if (pass1.status !== 0) {
    throw new Error(`ffmpeg 调色板生成失败:\n${pass1.stderr}`);
  }

  // 第二遍：渲染 GIF
  const pass2 = spawnSync(ffmpeg, [
    "-y", "-i", inputPath, "-i", palettePath,
    "-lavfi", `fps=${fps},scale=${maxWidth}:-1:flags=lanczos[x];[x][1:v]paletteuse`,
    outputPath,
  ], { encoding: "utf8" });

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

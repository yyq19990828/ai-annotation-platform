import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function ensureMacCaptureHelper(repoRoot) {
  if (process.platform !== "darwin") throw new Error("ScreenCaptureKit requires macOS.");
  const source = path.join(repoRoot, "apps/web/scripts/mac-marketing-capture.swift");
  const compiler = execFileSync("xcrun", ["swiftc", "--version"], { encoding: "utf8" });
  const sdk = execFileSync("xcrun", ["--show-sdk-version"], { encoding: "utf8" });
  const hash = createHash("sha256")
    .update(fs.readFileSync(source))
    .update(compiler)
    .update(sdk)
    .update(process.arch)
    .digest("hex")
    .slice(0, 20);
  const directory = path.join(repoRoot, ".artifacts/marketing/.native", hash);
  const target = path.join(directory, "mac-marketing-capture");
  if (!fs.existsSync(target)) {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${target}.${randomUUID()}`;
    try {
      execFileSync("xcrun", ["swiftc", "-parse-as-library", "-O", source, "-o", temporary], {
        stdio: "pipe",
        timeout: 120_000,
      });
      fs.renameSync(temporary, target);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  return target;
}

export function macCaptureReady(message, expected) {
  if (
    message?.event !== "ready" ||
    !Number.isFinite(message.first_frame_epoch_ms) ||
    message.first_frame_epoch_ms <= 0 ||
    message.window_id !== expected.window_id ||
    message.pid !== expected.pid ||
    message.width !== expected.width ||
    message.height !== expected.height
  )
    throw new Error("Invalid ScreenCaptureKit first-frame identity or geometry.");
  return message.first_frame_epoch_ms;
}

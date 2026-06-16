// 共享:生成文档的写入 / 校验。
//   - 默认(写)模式:把 content 写到 dst。
//   - --check 模式:比对 dst 现有内容,不一致(或文件缺失)即退出码 1,
//     让"源已改但忘了重新生成"的漂移在 CI / check:all 被拦住。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** @param {{dst:string, content:string, label:string, detail?:string}} opts */
export function emitGenerated({ dst, content, label, detail }) {
  const check = process.argv.includes("--check");
  if (check) {
    let current = null;
    try {
      current = readFileSync(dst, "utf8");
    } catch {
      /* 文件缺失视为漂移 */
    }
    if (current !== content) {
      console.error(
        `[${label}] ✗ ${dst} 与源不一致——源已改但未重新生成。\n` +
          `  运行 \`pnpm docs:gen\`(或对应 generate 脚本)后把生成文件一并提交。`,
      );
      process.exit(1);
    }
    console.log(`[${label}] ✓ 已与源同步${detail ? ` (${detail})` : ""}`);
    return;
  }
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, content);
  console.log(`[${label}] wrote${detail ? ` ${detail}` : ""} → ${dst}`);
}

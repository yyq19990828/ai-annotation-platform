/**
 * v0.18.15 · 受限树形流水线只读 ASCII 摘要条.
 *
 * 把 stagesGraph ({sid, parentSid}) + 各卡派生 payload 渲染成一棵缩进树, 让用户一眼看清
 * 「检测(源) → 子阶段 → 孙阶段」的层级与每阶段产物 (检测 / 分割 / 分类 + 命名/写回键)。
 * 纯展示, 不持状态。父号由容器按数组顺序分配 (root=源)。
 */

import type { PipelineStagePayload } from "@/hooks/usePreannotation";
import styles from "./ProjectDetailPanel.module.css";

interface Entry {
  sid: string;
  parentSid: string;
}

function nodeLabel(p: PipelineStagePayload | null): string {
  if (!p) return "（未就绪）";
  const target = p.write?.target ?? "attributes";
  if (target === "geometry" || target === "intermediate") {
    const role = p.input?.mode === "crop" ? "检测" : "分割";
    const ns = p.label ? ` [${p.label}]` : "";
    return `${role}${ns}（${p.model_id ?? "?"}）`;
  }
  const keys = p.write?.keys ?? [];
  const prefix = p.label ? `${p.label}_` : "";
  const detail = keys.length > 0 ? keys.map((k) => prefix + k).join(", ") : "全部属性";
  return `分类 → ${detail}`;
}

export function StageGraphSummary({
  stagesGraph,
  payloads,
}: {
  stagesGraph: Entry[];
  payloads: Array<PipelineStagePayload | null>;
}) {
  if (stagesGraph.length === 0) return null;

  const payloadBySid = new Map<string, PipelineStagePayload | null>();
  stagesGraph.forEach((e, i) => payloadBySid.set(e.sid, payloads[i] ?? null));
  const childrenOf = (parentSid: string) =>
    stagesGraph.filter((e) => e.parentSid === parentSid);

  const lines: string[] = ["检测(源)"];
  const walk = (parentSid: string, prefix: string) => {
    const kids = childrenOf(parentSid);
    kids.forEach((e, idx) => {
      const last = idx === kids.length - 1;
      lines.push(`${prefix}${last ? "└─ " : "├─ "}${nodeLabel(payloadBySid.get(e.sid) ?? null)}`);
      walk(e.sid, prefix + (last ? "   " : "│  "));
    });
  };
  walk("root", "");

  return <pre className={styles.stageGraphSummary}>{lines.join("\n")}</pre>;
}

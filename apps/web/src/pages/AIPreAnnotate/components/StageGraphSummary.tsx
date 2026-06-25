/**
 * v0.18.15 · 受限树形流水线只读结构摘要.
 *
 * 把 stagesGraph ({sid, parentSid}) + 各卡派生 payload 渲染成一棵可视化树: 每个阶段为一枚带
 * 角色徽标 (检测 / 分割 / 分类) 的节点 chip, 父子用 CSS 引导线 (竖线 + 肘形) 连接, 让用户一眼
 * 看清「检测(源) → 子 → 孙」的层级与每阶段产物 (子物体命名 / 写回键)。纯展示, 不持状态。
 */

import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import type { PipelineStagePayload } from "@/hooks/usePreannotation";
import styles from "./ProjectDetailPanel.module.css";

interface Entry {
  sid: string;
  parentSid: string;
}

type Role = {
  label: string;
  variant: "accent" | "ai" | "success";
  icon: "box" | "sparkles" | "tag";
};

function roleOf(p: PipelineStagePayload | null): Role {
  const target = p?.write?.target ?? "attributes";
  if (target === "geometry" || target === "intermediate") {
    // crop-detect (input.mode=crop) = 检测子物体; 否则 box-seg = 分割。
    return p?.input?.mode === "crop"
      ? { label: "检测", variant: "accent", icon: "box" }
      : { label: "分割", variant: "ai", icon: "sparkles" };
  }
  return { label: "分类", variant: "success", icon: "tag" };
}

function detailOf(p: PipelineStagePayload | null): string {
  if (!p) return "未就绪";
  const target = p.write?.target ?? "attributes";
  if (target === "geometry" || target === "intermediate") {
    return (p.label ? `${p.label} · ` : "") + (p.model_id ?? "");
  }
  const keys = p.write?.keys ?? [];
  const prefix = p.label ? `${p.label}_` : "";
  return keys.length > 0 ? keys.map((k) => prefix + k).join(", ") : "全部属性";
}

function StageNode({ payload }: { payload: PipelineStagePayload | null }) {
  const role = roleOf(payload);
  return (
    <div className={styles.stageNode}>
      <Icon name={role.icon} size={12} className={styles.stageNodeIcon} />
      <Badge variant={role.variant}>{role.label}</Badge>
      <span className={styles.stageNodeDetail}>{detailOf(payload)}</span>
    </div>
  );
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

  const renderChildren = (parentSid: string) => {
    const kids = childrenOf(parentSid);
    if (kids.length === 0) return null;
    return (
      <div className={styles.stageTreeChildren}>
        {kids.map((e) => (
          <div key={e.sid} className={styles.stageTreeBranch}>
            <StageNode payload={payloadBySid.get(e.sid) ?? null} />
            {renderChildren(e.sid)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={styles.stageTree}>
      <div className={styles.stageNode}>
        <Icon name="scan" size={12} className={styles.stageNodeIcon} />
        <Badge variant="outline">源</Badge>
        <span className={styles.stageNodeName}>检测</span>
      </div>
      {renderChildren("root")}
    </div>
  );
}

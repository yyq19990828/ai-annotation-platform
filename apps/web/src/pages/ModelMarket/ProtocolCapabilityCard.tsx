// v0.14.11 · 协议能力卡片 — 一张卡 = 一个协议 task; 卡内挂载已注册 backend 的 model.
// 与 ModelCard (CapabilityCatalogPanel 内) 的区别: 概览化, 只显示 name + task/infra badge
// + backend 来源, 不展开 variants / resource / output_attribute_types. 用户想看完整细节
// 切到 groupBy=backend 模式即可。

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { MLModelCapability } from "@/api/ml-backends";
import type { ProtocolTask } from "@/api/mlCapabilities";
import styles from "./ProtocolCapabilityCard.module.css";

// 与 CapabilityCatalogPanel 共用的扁平 model 视图; 这里只读 model + 来源信息.
export interface MountedModel {
  model: MLModelCapability;
  backendName: string;
  projectName: string;
  backendInfra?: string;
  stale: boolean;
}

interface Props {
  task: ProtocolTask;
  mounted: MountedModel[];
  /** 中文 infra label (复用 panel 内 INFRA_LABELS, 通过 props 注入避免循环依赖). */
  infraLabel: (infra: string) => string;
  /** 中文 modality label. */
  modalityLabel: (modality: string) => string;
  /** 点 「去注册」按钮的回调 (跳 ?tab=registry). */
  onGoToRegistry?: () => void;
}

function taskVariant(taskId: string): "accent" | "ai" | "success" | "warning" | "outline" {
  if (taskId === "detection" || taskId === "obb") return "accent";
  if (taskId === "segmentation" || taskId === "interactive_seg") return "ai";
  if (taskId === "keypoint" || taskId === "classification") return "success";
  if (taskId === "ocr" || taskId === "doc_layout") return "warning";
  return "outline";
}

export function ProtocolCapabilityCard({
  task,
  mounted,
  infraLabel,
  modalityLabel,
  onGoToRegistry,
}: Props) {
  const empty = mounted.length === 0;

  return (
    <div className={empty ? `${styles.card} ${styles.cardEmpty}` : styles.card}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <h3 className={styles.title}>{task.label}</h3>
          <span className={styles.taskId}>{task.id}</span>
        </div>
        <div className={styles.badges}>
          <Badge variant={taskVariant(task.id)}>{task.label}</Badge>
          {task.default_modalities.map((m) => (
            <Badge key={m} variant="default">
              {modalityLabel(m)}
            </Badge>
          ))}
          {task.default_geometry.map((g) => (
            <Badge key={g} variant="outline">
              {g}
            </Badge>
          ))}
          {empty ? (
            <Badge variant="outline">暂无接入</Badge>
          ) : (
            <Badge variant="success">{mounted.length} 个模型已接入</Badge>
          )}
        </div>
      </div>

      <p className={styles.summary}>{task.summary}</p>

      {!empty && (
        <div className={styles.modelGrid}>
          {mounted.map(({ model, backendName, projectName, backendInfra, stale }) => {
            const infra = model.infra ?? backendInfra;
            return (
              <div key={`${backendName}:${model.id}`} className={styles.modelMini}>
                <div className={styles.modelMiniName} title={model.display_name ?? model.id}>
                  {model.display_name ?? model.id}
                </div>
                <div className={styles.modelMiniMeta}>
                  {infra && <span>{infraLabel(infra)}</span>}
                  {model.is_interactive && <span>· 交互式</span>}
                  {stale && <Badge variant="warning">缓存</Badge>}
                </div>
                <div className={styles.modelMiniSource} title={`${projectName} · ${backendName}`}>
                  <Icon name="bot" size={10} /> {projectName} · {backendName}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {empty && (
        <div className={styles.onboarding}>
          <div className={styles.typicalModels}>
            <strong>典型模型：</strong>
            {task.typical_models.join(" / ")}
          </div>
          {task.suggested_backends.length > 0 && (
            <div className={styles.suggestedList}>
              <div className={styles.onboardingHint}>推荐接入：</div>
              {[...task.suggested_backends]
                // builtin (平台自带) 排前, 外部推荐排后。
                .sort((a, b) => Number(b.builtin) - Number(a.builtin))
                .slice(0, 4)
                .map((s) => (
                  <div key={s.repo_url} className={styles.suggestedItem}>
                    {s.builtin && <Badge variant="success">自带</Badge>}
                    <span className={styles.suggestedName}>{s.name}</span>
                    {s.infra && <Badge variant="outline">{infraLabel(s.infra)}</Badge>}
                    <span className={styles.suggestedSummary}>{s.summary}</span>
                    <a
                      href={s.repo_url}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.suggestedLink}
                      title="在新标签页打开仓库"
                    >
                      GitHub ↗
                    </a>
                  </div>
                ))}
            </div>
          )}
          {onGoToRegistry && (
            <div className={styles.ctaRow}>
              <Button size="sm" onClick={onGoToRegistry}>
                <Icon name="plus" size={11} /> 去注册 backend
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

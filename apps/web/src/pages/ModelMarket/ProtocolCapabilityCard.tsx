// v0.14.11 · 协议能力卡片 — 一张卡 = 一个协议 task; 卡内挂载已注册 backend 的 model.
// 与 ModelCard (CapabilityCatalogPanel 内) 的区别: 概览化, 只显示 name + task/infra badge
// + backend 来源, 不展开 variants / resource / output_attribute_types. 用户想看完整细节
// 切到 groupBy=backend 模式即可。

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { ProtocolTask } from "@/api/mlCapabilities";

// 协议卡内 model 子卡的最小展示形态. v0.14.11 数据源由 instances 端点提供
// (env-only + registered 合并), 不含 url / health 等敏感字段。
export interface MountedModel {
  id: string;
  display_name: string;
  infra?: string | null;
  is_interactive?: boolean;
  backendName: string;
  source: "env_only" | "registered" | string;
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
    <div
      className={`flex flex-col gap-2.5 rounded-md border px-4 py-3.5 ${
        empty ? "border-dashed border-border bg-muted" : "border-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex min-w-0 flex-auto items-baseline gap-2">
          <h3 className="m-0 text-sm font-semibold text-foreground">{task.label}</h3>
          <span className="mono text-xs text-muted-foreground">{task.id}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
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

      <p className="m-0 text-xs leading-normal text-muted-foreground">{task.summary}</p>

      {!empty && (
        <div className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
          {mounted.map((m) => (
            <div
              key={`${m.backendName}:${m.id}`}
              className="flex flex-col gap-1 rounded-sm border border-border bg-muted px-2.5 py-2"
            >
              <div
                className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold text-foreground"
                title={m.display_name}
              >
                {m.display_name}
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                {m.infra && <span>{infraLabel(m.infra)}</span>}
                {m.is_interactive && <span>· 交互式</span>}
                {m.source === "env_only" ? (
                  <Badge variant="success">自带</Badge>
                ) : (
                  <Badge variant="outline">已注册</Badge>
                )}
              </div>
              <div
                className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground"
                title={m.backendName}
              >
                <Icon name="bot" size={10} /> {m.backendName}
              </div>
            </div>
          ))}
        </div>
      )}

      {empty && (
        <div className="flex flex-col gap-2 border-t border-dashed border-border pt-2.5">
          <div className="text-xs text-muted-foreground">
            <strong>典型模型：</strong>
            {task.typical_models.join(" / ")}
          </div>
          {task.suggested_backends.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="text-xs text-muted-foreground">推荐接入：</div>
              {[...task.suggested_backends]
                // builtin (平台自带) 排前, 外部推荐排后。
                .sort((a, b) => Number(b.builtin) - Number(a.builtin))
                .slice(0, 4)
                .map((s) => (
                  <div key={s.repo_url} className="flex items-center gap-2 text-xs">
                    {s.builtin && <Badge variant="success">自带</Badge>}
                    <span className="font-medium text-foreground">{s.name}</span>
                    {s.infra && <Badge variant="outline">{infraLabel(s.infra)}</Badge>}
                    <span className="flex-auto text-muted-foreground">{s.summary}</span>
                    <a
                      href={s.repo_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-brand no-underline hover:underline"
                      title="在新标签页打开仓库"
                    >
                      GitHub ↗
                    </a>
                  </div>
                ))}
            </div>
          )}
          {onGoToRegistry && (
            <div className="flex gap-2">
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

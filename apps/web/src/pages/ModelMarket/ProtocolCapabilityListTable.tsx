// 协议能力列表视图: groupBy=task 时与协议卡片共享同一份 protocolView 数据。

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { ProtocolTask } from "@/api/mlCapabilities";
import { taskVariant } from "./capability/labels";
import { effectiveInfra } from "./capability/catalogModel";
import type { FlatModel } from "./capability/types";

const TABLE_CLASS =
  "w-full min-w-[980px] border-separate border-spacing-0 text-xs " +
  "[&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-left [&_td]:align-top " +
  "[&_th]:border-b [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:align-top " +
  "[&_th]:whitespace-nowrap [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground";

interface ProtocolCapabilityListRow {
  task: ProtocolTask;
  mounted: FlatModel[];
}

interface Props {
  rows: ProtocolCapabilityListRow[];
  infraLabel: (infra: string) => string;
  modalityLabel: (modality: string) => string;
  onGoToRegistry?: () => void;
}

export function ProtocolCapabilityListTable({
  rows,
  infraLabel,
  modalityLabel,
  onGoToRegistry,
}: Props) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table className={TABLE_CLASS}>
        <thead>
          <tr>
            {[
              "协议能力",
              "默认模态",
              "输出几何",
              "接入状态",
              "已接入模型",
              "典型模型 / 推荐接入",
            ].map((head) => (
              <th key={head}>{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ task, mounted }) => {
            const suggested = [...task.suggested_backends]
              .sort((a, b) => Number(b.builtin) - Number(a.builtin))
              .slice(0, 2);
            return (
              <tr key={task.id}>
                <td className="min-w-[220px]">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant={taskVariant(task.id)}>{task.label}</Badge>
                    <span className="mono text-2xs text-muted-foreground">{task.id}</span>
                  </div>
                  <div className="mt-1.5 max-w-[340px] text-xs leading-normal text-muted-foreground">
                    {task.summary}
                  </div>
                </td>
                <td className="min-w-[120px]">
                  <div className="flex flex-wrap gap-1.5">
                    {task.default_modalities.length > 0 ? (
                      task.default_modalities.map((m) => (
                        <Badge key={m} variant="default">
                          {modalityLabel(m)}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </td>
                <td className="min-w-[150px]">
                  <div className="flex flex-wrap gap-1.5">
                    {task.default_geometry.length > 0 ? (
                      task.default_geometry.map((g) => (
                        <Badge key={g} variant="outline">
                          {g}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </td>
                <td className="min-w-[110px]">
                  {mounted.length > 0 ? (
                    <Badge variant="success">{mounted.length} 个模型</Badge>
                  ) : (
                    <Badge variant="outline">暂无接入</Badge>
                  )}
                </td>
                <td className="min-w-[260px] max-w-[360px]">
                  {mounted.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {mounted.slice(0, 3).map((m) => {
                        const infra = effectiveInfra(m.model, m.backendInfra);
                        return (
                          <div
                            key={`${task.id}:${m.backendName}:${m.model.id}`}
                            className="min-w-0 rounded-sm border border-border bg-muted px-2 py-1.5"
                          >
                            <div
                              className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground"
                              title={m.model.display_name ?? m.model.id}
                            >
                              {m.model.display_name ?? m.model.id}
                            </div>
                            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
                              {infra && <span>{infraLabel(infra)}</span>}
                              {m.model.is_interactive && <span>交互式</span>}
                              <Badge variant={m.source === "env_only" ? "success" : "outline"}>
                                {m.source === "env_only" ? "自带" : "已注册"}
                              </Badge>
                              <span
                                className="inline-flex min-w-0 items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap"
                                title={m.backendName}
                              >
                                <Icon name="bot" size={10} /> {m.backendName}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {mounted.length > 3 && (
                        <span className="text-2xs text-muted-foreground">
                          +{mounted.length - 3} 个模型
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="min-w-[240px] max-w-[360px]">
                  <div className="flex flex-col gap-1.5">
                    <div className="text-muted-foreground">
                      {task.typical_models.length > 0 ? task.typical_models.join(" / ") : "—"}
                    </div>
                    {suggested.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {suggested.map((s) => (
                          <Badge key={s.repo_url} variant={s.builtin ? "success" : "outline"}>
                            {s.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {mounted.length === 0 && onGoToRegistry && (
                      <div>
                        <Button size="sm" onClick={onGoToRegistry}>
                          <Icon name="plus" size={11} /> 去注册
                        </Button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

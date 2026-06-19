// 能力目录列表视图(从 CapabilityCatalogPanel.tsx 拆出,行为零变化)。
// ModelListTable 渲染按物理权重展开的行;RuntimeCell 为内部子组件(池状态 + 预热)。

import { Badge } from "@/components/ui/Badge";
import type { FlatModel } from "./types";
import {
  buildListRows,
  currentPoolSize,
  effectiveInfra,
  effectiveModalities,
  isLoadedRuntimeKey,
} from "./catalogModel";
import { infraLabel, modalityLabel, taskLabel } from "./labels";
import { WarmButton } from "./WarmButton";

const TABLE_CLASS =
  "w-full min-w-[920px] border-separate border-spacing-0 text-xs " +
  "[&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-[7px] [&_td]:text-left [&_td]:align-top " +
  "[&_th]:border-b [&_th]:border-border [&_th]:bg-muted [&_th]:px-2.5 [&_th]:py-[7px] [&_th]:text-left [&_th]:align-top " +
  "[&_th]:whitespace-nowrap [&_th]:text-[11px] [&_th]:font-semibold [&_th]:text-muted-foreground";

export function ModelListTable({ items }: { items: FlatModel[] }) {
  const rows = buildListRows(items);
  return (
    <div className="max-w-full overflow-x-auto">
      <table className={TABLE_CLASS}>
        <thead>
          <tr>
            {["模型", "task", "infra", "模态", "输出几何", "变体", "运行时", "来源", "注册状态", "状态"].map((head) => (
              <th key={head}>{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const item = row.parent;
            const m = item.model;
            const infra = effectiveInfra(m, item.backendInfra);
            const modalities = effectiveModalities(m, item.backendModalities);
            return (
              <tr key={row.rowKey}>
                <td className="min-w-[180px]">
                  <div className="font-semibold">{row.primaryLabel}</div>
                  <div className="mono mt-0.5 text-[10.5px] text-muted-foreground">{row.primaryId}</div>
                </td>
                <td className="max-w-[220px] text-muted-foreground">
                  {row.tasks.length > 0 ? row.tasks.map(taskLabel).join(" / ") : "—"}
                </td>
                <td>{infra ? infraLabel(infra) : "—"}</td>
                <td>{modalities.length ? modalities.map(modalityLabel).join(" / ") : "—"}</td>
                <td className="max-w-[220px] text-muted-foreground">{row.geometries.join(" / ") || "—"}</td>
                <td className="max-w-[220px] text-muted-foreground" title={row.secondaryTitle}>{row.secondaryLabel}</td>
                <td>
                  <RuntimeCell item={item} variants={row.warmVariants} runtimeKey={row.runtimeKey} />
                </td>
                <td className="max-w-[220px] text-muted-foreground">{item.backendName}</td>
                <td className="max-w-[220px] text-muted-foreground" title={
                  item.source === "registered" && item.registeredProjects.length > 0
                    ? `已注册至项目: ${item.registeredProjects.join(" / ")}`
                    : undefined
                }>
                  {item.source === "env_only" ? (
                    <Badge variant="outline">平台内置</Badge>
                  ) : item.registeredProjects.length > 1 ? (
                    <Badge variant="accent">
                      {item.registeredProjects[0]} +{item.registeredProjects.length - 1}
                    </Badge>
                  ) : (
                    <Badge variant="accent">{item.projectName}</Badge>
                  )}
                </td>
                <td>{item.stale ? <Badge variant="warning">缓存</Badge> : <Badge variant="success">在线</Badge>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RuntimeCell({
  item,
  variants,
  runtimeKey,
}: {
  item: FlatModel;
  variants: Record<string, string>;
  runtimeKey?: string;
}) {
  const loaded = isLoadedRuntimeKey(item, variants, runtimeKey);
  return (
    <div className="inline-flex min-w-[150px] items-center gap-1.5">
      <span className="whitespace-nowrap text-[11px] text-muted-foreground">池 {currentPoolSize(item)}</span>
      <Badge variant={loaded ? "success" : "outline"}>{loaded ? "已加载" : "未加载"}</Badge>
      <WarmButton item={item} variants={variants} compact />
    </div>
  );
}

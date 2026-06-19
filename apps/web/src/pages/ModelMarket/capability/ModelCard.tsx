// 能力目录单个 model 卡片(从 CapabilityCatalogPanel.tsx 拆出,行为零变化)。Row 为内部布局子组件。

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import type { FlatModel } from "./types";
import {
  currentPoolSize,
  effectiveInfra,
  effectiveModalities,
  formatEvict,
  isLoadedRuntimeKey,
  lastEvict,
  pickDefaultVariants,
  runtimeKeyFor,
  tierLabel,
} from "./catalogModel";
import { infraLabel, modalityLabel, taskLabel, taskVariant } from "./labels";
import { WarmButton } from "./WarmButton";

const TAG_CLASS =
  "mono rounded-sm bg-muted px-[7px] py-px text-[10.5px] leading-[1.5] text-muted-foreground";
const VARIANT_PILL_BASE =
  "inline-flex items-center rounded-full border px-2 py-px text-[10.5px] leading-[1.6]";

export function ModelCard({ item }: { item: FlatModel }) {
  const { model: m } = item;
  const infra = effectiveInfra(m, item.backendInfra);
  const modalities = effectiveModalities(m, item.backendModalities);
  const geom = m.supported_geometric_outputs ?? [];
  const attrs = m.output_attribute_types ?? [];
  const variantGroups = (m.supported_variants ?? []).filter(
    (g) => Array.isArray(g.variants) && g.variants.length > 0,
  );
  const resource = m.resource_profile ?? {};
  const resourceEntries = Object.entries(resource).filter(([, v]) => v != null);
  const defaultVariants = pickDefaultVariants(m);
  const cardRuntimeKey = runtimeKeyFor(m.task, defaultVariants);
  const loaded = isLoadedRuntimeKey(item, defaultVariants, cardRuntimeKey);
  const evict = lastEvict(item);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span
          className="overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-semibold"
          title={m.display_name ?? m.id}
        >
          {m.display_name ?? m.id}
        </span>
        {item.stale && (
          <span title="来源 backend 当前未连接，目录可能为缓存旧值">
            <Badge variant="warning">缓存</Badge>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-[5px]">
        {m.task && <Badge variant={taskVariant(m.task)}>{taskLabel(m.task)}</Badge>}
        {infra && <Badge variant="outline">{infraLabel(infra)}</Badge>}
        {modalities.map((mod) => (
          <Badge key={mod} variant="default">
            {modalityLabel(mod)}
          </Badge>
        ))}
        {m.is_interactive && <Badge variant="ai">交互式</Badge>}
        {m.model_family && (
          <span
            className="mono rounded-full border border-border px-[7px] py-px text-[10.5px] text-muted-foreground"
            title="模型族"
          >
            {m.model_family}
          </span>
        )}
      </div>

      <div
        className="flex min-w-0 items-center gap-[5px] text-[11px] text-muted-foreground"
        title={`${item.projectName} · ${item.backendName}`}
      >
        <Icon name="bot" size={11} className="text-muted-foreground" />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
          {item.projectName} · {item.backendName}
        </span>
      </div>

      <Row label="运行时">
        <span className={TAG_CLASS}>池 {currentPoolSize(item)}</span>
        <Badge variant={loaded ? "success" : "outline"}>{loaded ? "已加载" : "未加载"}</Badge>
        <WarmButton item={item} variants={defaultVariants} />
      </Row>

      {geom.length > 0 && (
        <Row label="输出几何">
          {geom.map((g) => (
            <span key={g} className={TAG_CLASS}>
              {g}
            </span>
          ))}
        </Row>
      )}

      {attrs.length > 0 && (
        <Row label="输出属性">
          {attrs.map((a) => (
            <span key={a} className={TAG_CLASS}>
              {a}
            </span>
          ))}
        </Row>
      )}

      {variantGroups.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-dashed border-border pt-1">
          {variantGroups.map((g) => (
            <div key={g.key} className="flex flex-col gap-1">
              <span className="text-[10.5px] font-semibold text-muted-foreground">{g.title ?? g.key}</span>
              <div className="flex flex-wrap gap-[5px]">
                {g.variants!.map((v) => {
                  const metaBits = [
                    v.vram_gb != null ? `${v.vram_gb}GB` : null,
                    v.tier ? tierLabel(v.tier) : null,
                  ].filter(Boolean);
                  return (
                    <span
                      key={v.value}
                      className={
                        v.recommended
                          ? `${VARIANT_PILL_BASE} border-brand/30 bg-brand/10 text-brand`
                          : `${VARIANT_PILL_BASE} border-border bg-muted text-muted-foreground`
                      }
                      title={v.note ?? undefined}
                    >
                      <span className="mono">{v.label ?? v.value}</span>
                      {metaBits.length > 0 && (
                        <span className="text-muted-foreground"> · {metaBits.join(" · ")}</span>
                      )}
                      {v.recommended && (
                        <span className="text-amber-600 dark:text-amber-400"> ★</span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {resourceEntries.length > 0 && (
        <Row label="资源">
          {resourceEntries.map(([k, v]) => (
            <span key={k} className={TAG_CLASS}>
              {k}: {String(v)}
            </span>
          ))}
        </Row>
      )}

      {evict && (
        <div className="flex items-center gap-[5px] border-t border-dashed border-border pt-[7px] text-[11px] text-muted-foreground">
          <Icon name="history" size={11} />
          <span>{formatEvict(evict)}</span>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-14 shrink-0 text-[10.5px] font-semibold text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-[5px]">{children}</div>
    </div>
  );
}

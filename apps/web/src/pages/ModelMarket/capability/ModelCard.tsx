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
import styles from "../CapabilityCatalogPanel.module.css";

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
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.modelName} title={m.display_name ?? m.id}>
          {m.display_name ?? m.id}
        </span>
        {item.stale && (
          <span title="来源 backend 当前未连接，目录可能为缓存旧值">
            <Badge variant="warning">缓存</Badge>
          </span>
        )}
      </div>

      <div className={styles.badgeRow}>
        {m.task && <Badge variant={taskVariant(m.task)}>{taskLabel(m.task)}</Badge>}
        {infra && <Badge variant="outline">{infraLabel(infra)}</Badge>}
        {modalities.map((mod) => (
          <Badge key={mod} variant="default">
            {modalityLabel(mod)}
          </Badge>
        ))}
        {m.is_interactive && <Badge variant="ai">交互式</Badge>}
        {m.model_family && (
          <span className={styles.familyChip} title="模型族">
            {m.model_family}
          </span>
        )}
      </div>

      <div className={styles.source} title={`${item.projectName} · ${item.backendName}`}>
        <Icon name="bot" size={11} className={styles.mutedIcon} />
        <span className={styles.sourceText}>
          {item.projectName} · {item.backendName}
        </span>
      </div>

      <Row label="运行时">
        <span className={styles.tag}>池 {currentPoolSize(item)}</span>
        <Badge variant={loaded ? "success" : "outline"}>{loaded ? "已加载" : "未加载"}</Badge>
        <WarmButton item={item} variants={defaultVariants} />
      </Row>

      {geom.length > 0 && (
        <Row label="输出几何">
          {geom.map((g) => (
            <span key={g} className={styles.tag}>
              {g}
            </span>
          ))}
        </Row>
      )}

      {attrs.length > 0 && (
        <Row label="输出属性">
          {attrs.map((a) => (
            <span key={a} className={styles.tag}>
              {a}
            </span>
          ))}
        </Row>
      )}

      {variantGroups.length > 0 && (
        <div className={styles.variantBlock}>
          {variantGroups.map((g) => (
            <div key={g.key} className={styles.variantGroup}>
              <span className={styles.variantTitle}>{g.title ?? g.key}</span>
              <div className={styles.tagRow}>
                {g.variants!.map((v) => {
                  const metaBits = [
                    v.vram_gb != null ? `${v.vram_gb}GB` : null,
                    v.tier ? tierLabel(v.tier) : null,
                  ].filter(Boolean);
                  return (
                    <span
                      key={v.value}
                      className={v.recommended ? `${styles.variantPill} ${styles.variantOn}` : styles.variantPill}
                      title={v.note ?? undefined}
                    >
                      <span className="mono">{v.label ?? v.value}</span>
                      {metaBits.length > 0 && (
                        <span className={styles.variantMeta}> · {metaBits.join(" · ")}</span>
                      )}
                      {v.recommended && <span className={styles.variantStar}> ★</span>}
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
            <span key={k} className={styles.tag}>
              {k}: {String(v)}
            </span>
          ))}
        </Row>
      )}

      {evict && (
        <div className={styles.evictFooter}>
          <Icon name="history" size={11} />
          <span>{formatEvict(evict)}</span>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.tagRow}>{children}</div>
    </div>
  );
}

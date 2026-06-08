/**
 * v0.14.17 · YOLO 类别白名单勾选 ([index]类名).
 *
 * 闭集检测器 (YOLO) 暴露模型原生类别表 (model.names) 后, 让用户勾选只检出哪些类 (留空=全部).
 * 平台不做"模型类→项目标签"映射 (NG6): 预标结果仍渲染模型原生类名, 采纳时由人选项目标签.
 * classes 仅在该 task 模型已加载过 (warmup/首次 predict) 才有值; 未就位时本组件提示需预热。
 */
import styles from "./ProjectDetailPanel.module.css";

function cx(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

interface Props {
  /** 模型原生类别表; undefined/空 = 尚未就位 (模型未加载过). */
  classes: { index: number; name: string }[] | undefined;
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  /** 手动预热该 task 以加载类别表 (model.names); 想按类筛选才需要, 默认全标无需预热. */
  onWarm?: () => void;
  warming?: boolean;
}

export function ClassWhitelistRow({ classes, selected, onChange, onWarm, warming }: Props) {
  if (!classes || classes.length === 0) {
    return (
      <div className={styles.field}>
        <span className={styles.fieldLabel}>类别筛选</span>
        <div className={styles.presetRow}>
          <span className={styles.mutedText}>
            当前将检出全部类别。如需只标部分类别，先预热加载类别表。
          </span>
          {onWarm && (
            <button
              type="button"
              className={styles.presetButton}
              disabled={warming}
              onClick={onWarm}
              title="加载该模型的类别表 (model.names), 之后可勾选类别白名单"
            >
              {warming ? "预热中…（首次约 5-15s）" : "预热以加载类别"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const toggle = (idx: number) => {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    onChange(next);
  };

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>
        类别筛选（可选，留空=检出全部 {classes.length} 类
        {selected.size > 0 ? `；已选 ${selected.size}` : ""}）
      </span>
      <div className={styles.aliasList}>
        {classes.map((c) => {
          const active = selected.has(c.index);
          return (
            <button
              key={c.index}
              type="button"
              onClick={() => toggle(c.index)}
              className={cx(styles.aliasChip, active && styles.aliasChipActive)}
              title={`类别 [${c.index}] ${c.name}`}
            >
              <span>
                {active ? "✓ " : ""}
                {c.name}
              </span>
              <span className={styles.aliasName}>[{c.index}]</span>
            </button>
          );
        })}
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className={styles.refillButton}
            title="清空选择 (恢复检出全部类别)"
          >
            清空
          </button>
        )}
      </div>
    </div>
  );
}

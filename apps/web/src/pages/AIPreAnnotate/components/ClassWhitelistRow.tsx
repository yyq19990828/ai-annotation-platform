/**
 * v0.14.17 · YOLO 类别白名单勾选 ([index]类名).
 *
 * 闭集检测器 (YOLO) 暴露模型原生类别表 (model.names) 后, 让用户勾选只检出哪些类 (留空=全部).
 * 平台不做"模型类→项目标签"映射 (NG6): 预标结果仍渲染模型原生类名, 采纳时由人选项目标签.
 * v0.20.x · 类别表改由 backend 静态自报 (COCO80/DOTA15/person, 见各 backend), 免预热、切模型即在;
 *   再补一个文本输入框 (datalist 自动补全) 按类名快速勾选 —— 类别多时不用在长 chip 列里找。
 *   仍 index 制 (闭集只能选模型认识的类), 输入命中类名才落选。
 */
import { useId, useState } from "react";

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
  const listId = useId();
  const [draft, setDraft] = useState("");
  // 文本输入按类名 (大小写不敏感) 找到 index 并勾选; 命中才清空、未命中保留草稿。
  const addByName = () => {
    const q = draft.trim().toLowerCase();
    if (!q) return;
    const hit = (classes ?? []).find((c) => c.name.toLowerCase() === q);
    if (!hit) return;
    const next = new Set(selected);
    next.add(hit.index);
    onChange(next);
    setDraft("");
  };

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
      {/* 文本输入: 按类名快速勾选 (datalist 自动补全), 类别多时免在长 chip 列里找。 */}
      <div className={styles.presetRow}>
        <input
          className={styles.textInput}
          type="text"
          list={listId}
          value={draft}
          placeholder="输入类名快速勾选，如 person"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addByName();
            }
          }}
        />
        <datalist id={listId}>
          {classes.map((c) => (
            <option key={c.index} value={c.name} />
          ))}
        </datalist>
        <button
          type="button"
          className={styles.presetButton}
          disabled={!draft.trim()}
          onClick={addByName}
          title="按类名勾选"
        >
          添加
        </button>
      </div>
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

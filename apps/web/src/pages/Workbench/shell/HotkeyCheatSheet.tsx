import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { AttributeSchema } from "@/api/projects";
import { GROUP_LABEL, HOTKEYS, type HotkeyDef, type HotkeyGroup } from "../state/hotkeys";
import { getHotkeyUsage } from "../state/hotkeyUsage";
import styles from "./HotkeyCheatSheet.module.css";

const GROUPS: HotkeyGroup[] = ["draw", "video", "view", "ai", "nav", "system"];

interface HotkeyCheatSheetProps {
  open: boolean;
  onClose: () => void;
  /** 项目级属性 schema：含 hotkey 的字段会在末尾以「属性快捷键」分组展示。 */
  attributeSchema?: AttributeSchema;
}

function HotkeyRow({ h, count }: { h: HotkeyDef; count?: number }) {
  return (
    <div className={styles.hotkeyRow}>
      <span className={styles.primaryText}>
        {h.desc}
        {count !== undefined && count > 0 && (
          <span
            className={`mono ${styles.usageCount}`}
            title="近期使用次数"
          >
            ×{count}
          </span>
        )}
      </span>
      <span className={styles.keyList}>
        {h.keys.map((k, j) => (
          <kbd key={j} className={styles.kbd}>{k}</kbd>
        ))}
      </span>
    </div>
  );
}

export function HotkeyCheatSheet({ open, onClose, attributeSchema }: HotkeyCheatSheetProps) {
  const [query, setQuery] = useState("");
  const [sortByFreq, setSortByFreq] = useState(false);

  // 打开时取一次 usage 快照（关闭后再打开会刷新）
  const usage = useMemo(() => (open ? getHotkeyUsage() : {}), [open]);

  const q = query.trim().toLowerCase();
  const matches = (h: HotkeyDef) =>
    !q ||
    h.desc.toLowerCase().includes(q) ||
    h.keys.join(" ").toLowerCase().includes(q);

  // 属性快捷键：仅 boolean / select 类型的字段且声明了 hotkey 才进入面板
  const attributeItems = (attributeSchema?.fields ?? []).filter(
    (f) => !!f.hotkey && (f.type === "boolean" || f.type === "select"),
  );

  const filteredAttr = attributeItems.filter((f) => {
    if (!q) return true;
    return f.label.toLowerCase().includes(q) || (f.hotkey ?? "").toLowerCase().includes(q);
  });

  // 当 sortByFreq=true 时，把所有命中的 HotkeyDef 平铺并按 usage 倒序，分组消失
  const flatSortedByFreq = useMemo<HotkeyDef[]>(() => {
    if (!sortByFreq) return [];
    return [...HOTKEYS]
      .filter(matches)
      .sort((a, b) => {
        const ca = a.actionType ? usage[a.actionType] ?? 0 : 0;
        const cb = b.actionType ? usage[b.actionType] ?? 0 : 0;
        if (ca !== cb) return cb - ca;
        return a.desc.localeCompare(b.desc, "zh");
      });
  }, [sortByFreq, usage, q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal open={open} onClose={onClose} title="键盘快捷键" width={860}>
      <div className={styles.toolbar}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索：动作描述 / 按键…"
          autoFocus
          className={styles.searchInput}
        />
        <label
          className={styles.sortToggle}
          title="按 localStorage 中累积的触发次数倒序排列；分组临时折叠"
        >
          <input
            type="checkbox"
            checked={sortByFreq}
            onChange={(e) => setSortByFreq(e.target.checked)}
          />
          按使用频率排
        </label>
      </div>

      {sortByFreq ? (
        <div>
          {flatSortedByFreq.length === 0 ? (
            <div className={styles.emptyState}>
              无匹配快捷键
            </div>
          ) : (
            flatSortedByFreq.map((h, i) => (
              <HotkeyRow key={i} h={h} count={h.actionType ? usage[h.actionType] ?? 0 : 0} />
            ))
          )}
        </div>
      ) : (
        <div className={styles.groupGrid}>
          {GROUPS.map((g) => {
            const items = HOTKEYS.filter((h) => h.group === g && matches(h));
            if (items.length === 0) return null;
            return (
              <div key={g} className={styles.sectionBlock}>
                <div className={styles.sectionTitle}>
                  {GROUP_LABEL[g]}
                </div>
                {items.map((h, i) => (
                  <HotkeyRow key={i} h={h} count={h.actionType ? usage[h.actionType] ?? 0 : undefined} />
                ))}
              </div>
            );
          })}

          {filteredAttr.length > 0 && (
            <div className={styles.fullWidthSection}>
              <div className={styles.attributeTitle}>
                属性快捷键
              </div>
              <div className={styles.attributeHint}>
                选中标注后按下数字键切换 / 循环属性值（项目级 schema 配置）
              </div>
              <div className={styles.attributeGrid}>
                {filteredAttr.map((f) => (
                  <div
                    key={f.key}
                    className={styles.hotkeyRow}
                  >
                    <span className={styles.primaryText}>
                      {f.type === "boolean" ? "切换 " : "循环 "}
                      <span className={styles.attributeLabel}>{f.label}</span>
                    </span>
                    <kbd className={styles.kbd}>{f.hotkey}</kbd>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

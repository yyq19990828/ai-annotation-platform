import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { AttributeSchema } from "@/api/projects";
import { GROUP_LABEL, HOTKEYS, type HotkeyDef, type HotkeyGroup } from "../state/hotkeys";
import { getHotkeyUsage } from "../state/hotkeyUsage";

const GROUPS: HotkeyGroup[] = ["draw", "video", "view", "ai", "nav", "system"];

const KBD_STYLE: React.CSSProperties = {
  padding: "1px 6px",
  background: "var(--color-bg-sunken)",
  border: "1px solid var(--color-border)",
  borderBottomWidth: 2,
  borderRadius: 3,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--color-fg)",
  lineHeight: 1.5,
};

interface HotkeyCheatSheetProps {
  open: boolean;
  onClose: () => void;
  /** 项目级属性 schema：含 hotkey 的字段会在末尾以「属性快捷键」分组展示。 */
  attributeSchema?: AttributeSchema;
}

function HotkeyRow({ h, count }: { h: HotkeyDef; count?: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "5px 0",
        fontSize: 12.5,
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <span style={{ color: "var(--color-fg)" }}>
        {h.desc}
        {count !== undefined && count > 0 && (
          <span
            className="mono"
            style={{ marginLeft: 6, fontSize: 10.5, color: "var(--color-fg-subtle)" }}
            title="近期使用次数"
          >
            ×{count}
          </span>
        )}
      </span>
      <span style={{ display: "flex", gap: 4 }}>
        {h.keys.map((k, j) => (
          <kbd key={j} style={KBD_STYLE}>{k}</kbd>
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
    <Modal open={open} onClose={onClose} title="键盘快捷键" width={640}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          marginBottom: 12,
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索：动作描述 / 按键…"
          autoFocus
          style={{
            flex: 1,
            padding: "6px 10px",
            fontSize: 12.5,
            background: "var(--color-bg-sunken)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            color: "var(--color-fg)",
          }}
        />
        <label
          style={{
            display: "flex", alignItems: "center", gap: 4,
            fontSize: 12, color: "var(--color-fg-muted)",
            cursor: "pointer", userSelect: "none",
          }}
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
            <div style={{ padding: "20px 0", textAlign: "center", color: "var(--color-fg-muted)", fontSize: 12 }}>
              无匹配快捷键
            </div>
          ) : (
            flatSortedByFreq.map((h, i) => (
              <HotkeyRow key={i} h={h} count={h.actionType ? usage[h.actionType] ?? 0 : 0} />
            ))
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {GROUPS.map((g) => {
            const items = HOTKEYS.filter((h) => h.group === g && matches(h));
            if (items.length === 0) return null;
            return (
              <div key={g}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: "var(--color-fg-muted)",
                    marginBottom: 6,
                  }}
                >
                  {GROUP_LABEL[g]}
                </div>
                {items.map((h, i) => (
                  <HotkeyRow key={i} h={h} count={h.actionType ? usage[h.actionType] ?? 0 : undefined} />
                ))}
              </div>
            );
          })}

          {filteredAttr.length > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  color: "var(--color-fg-muted)",
                  marginBottom: 4,
                }}
              >
                属性快捷键
              </div>
              <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginBottom: 6 }}>
                选中标注后按下数字键切换 / 循环属性值（项目级 schema 配置）
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16 }}>
                {filteredAttr.map((f) => (
                  <div
                    key={f.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "5px 0",
                      fontSize: 12.5,
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <span style={{ color: "var(--color-fg)" }}>
                      {f.type === "boolean" ? "切换 " : "循环 "}
                      <span style={{ fontWeight: 500 }}>{f.label}</span>
                    </span>
                    <kbd style={KBD_STYLE}>{f.hotkey}</kbd>
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

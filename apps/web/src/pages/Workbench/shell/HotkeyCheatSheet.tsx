import { Modal } from "@/components/ui/Modal";
import type { AttributeSchema } from "@/api/projects";
import { GROUP_LABEL, HOTKEYS, type HotkeyGroup } from "../state/hotkeys";

const GROUPS: HotkeyGroup[] = ["draw", "view", "ai", "nav", "system"];

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

export function HotkeyCheatSheet({ open, onClose, attributeSchema }: HotkeyCheatSheetProps) {
  // 属性快捷键：仅 boolean / select 类型的字段且声明了 hotkey 才进入面板
  const attributeItems = (attributeSchema?.fields ?? []).filter(
    (f) => !!f.hotkey && (f.type === "boolean" || f.type === "select"),
  );

  return (
    <Modal open={open} onClose={onClose} title="键盘快捷键" width={640}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {GROUPS.map((g) => {
          const items = HOTKEYS.filter((h) => h.group === g);
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
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "5px 0",
                    fontSize: 12.5,
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <span style={{ color: "var(--color-fg)" }}>{h.desc}</span>
                  <span style={{ display: "flex", gap: 4 }}>
                    {h.keys.map((k, j) => (
                      <kbd key={j} style={KBD_STYLE}>{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          );
        })}

        {attributeItems.length > 0 && (
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
              {attributeItems.map((f) => (
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
    </Modal>
  );
}

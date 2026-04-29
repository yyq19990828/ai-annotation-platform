import { Modal } from "@/components/ui/Modal";
import { GROUP_LABEL, HOTKEYS, type HotkeyGroup } from "../state/hotkeys";

const GROUPS: HotkeyGroup[] = ["draw", "view", "ai", "nav", "system"];

export function HotkeyCheatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
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
                      <kbd
                        key={j}
                        style={{
                          padding: "1px 6px",
                          background: "var(--color-bg-sunken)",
                          border: "1px solid var(--color-border)",
                          borderBottomWidth: 2,
                          borderRadius: 3,
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          color: "var(--color-fg)",
                          lineHeight: 1.5,
                        }}
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

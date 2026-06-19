import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { AttributeSchema } from "@/api/projects";
import { GROUP_LABEL, HOTKEYS, type HotkeyDef, type HotkeyGroup } from "../state/hotkeys";
import { getHotkeyUsage } from "../state/hotkeyUsage";

const GROUPS: HotkeyGroup[] = ["draw", "video", "view", "ai", "nav", "threed", "system"];

const KBD_CLASS =
  "whitespace-nowrap rounded-[3px] border border-b-2 border-border bg-muted px-1.5 py-px font-mono text-[11px] leading-normal text-foreground";
const HOTKEY_ROW_CLASS = "flex items-center justify-between gap-3 border-b border-border py-[5px] text-[12.5px]";
const PRIMARY_TEXT_CLASS = "min-w-0 max-w-[34ch] leading-[1.35] text-foreground [overflow-wrap:anywhere]";
const SECTION_TITLE_CLASS =
  "sticky top-0 z-[1] mb-2 flex items-center gap-[7px] border-b border-border bg-card px-0 pb-[7px] pt-1.5 text-xs font-bold uppercase tracking-[0.04em] text-foreground";
const SECTION_BLOCK_CLASS =
  "min-w-0 max-h-[min(360px,calc(100vh-260px))] overflow-y-auto pr-1.5 [scrollbar-gutter:stable]";
const SectionBar = () => <span className="h-3.5 w-[3px] flex-none rounded-full bg-brand" />;

interface HotkeyCheatSheetProps {
  open: boolean;
  onClose: () => void;
  /** 项目级属性 schema：含 hotkey 的字段会在末尾以「属性快捷键」分组展示。 */
  attributeSchema?: AttributeSchema;
}

function HotkeyRow({ h, count }: { h: HotkeyDef; count?: number }) {
  return (
    <div className={HOTKEY_ROW_CLASS}>
      <span className={PRIMARY_TEXT_CLASS}>
        {h.desc}
        {count !== undefined && count > 0 && (
          <span
            className="mono ml-1.5 text-[10.5px] text-muted-foreground"
            title="近期使用次数"
          >
            ×{count}
          </span>
        )}
      </span>
      <span className="flex max-w-[132px] flex-none flex-wrap justify-end gap-1">
        {h.keys.map((k, j) => (
          <kbd key={j} className={KBD_CLASS}>{k}</kbd>
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
      <div className="mb-3 flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索：动作描述 / 按键…"
          autoFocus
          className="flex-1 appearance-none rounded-md border border-border bg-muted px-2.5 py-1.5 text-[12.5px] text-foreground"
        />
        <label
          className="flex cursor-pointer select-none items-center gap-1 text-xs text-muted-foreground"
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
            <div className="py-5 text-center text-xs text-muted-foreground">
              无匹配快捷键
            </div>
          ) : (
            flatSortedByFreq.map((h, i) => (
              <HotkeyRow key={i} h={h} count={h.actionType ? usage[h.actionType] ?? 0 : 0} />
            ))
          )}
        </div>
      ) : (
        <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))]">
          {GROUPS.map((g) => {
            const items = HOTKEYS.filter((h) => h.group === g && matches(h));
            if (items.length === 0) return null;
            return (
              <div key={g} className={SECTION_BLOCK_CLASS}>
                <div className={SECTION_TITLE_CLASS}>
                  <SectionBar />
                  {GROUP_LABEL[g]}
                </div>
                {items.map((h, i) => (
                  <HotkeyRow key={i} h={h} count={h.actionType ? usage[h.actionType] ?? 0 : undefined} />
                ))}
              </div>
            );
          })}

          {filteredAttr.length > 0 && (
            <div className={`${SECTION_BLOCK_CLASS} col-[1/-1]`}>
              <div className={SECTION_TITLE_CLASS}>
                <SectionBar />
                属性快捷键
              </div>
              <div className="mb-1.5 text-[11px] text-muted-foreground">
                选中标注后按下数字键切换 / 循环属性值（项目级 schema 配置）
              </div>
              <div className="grid gap-x-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
                {filteredAttr.map((f) => (
                  <div
                    key={f.key}
                    className={HOTKEY_ROW_CLASS}
                  >
                    <span className={PRIMARY_TEXT_CLASS}>
                      {f.type === "boolean" ? "切换 " : "循环 "}
                      <span className="font-medium">{f.label}</span>
                    </span>
                    <kbd className={KBD_CLASS}>{f.hotkey}</kbd>
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

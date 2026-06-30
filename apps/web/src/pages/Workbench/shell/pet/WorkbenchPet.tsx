import { useCallback, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useDragMove, type FloatingPanelPoint } from "../useDragMove";
import { PixelSprite } from "./PixelSprite";
import { usePetMood } from "./usePetMood";
import styles from "./pet.module.css";

export interface WorkbenchPetProps {
  /** 当前有选中标注。 */
  hasSelection: boolean;
  /** 选中信息卡处于折叠态;true 时桌宠「举牌」代替原折叠小条。 */
  collapsed: boolean;
  /** 选中对象标题(举牌文字)。 */
  selectionTitle: string | null;
  /** 当前题标注总数(派生 happy / celebrate)。 */
  annotationCount: number;
  /** 展开选中信息卡(点击举牌态精灵时调用)。 */
  onExpand: () => void;
}

const PET_SIZE = { w: 56, h: 56 } as const;
const PET_POS_KEY = "workbench.pet.pos";
const DRAG_THRESHOLD = 3;

function readPetPos(): FloatingPanelPoint {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  try {
    const raw = window.localStorage.getItem(PET_POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<FloatingPanelPoint>;
      if (typeof p.x === "number" && typeof p.y === "number") return { x: p.x, y: p.y };
    }
  } catch {
    /* best-effort */
  }
  // 默认落点:靠右下但避开右下角 FAB 露出热区(距右缘 > 180px),免得靠近桌宠误触露出按钮列。
  return { x: window.innerWidth - 230, y: window.innerHeight - 150 };
}

/**
 * v1 工作台桌宠(常驻像素小精灵,纯陪伴层,可拖动)。
 *
 * 吃掉原选中信息卡的折叠小条:折叠态时由小精灵举牌显类别名、点击展开。
 * 可自由拖动,位置记忆到 localStorage;拖动与点击经位移阈值区分。
 * 数据红线:本组件不触碰任何标注数据,情绪全由 props 派生。
 */
export function WorkbenchPet({
  hasSelection,
  collapsed,
  selectionTitle,
  annotationCount,
  onExpand,
}: WorkbenchPetProps) {
  const [poke, setPoke] = useState(0);
  const [position, setPosition] = useState<FloatingPanelPoint>(readPetPos);
  const movedRef = useRef(false);
  const startRef = useRef<FloatingPanelPoint | null>(null);
  const { mood, line } = usePetMood({ hasSelection, collapsed, annotationCount, poke });

  const onChange = useCallback((pos: FloatingPanelPoint) => {
    const start = startRef.current;
    if (
      start &&
      (Math.abs(pos.x - start.x) > DRAG_THRESHOLD || Math.abs(pos.y - start.y) > DRAG_THRESHOLD)
    ) {
      movedRef.current = true;
    }
    setPosition(pos);
    try {
      window.localStorage.setItem(PET_POS_KEY, JSON.stringify(pos));
    } catch {
      /* best-effort */
    }
  }, []);

  const drag = useDragMove({
    position,
    size: PET_SIZE,
    onStart: (pos) => {
      startRef.current = pos;
      movedRef.current = false;
    },
    onChange,
  });

  const holding = mood === "holding";
  const bubbleText = holding ? selectionTitle : line;

  const act = () => {
    if (holding) onExpand();
    else setPoke((n) => n + 1);
  };

  return (
    // div(非 button):useDragMove 的 isInteractiveTarget 会拦掉 button 的 pointerdown。
    <div
      data-floating-panel
      tabIndex={0}
      aria-label={holding ? `展开选中信息卡:${selectionTitle ?? ""}(可拖动)` : "工作台桌宠(可拖动)"}
      className={cn(
        "fixed left-[var(--pet-x)] top-[var(--pet-y)] z-popover-elevated flex cursor-grab touch-none select-none flex-col items-center gap-1",
        drag.isDragging && "cursor-grabbing",
      )}
      // eslint-disable-next-line no-restricted-syntax -- 拖动位置经 CSS 变量注入(对齐选中卡折叠 tab 的做法)。
      style={{ "--pet-x": `${position.x}px`, "--pet-y": `${position.y}px` } as CSSProperties}
      {...drag.handleProps}
      onClick={() => {
        if (!movedRef.current) act();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          act();
        }
      }}
    >
      {bubbleText && (
        <div
          className={cn(
            "pointer-events-none max-w-[200px] rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground shadow-md",
            styles.bubble,
          )}
        >
          <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-medium">
            {bubbleText}
          </span>
          {holding && <span className="text-muted-foreground">▸ 点我展开</span>}
        </div>
      )}
      <span className={styles.bob}>
        <PixelSprite mood={mood} />
      </span>
    </div>
  );
}

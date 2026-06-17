import { useRef, type CSSProperties, type ReactNode } from "react";
import { FloatingPanelShell, type FloatingPanelRect } from "./FloatingPanelShell";
import { useDragMove } from "./useDragMove";
import {
  FLOATING_SELECTION_MAX_SIZE,
  FLOATING_SELECTION_MIN_SIZE,
} from "./floatingPanelSizing";
import styles from "./SelectedAnnotationCard.module.css";

const TAB_DRAG_SIZE = { w: 220, h: 40 } as const;
const TAB_DRAG_THRESHOLD = 3;

export interface SelectedAnnotationCardProps {
  /** 卡头标题:随选中对象动态(类别 / ID 摘要 / N 个已选中)。 */
  title: string;
  /** 视口坐标的位置 + 尺寸(已解析默认值)。 */
  position: FloatingPanelRect;
  onPositionChange: (patch: Partial<FloatingPanelRect>) => void;
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  children: ReactNode;
}

/**
 * v0.16.8 · 选中标注浮动信息卡(图片 / 视频共用基座)。
 *
 * 复用 FloatingPanelShell(可拖 / 可缩放),不带「合并回边栏」(variant=no-merge);
 * 折叠态收成一枚可拖小标签(对齐 3D 三视图浮层的收起体验)。显隐由调用方按选中状态决定:
 * 选中单个即现、取消选中即隐;内容(几何摘要 / 改类 / 属性 / 轨迹操作)由各端经 children 注入。
 */
export function SelectedAnnotationCard({
  title,
  position,
  onPositionChange,
  collapsed,
  onCollapse,
  onExpand,
  children,
}: SelectedAnnotationCardProps) {
  const tabStartRef = useRef<{ x: number; y: number } | null>(null);
  const tabMovedRef = useRef(false);
  const tabDrag = useDragMove({
    position,
    size: TAB_DRAG_SIZE,
    onStart: (pos) => {
      tabStartRef.current = pos;
      tabMovedRef.current = false;
    },
    onChange: (pos) => {
      const start = tabStartRef.current;
      if (
        start &&
        (Math.abs(pos.x - start.x) > TAB_DRAG_THRESHOLD ||
          Math.abs(pos.y - start.y) > TAB_DRAG_THRESHOLD)
      ) {
        tabMovedRef.current = true;
      }
      onPositionChange({ x: pos.x, y: pos.y });
    },
  });

  if (collapsed) {
    return (
      // 不能用 <button>:useDragMove 的 isInteractiveTarget 会拦掉其 pointerdown。
      // 用 div + tabIndex 保留键盘可达;拖动经 handleProps,纯点击(未拖动)才展开。
      <div
        tabIndex={0}
        data-floating-panel
        aria-label="展开选中信息卡(可拖动)"
        className={[
          styles.tab,
          tabDrag.isDragging ? styles.tabDragging : "",
        ]
          .filter(Boolean)
          .join(" ")}
        // eslint-disable-next-line no-restricted-syntax -- 收起标签沿用展开卡的记忆位置，经 CSS 变量注入。
        style={
          {
            "--selection-tab-x": `${position.x}px`,
            "--selection-tab-y": `${position.y}px`,
          } as CSSProperties
        }
        {...tabDrag.handleProps}
        onClick={() => {
          if (!tabMovedRef.current) onExpand();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onExpand();
          }
        }}
      >
        <span className={styles.tabTitle}>{title}</span>
        <span className={styles.tabChevron}>▸</span>
      </div>
    );
  }

  return (
    <FloatingPanelShell
      title={title}
      position={position}
      onPositionChange={onPositionChange}
      onCollapse={onCollapse}
      variant="no-merge"
      minSize={FLOATING_SELECTION_MIN_SIZE}
      maxSize={FLOATING_SELECTION_MAX_SIZE}
      className={styles.shell}
    >
      {children}
    </FloatingPanelShell>
  );
}

/**
 * Phase 1 占位内容:仅展示选中摘要,验证基座(浮出 / 拖动 / 折叠 / 位置记忆)。
 * Phase 2(图片)/ Phase 3(视频)以各端真实内容(改类 / 几何 / 属性 / 轨迹操作)替换。
 */
export function SelectionCardPlaceholder({ summary }: { summary: string }) {
  return (
    <div className={styles.body}>
      <p className={styles.summary}>{summary}</p>
    </div>
  );
}

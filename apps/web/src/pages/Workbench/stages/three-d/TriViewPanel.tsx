/**
 * v0.13.5 · 三正交视图面板 (主 3D 视图右栏)。B-1: 只读渲染基建。
 *
 * 结构: 一块占满面板的 WebGL canvas (TriViewRenderer, 居底) + 纵向 3 行 (top/side/front),
 * 每行一个 2D overlay (TriOrthoView, 叠其上) + 标题。面板按 3 行的实测像素矩形给 renderer
 * 下发 viewport, 使 WebGL 分屏与 overlay 严丝对齐。未选中框 → 三窗空, 显示占位提示。
 *
 * 生命周期: renderer 随面板挂载建一次、卸载 dispose (第二个也是唯一的额外 WebGL context)。
 * 点 geometry 复用主场景 (pointsReady 变化时重绑); 选中 PSR 变化时更新裁剪面/相机 + 重排。
 */
import { useCallback, useEffect, useRef } from "react";
import type * as THREE from "three";

import { TriViewRenderer, type ViewRectCss } from "./TriViewRenderer";
import { TriOrthoView, type TriSelected } from "./TriOrthoView";
import type { TriView } from "./geometry/triview";
import styles from "./ThreeDWorkbench.module.css";

const VIEWS: TriView[] = ["top", "side", "front"];
const TRI_LABEL: Record<TriView, string> = {
  top: "俯视 Top · X→ / Y↑",
  side: "侧视 Side · X→ / Z↑",
  front: "正视 Front · Y→ / Z↑",
};

interface TriViewPanelProps {
  /** 当前选中框 (PSR + 色); null = 无选中。 */
  selected: TriSelected | null;
  /** 取主场景当前点 BufferGeometry (复用同一份)。 */
  getPointsGeometry: () => THREE.BufferGeometry | null;
  /** 点云是否已加载完 (主场景 stats 到位); 变化时重绑 geometry。 */
  pointsReady: boolean;
}

export function TriViewPanel({ selected, getPointsGeometry, pointsReady }: TriViewPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<TriView, HTMLDivElement | null>>({
    top: null,
    side: null,
    front: null,
  });
  const rendererRef = useRef<TriViewRenderer | null>(null);

  // 量出 3 行相对面板的像素矩形, 下发给 renderer 当 viewport。
  const layout = useCallback(() => {
    const panel = panelRef.current;
    const r = rendererRef.current;
    if (!panel || !r) return;
    r.resize();
    const pr = panel.getBoundingClientRect();
    const rects: ViewRectCss[] = [];
    for (const view of VIEWS) {
      const el = rowRefs.current[view];
      if (!el) continue;
      const b = el.getBoundingClientRect();
      rects.push({ view, x: b.left - pr.left, y: b.top - pr.top, w: b.width, h: b.height });
    }
    r.setViewports(rects);
  }, []);

  // 挂载建 renderer, 卸载 dispose; 面板尺寸变化重排。
  useEffect(() => {
    if (!panelRef.current) return;
    const r = new TriViewRenderer(panelRef.current);
    rendererRef.current = r;
    layout();
    const ro = new ResizeObserver(() => layout());
    ro.observe(panelRef.current);
    return () => {
      ro.disconnect();
      r.dispose();
      rendererRef.current = null;
    };
  }, [layout]);

  // 点云加载完 (或换帧) 重绑 geometry。
  useEffect(() => {
    rendererRef.current?.setGeometry(getPointsGeometry());
  }, [pointsReady, getPointsGeometry]);

  // 选中框 PSR 变化: 更新裁剪面/相机, 并重排 (尺寸不变也无害)。
  useEffect(() => {
    rendererRef.current?.setBox(
      selected
        ? { center: selected.center, size: selected.size, rotation: selected.rotation }
        : null,
    );
    layout();
  }, [selected, layout]);

  return (
    <div ref={panelRef} className={styles.triPanel}>
      {VIEWS.map((view) => (
        <div
          key={view}
          ref={(el) => {
            rowRefs.current[view] = el;
          }}
          className={styles.triRow}
        >
          <TriOrthoView view={view} selected={selected} />
          <figcaption className={styles.triCaption}>{TRI_LABEL[view]}</figcaption>
        </div>
      ))}
      {!selected && (
        <div className={styles.triEmpty}>选中一个 3D 框后
          <br />
          在此俯 / 侧 / 正三视图精修
        </div>
      )}
    </div>
  );
}

export default TriViewPanel;

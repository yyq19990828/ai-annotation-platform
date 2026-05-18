import styles from "./PageLoader.module.css";

/**
 * v0.6.6 · 路由 lazy-load 时的最简 fallback。
 * 故意不加图标 / 文案，避免短暂闪烁；可见空间高度撑满。
 */
export function PageLoader() {
  return (
    <div className={styles.root}>
      加载中…
    </div>
  );
}

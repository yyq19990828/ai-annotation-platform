/**
 * v0.6.6 · 路由 lazy-load 时的最简 fallback。
 * 故意不加图标 / 文案，避免短暂闪烁；可见空间高度撑满。
 */
export function PageLoader() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 240,
        color: "var(--color-fg-subtle)",
        fontSize: 12,
        opacity: 0.6,
      }}
    >
      加载中…
    </div>
  );
}

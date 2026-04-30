const shimmer: React.CSSProperties = {
  background: "linear-gradient(90deg, var(--color-bg-sunken) 0%, var(--color-bg-elev) 50%, var(--color-bg-sunken) 100%)",
  backgroundSize: "200% 100%",
  animation: "wb-shimmer 1.4s linear infinite",
};

const styleTag = `@keyframes wb-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`;

function Block({ w, h, mb = 0, mt = 0, br = 4 }: { w: number | string; h: number; mb?: number; mt?: number; br?: number }) {
  return (
    <div style={{ width: w, height: h, marginBottom: mb, marginTop: mt, borderRadius: br, ...shimmer }} />
  );
}

export function WorkbenchSkeleton() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "260px 1fr 280px",
        height: "100%", overflow: "hidden", background: "var(--color-bg-sunken)",
      }}
    >
      <style>{styleTag}</style>

      {/* 左侧 task list */}
      <div style={{ background: "var(--color-bg-elev)", borderRight: "1px solid var(--color-border)", padding: 14 }}>
        <Block w={120} h={16} mb={10} />
        <Block w="80%" h={11} mb={20} />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Block w={40} h={40} />
            <div style={{ flex: 1 }}>
              <Block w="60%" h={11} mb={6} />
              <Block w="80%" h={10} />
            </div>
          </div>
        ))}
      </div>

      {/* 中央 stage */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 6, padding: 10, borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-elev)" }}>
          <Block w={60} h={26} />
          <Block w={80} h={26} />
          <Block w={26} h={26} />
          <Block w={26} h={26} />
          <div style={{ flex: 1 }} />
          <Block w={120} h={26} />
          <Block w={80} h={26} />
        </div>
        <div style={{ flex: 1, position: "relative", padding: 40 }}>
          <Block w="100%" h={undefined as unknown as number} />
          <div style={{ position: "absolute", inset: 40, ...shimmer, borderRadius: 6 }} />
        </div>
        <div style={{ padding: 8, borderTop: "1px solid var(--color-border)", background: "var(--color-bg-elev)" }}>
          <Block w="40%" h={11} />
        </div>
      </div>

      {/* 右侧 AI panel */}
      <div style={{ background: "var(--color-bg-elev)", borderLeft: "1px solid var(--color-border)", padding: 14 }}>
        <Block w="50%" h={14} mb={10} />
        <Block w="100%" h={32} mb={10} />
        <Block w="100%" h={28} mb={20} />
        {Array.from({ length: 5 }).map((_, i) => (
          <Block key={i} w="100%" h={42} mb={8} />
        ))}
      </div>
    </div>
  );
}

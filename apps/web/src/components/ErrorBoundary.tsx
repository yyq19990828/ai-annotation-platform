import React from "react";
import * as Sentry from "@sentry/react";

interface Props {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info.componentStack);
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return <DefaultFallback error={this.state.error} onReset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const [showStack, setShowStack] = React.useState(false);
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg)",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 560,
          width: "100%",
          padding: 28,
          background: "var(--color-bg-elev)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
        <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "var(--color-fg)" }}>页面出现错误</h2>
        <p style={{ margin: "0 0 16px", color: "var(--color-fg-muted)", fontSize: 13, lineHeight: 1.5 }}>
          {error.message || "未知错误"}
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => {
              onReset();
              window.location.reload();
            }}
            style={btnPrimary}
          >
            刷新页面
          </button>
          <button
            onClick={() => {
              onReset();
              window.location.href = "/dashboard";
            }}
            style={btnGhost}
          >
            回到首页
          </button>
          <button onClick={() => setShowStack((v) => !v)} style={btnGhost}>
            {showStack ? "隐藏" : "查看"}详情
          </button>
        </div>

        {showStack && (
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              fontSize: 11,
              lineHeight: 1.4,
              color: "var(--color-fg-muted)",
              overflow: "auto",
              maxHeight: 240,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {error.stack || error.message}
          </pre>
        )}
      </div>
    </div>
  );
}

const btnBase: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 13,
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  border: "1px solid var(--color-border)",
};
const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: "var(--color-primary)",
  color: "#fff",
  borderColor: "var(--color-primary)",
};
const btnGhost: React.CSSProperties = {
  ...btnBase,
  background: "transparent",
  color: "var(--color-fg)",
};

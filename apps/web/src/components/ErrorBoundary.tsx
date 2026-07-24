import React from "react";
import * as Sentry from "@sentry/react";

import styles from "./ErrorBoundary.module.css";

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
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.icon}>⚠️</div>
        <h2 className={styles.title}>页面出现错误</h2>
        <p className={styles.message}>{error.message || "未知错误"}</p>

        <div className={styles.actions}>
          <button
            onClick={() => {
              onReset();
              window.location.reload();
            }}
            className={styles.primaryButton}
          >
            刷新页面
          </button>
          <button
            onClick={() => {
              onReset();
              window.location.href = "/dashboard";
            }}
            className={styles.ghostButton}
          >
            回到首页
          </button>
          <button onClick={() => setShowStack((v) => !v)} className={styles.ghostButton}>
            {showStack ? "隐藏" : "查看"}详情
          </button>
        </div>

        {showStack && <pre className={styles.stack}>{error.stack || error.message}</pre>}
      </div>
    </div>
  );
}

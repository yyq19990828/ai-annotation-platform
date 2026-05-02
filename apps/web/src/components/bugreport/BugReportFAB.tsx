import { Icon } from "@/components/ui/Icon";

interface BugReportFABProps {
  onClick: () => void;
}

export function BugReportFAB({ onClick }: BugReportFABProps) {
  return (
    <button
      data-bug-fab
      onClick={onClick}
      title="报告 Bug / 提交反馈"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 100,
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: "var(--color-accent)",
        color: "#fff",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
        transition: "transform 0.15s, opacity 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.08)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      <Icon name="bug" size={18} />
    </button>
  );
}

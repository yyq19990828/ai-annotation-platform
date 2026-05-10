import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownBlockProps {
  children: string;
  compact?: boolean;
}

export function MarkdownBlock({ children, compact = false }: MarkdownBlockProps) {
  return (
    <div style={{ color: "var(--color-fg)", lineHeight: compact ? 1.45 : 1.6, fontSize: compact ? 12.5 : 13 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-primary)" }}>
              {linkChildren}
            </a>
          ),
          p: ({ children: pChildren }) => <p style={{ margin: compact ? "0 0 6px" : "0 0 10px" }}>{pChildren}</p>,
          ul: ({ children: listChildren }) => <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>{listChildren}</ul>,
          ol: ({ children: listChildren }) => <ol style={{ margin: "0 0 8px", paddingLeft: 18 }}>{listChildren}</ol>,
          li: ({ children: itemChildren }) => <li style={{ marginBottom: 3 }}>{itemChildren}</li>,
          blockquote: ({ children: quoteChildren }) => (
            <blockquote
              style={{
                margin: "0 0 8px",
                padding: "2px 0 2px 10px",
                borderLeft: "3px solid var(--color-border)",
                color: "var(--color-fg-muted)",
              }}
            >
              {quoteChildren}
            </blockquote>
          ),
          code: ({ children: codeChildren }) => (
            <code
              style={{
                background: "var(--color-code-bg)",
                color: "var(--color-code-fg)",
                padding: "1px 4px",
                borderRadius: 3,
                fontSize: compact ? 11 : 12,
                fontFamily: "var(--font-mono)",
                border: "1px solid var(--color-border)",
              }}
            >
              {codeChildren}
            </code>
          ),
          pre: ({ children: preChildren }) => (
            <pre
              style={{
                margin: "0 0 10px",
                padding: 10,
                overflow: "auto",
                background: "var(--color-bg-sunken)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {preChildren}
            </pre>
          ),
          table: ({ children: tableChildren }) => (
            <div style={{ overflowX: "auto", marginBottom: 10 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>{tableChildren}</table>
            </div>
          ),
          th: ({ children: cellChildren }) => (
            <th style={{ border: "1px solid var(--color-border)", padding: "4px 6px", textAlign: "left" }}>
              {cellChildren}
            </th>
          ),
          td: ({ children: cellChildren }) => (
            <td style={{ border: "1px solid var(--color-border)", padding: "4px 6px" }}>{cellChildren}</td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./MarkdownBlock.module.css";

interface MarkdownBlockProps {
  children: string;
  compact?: boolean;
}

export function MarkdownBlock({ children, compact = false }: MarkdownBlockProps) {
  return (
    <div className={styles.root} data-compact={compact ? "true" : undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className={styles.link}>
              {linkChildren}
            </a>
          ),
          p: ({ children: pChildren }) => <p className={styles.paragraph}>{pChildren}</p>,
          ul: ({ children: listChildren }) => <ul className={styles.list}>{listChildren}</ul>,
          ol: ({ children: listChildren }) => <ol className={styles.list}>{listChildren}</ol>,
          li: ({ children: itemChildren }) => <li className={styles.listItem}>{itemChildren}</li>,
          blockquote: ({ children: quoteChildren }) => (
            <blockquote className={styles.blockquote}>{quoteChildren}</blockquote>
          ),
          code: ({ children: codeChildren }) => <code className={styles.code}>{codeChildren}</code>,
          pre: ({ children: preChildren }) => <pre className={styles.pre}>{preChildren}</pre>,
          table: ({ children: tableChildren }) => (
            <div className={styles.tableWrap}>
              <table className={styles.table}>{tableChildren}</table>
            </div>
          ),
          th: ({ children: cellChildren }) => (
            <th className={styles.tableHeader}>{cellChildren}</th>
          ),
          td: ({ children: cellChildren }) => <td className={styles.tableCell}>{cellChildren}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

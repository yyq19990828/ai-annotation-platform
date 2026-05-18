import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "@/components/bugreport/MarkdownBlock.module.css";

interface GuideMarkdownViewProps {
  /** Markdown 原文. */
  content: string;
  /** 将 guide-asset:KEY 形式的 src 解析为签名 URL. */
  resolveAssetUrl?: (key: string) => Promise<string>;
}

/**
 * v0.10.13 · E1 · 渲染 annotation guide Markdown.
 *
 * 与 MarkdownBlock 同样基于 react-markdown + remark-gfm, 额外:
 * - <img src="guide-asset:KEY"> 经 resolveAssetUrl 转签名 URL 渲染.
 * - 解析失败 / 加载中显示占位文本, 避免 404.
 */
export function GuideMarkdownView({
  content,
  resolveAssetUrl,
}: GuideMarkdownViewProps) {
  const [signedMap, setSignedMap] = useState<Record<string, string>>({});
  // 收集所有 guide-asset:KEY, 一次性 prefetch.
  const keys = useMemo(() => {
    const re = /guide-asset:([^\s)]+)/g;
    const out = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) out.add(m[1]);
    return Array.from(out);
  }, [content]);

  useEffect(() => {
    if (!resolveAssetUrl) return;
    let cancelled = false;
    Promise.all(
      keys.map((k) =>
        resolveAssetUrl(k)
          .then((url) => [k, url] as const)
          .catch(() => [k, ""] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setSignedMap(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [keys, resolveAssetUrl]);

  return (
    <div className={styles.root}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            if (typeof src === "string" && src.startsWith("guide-asset:")) {
              const key = src.slice("guide-asset:".length);
              const resolved = signedMap[key];
              if (!resolved) {
                return <span aria-label={alt || ""}>[加载图片中…]</span>;
              }
              return <img src={resolved} alt={alt || ""} />;
            }
            return <img src={src} alt={alt || ""} />;
          },
          p: ({ children }) => <p className={styles.paragraph}>{children}</p>,
          ul: ({ children }) => <ul className={styles.list}>{children}</ul>,
          ol: ({ children }) => <ol className={styles.list}>{children}</ol>,
          li: ({ children }) => <li className={styles.listItem}>{children}</li>,
          code: ({ children }) => <code className={styles.code}>{children}</code>,
          pre: ({ children }) => <pre className={styles.pre}>{children}</pre>,
          table: ({ children }) => (
            <div className={styles.tableWrap}>
              <table className={styles.table}>{children}</table>
            </div>
          ),
          th: ({ children }) => <th className={styles.tableHeader}>{children}</th>,
          td: ({ children }) => <td className={styles.tableCell}>{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default GuideMarkdownView;

import MarkdownView from "@/components/markdown/MarkdownView";

interface MarkdownBlockProps {
  children: string;
  compact?: boolean;
}

export function MarkdownBlock({ children, compact = false }: MarkdownBlockProps) {
  return <MarkdownView content={children} compact={compact} />;
}

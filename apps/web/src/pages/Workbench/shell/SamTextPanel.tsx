// v0.9.2 引入的 SAM 文本提示输入面板.
// v0.10.23 · 设计 B · 文本输入下沉到子工具面板 (AIToolDrawer 的 text-prompt 分支),
// 替换原先「在右侧 AI 面板输入文本」的 hint; 预测结果列表仍留 AI 面板.
// 输入 → Enter/「找全图」→ 复用现有 runText 链路 (逻辑零改, 仅挪渲染位置).

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { TextOutputMode } from "../state/useInteractiveAI";
import { resolveInitialOutputMode, writeStoredOutputMode } from "../state/samTextOutput";
import { SamOutputModeTabs } from "./SamOutputModeTabs";
import { useProject } from "@/hooks/useProjects";
import styles from "./SamTextPanel.module.css";

interface SamTextPanelProps {
  /** v0.9.4 phase 2 · onRun 接 outputMode (box / mask / both) 参数 */
  onRun: (text: string, outputMode: TextOutputMode) => void;
  running: boolean;
  candidateCount: number;
  /** v0.9.4 phase 2 · sessionStorage 持久化 key + 智能默认按 type_key */
  projectId?: string;
  projectTypeKey?: string | null;
  /** v0.9.4 phase 2 · 切到 sam-text 子工具时父级自增此值, panel 拿到后自动 focus input. */
  focusKey?: number;
}

export function SamTextPanel({
  onRun,
  running,
  candidateCount,
  projectId,
  projectTypeKey,
  focusKey,
}: SamTextPanelProps) {
  const [text, setText] = useState("");
  // v0.9.5 · 类别 alias 快速填入; 必须先于使用其 data 的 useState 初始化器声明, 避免 TDZ.
  const projectQ = useProject(projectId ?? "");
  const [outputMode, setOutputMode] = useState<TextOutputMode>(() =>
    resolveInitialOutputMode(projectId, projectTypeKey, projectQ.data?.text_output_default),
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const aliases = useMemo(() => {
    const cfg = projectQ.data?.classes_config ?? {};
    return Object.entries(cfg)
      .map(([name, entry]) => ({ name, alias: entry?.alias ?? null }))
      .filter((e): e is { name: string; alias: string } => !!e.alias);
  }, [projectQ.data?.classes_config]);
  // 切项目重新计算默认 (跨 project 不串扰); v0.9.5 项目级 default 拉到后再应用一次.
  useEffect(() => {
    setOutputMode(resolveInitialOutputMode(projectId, projectTypeKey, projectQ.data?.text_output_default));
  }, [projectId, projectTypeKey, projectQ.data?.text_output_default]);
  // v0.9.4 phase 2 · S 键循环到 sam-text 子工具时父级 bumpSamTextFocus → focusKey 变 → 抓焦.
  useEffect(() => {
    if (focusKey === undefined || focusKey === 0) return;
    inputRef.current?.focus();
  }, [focusKey]);
  const handleModeChange = (mode: TextOutputMode) => {
    setOutputMode(mode);
    if (projectId) writeStoredOutputMode(projectId, mode);
  };
  const trimmed = text.trim();
  return (
    <div
      data-testid="sam-text-panel"
      className={styles.samTextPanel}
    >
      <div className={styles.samTextHeader}>
        <span className={styles.samTextTitle}>
          <Icon name="messageSquareText" size={11} /> SAM 文本提示
        </span>
        {candidateCount > 0 && (
          <span className={styles.compactBadge}>
            <Badge variant="ai">
              {candidateCount} 候选 · Tab 切换 · Enter 接受
            </Badge>
          </span>
        )}
      </div>
      {/* v0.9.4 phase 2 · 输出形态三选一 (智能默认按 type_key, 用户切换写 sessionStorage) */}
      <div className={styles.samTextOutputMode} data-testid="sam-text-output-mode">
        <SamOutputModeTabs value={outputMode} onChange={handleModeChange} />
      </div>
      {aliases.length > 0 && (
        <div
          data-testid="sam-text-aliases"
          className={styles.samTextAliases}
        >
          {aliases.map((a) => (
            <button
              key={a.name}
              type="button"
              onClick={() => setText(a.alias)}
              title={`使用类别「${a.name}」alias`}
              className={styles.samAliasButton}
            >
              {a.alias}
            </button>
          ))}
        </div>
      )}
      <div className={styles.samInputRow}>
        <input
          data-testid="sam-text-input"
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmed && !running) {
              e.preventDefault();
              onRun(trimmed, outputMode);
            }
          }}
          placeholder="e.g. person / car / ripe apple"
          disabled={running}
          className={styles.samTextInput}
        />
        <Button
          variant="ai"
          size="sm"
          disabled={!trimmed || running}
          onClick={() => onRun(trimmed, outputMode)}
          className={styles.inlineIconButton}
        >
          {running && <Icon name="loader2" size={11} className="spin" />}
          {running ? "推理中…" : "找全图"}
        </Button>
      </div>
      <div className={styles.samHint}>
        {outputMode === "box" && "仅出检测框,跳过掩膜,速度最快; "}
        {outputMode === "mask" && "输出掩膜 → polygon, 默认行为; "}
        {outputMode === "both" && "同实例配对返回框 + 掩膜, Tab 切换活跃形态; "}
        英文 prompt 召回通常更佳;阈值等参数在 AI 面板调整。
      </div>
    </div>
  );
}

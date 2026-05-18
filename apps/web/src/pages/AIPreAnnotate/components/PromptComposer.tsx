/**
 * v0.9.7 · Step 2: Prompt 输入 + alias chips (含频率角标).
 *
 * 视觉/交互优化:
 * - chips 限高滚动 + 子串筛选搜索框
 * - chip 上显示 prediction 频率角标 ×N (frequency 来自 Block C 端点)
 * - hover/active 反馈
 * - 空 alias 引导卡 (跳项目设置)
 * - Ctrl/Cmd+Enter 提交
 */

import { useMemo, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { CHIPS_SHOW_SEARCH_THRESHOLD } from "../styles";
import styles from "./PromptComposer.module.css";

export interface AliasEntry {
  name: string;
  alias: string;
  count: number;
}

interface Props {
  anchorId: string;
  stepBadge: string;
  projectId: string;

  prompt: string;
  onPromptChange: (v: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;

  aliases: AliasEntry[];
  hasAnyClassConfigured: boolean;

  boxThreshold: number;
  textThreshold: number;
}

export function PromptComposer({
  anchorId,
  stepBadge,
  projectId,
  prompt,
  onPromptChange,
  onSubmit,
  canSubmit,
  aliases,
  hasAnyClassConfigured,
  boxThreshold,
  textThreshold,
}: Props) {
  const [filter, setFilter] = useState("");

  const filteredAliases = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return aliases;
    return aliases.filter(
      (a) => a.alias.toLowerCase().includes(f) || a.name.toLowerCase().includes(f),
    );
  }, [aliases, filter]);

  // B-10 · 把 prompt 拆成 token, 用于判定 chip 选中态 + toggle add/remove.
  const promptTokens = useMemo(
    () =>
      prompt
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    [prompt],
  );
  const promptTokenSet = useMemo(() => new Set(promptTokens), [promptTokens]);

  const toggleAlias = (alias: string) => {
    const a = alias.trim();
    if (!a) return;
    const aLower = a.toLowerCase();
    if (promptTokenSet.has(aLower)) {
      // 移除
      const next = prompt
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t && t.toLowerCase() !== aLower)
        .join(", ");
      onPromptChange(next);
    } else {
      const trimmed = prompt.trim().replace(/,\s*$/, "");
      onPromptChange(trimmed ? `${trimmed}, ${a}` : a);
    }
  };

  const selectAll = () => {
    onPromptChange(aliases.map((x) => x.alias).join(", "));
  };

  const clearAll = () => {
    onPromptChange("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <Card>
      <div id={anchorId} className={styles.cardHeader}>
        <span>{stepBadge} · Prompt</span>
        <span className={styles.shortcutHint}>
          ⌘/Ctrl + Enter 跑预标
        </span>
      </div>
      <div className={styles.cardBody}>
        {aliases.length > 0 ? (
          <div className={styles.aliasSection}>
            <div className={styles.aliasToolbar}>
              <span className={styles.aliasSummary}>
                类别 alias 切换添加 / 移除 ({promptTokenSet.size}/{aliases.length})·按预标频率排序：
              </span>
              <button
                type="button"
                onClick={selectAll}
                className={styles.toolbarButton}
              >
                全选
              </button>
              <button
                type="button"
                onClick={clearAll}
                className={styles.toolbarButton}
              >
                清空
              </button>
              {aliases.length > CHIPS_SHOW_SEARCH_THRESHOLD && (
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="筛选 alias..."
                  className={styles.aliasFilter}
                />
              )}
            </div>
            <div className={styles.aliasChips}>
              {filteredAliases.map((a) => {
                const isActive = promptTokenSet.has(a.alias.toLowerCase());
                return (
                  <button
                    key={a.name}
                    type="button"
                    onClick={() => toggleAlias(a.alias)}
                    className={`${styles.aliasChip} ${isActive ? styles.aliasChipActive : ""}`}
                    title={`${isActive ? "移除" : "添加"} 类别「${a.name}」的 alias${a.count > 0 ? ` · 历史预标 ${a.count} 次` : ""}`}
                  >
                    <span>{isActive ? "✓ " : ""}{a.alias}</span>
                    <span className={styles.aliasName}>
                      ({a.name})
                    </span>
                    {a.count > 0 && (
                      <span className={styles.aliasCount}>
                        ×{a.count}
                      </span>
                    )}
                  </button>
                );
              })}
              {filteredAliases.length === 0 && (
                <span className={styles.emptyFilter}>
                  无匹配 alias（当前筛选：{filter}）
                </span>
              )}
            </div>
          </div>
        ) : (
          hasAnyClassConfigured && (
            <div className={styles.aliasEmptyCard}>
              <Icon name="info" size={12} />
              <span>本项目类别尚未配置英文 alias。</span>
              <Link
                to={`/projects/${projectId}/settings#class-config`}
                className={styles.settingsLink}
              >
                前往项目设置 →
              </Link>
            </div>
          )
        )}

        <div>
          <label className={styles.label}>Prompt（英文召回最佳）</label>
          <input
            type="text"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. person, car, ripe apple"
            className={styles.promptInput}
            autoFocus
          />
          <div className={styles.helperText}>
            项目当前 DINO 阈值：box={boxThreshold} / text={textThreshold}
          </div>
        </div>
      </div>
    </Card>
  );
}

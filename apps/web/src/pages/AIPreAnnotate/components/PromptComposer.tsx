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
import {
  cardBodyStyle,
  cardHeaderStyle,
  labelStyle,
  selectStyle,
  helperTextStyle,
  aliasChipStyle,
  aliasChipActiveStyle,
  CHIPS_MAX_HEIGHT,
  CHIPS_SHOW_SEARCH_THRESHOLD,
  FS_XS,
} from "../styles";

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

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <Card>
      <div id={anchorId} style={{ ...cardHeaderStyle, scrollMarginTop: 80 }}>
        <span>{stepBadge} · Prompt</span>
        <span style={{ fontSize: FS_XS, color: "var(--color-fg-subtle)", fontWeight: 400 }}>
          ⌘/Ctrl + Enter 跑预标
        </span>
      </div>
      <div style={cardBodyStyle}>
        {aliases.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: FS_XS, color: "var(--color-fg-subtle)" }}>
                类别 alias 快速填入 ({aliases.length})·按预标频率排序：
              </span>
              {aliases.length > CHIPS_SHOW_SEARCH_THRESHOLD && (
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="筛选 alias..."
                  style={{
                    flex: 1,
                    minWidth: 140,
                    padding: "2px 8px",
                    fontSize: FS_XS,
                    background: "var(--color-bg-sunken)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--color-fg)",
                    outline: "none",
                  }}
                />
              )}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                maxHeight: CHIPS_MAX_HEIGHT,
                overflowY: "auto",
                padding: "2px 0",
              }}
            >
              {filteredAliases.map((a) => {
                const isActive = prompt.trim() === a.alias;
                return (
                  <button
                    key={a.name}
                    type="button"
                    onClick={() => onPromptChange(a.alias)}
                    style={isActive ? aliasChipActiveStyle : aliasChipStyle}
                    title={`使用类别「${a.name}」的 alias${a.count > 0 ? ` · 历史预标 ${a.count} 次` : ""}`}
                  >
                    <span>{a.alias}</span>
                    <span style={{ color: "var(--color-fg-subtle)", fontSize: 10 }}>
                      ({a.name})
                    </span>
                    {a.count > 0 && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "var(--color-ai)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        ×{a.count}
                      </span>
                    )}
                  </button>
                );
              })}
              {filteredAliases.length === 0 && (
                <span style={{ ...helperTextStyle, marginTop: 0 }}>
                  无匹配 alias（当前筛选：{filter}）
                </span>
              )}
            </div>
          </div>
        ) : (
          hasAnyClassConfigured && (
            <div
              style={{
                padding: "10px 12px",
                background: "var(--color-bg-sunken)",
                border: "1px dashed var(--color-border)",
                borderRadius: "var(--radius-sm)",
                fontSize: FS_XS,
                color: "var(--color-fg-muted)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Icon name="info" size={12} />
              <span>本项目类别尚未配置英文 alias。</span>
              <Link
                to={`/projects/${projectId}/settings#class-config`}
                style={{ color: "var(--color-ai)", textDecoration: "none" }}
              >
                前往项目设置 →
              </Link>
            </div>
          )
        )}

        <div>
          <label style={labelStyle}>Prompt（英文召回最佳）</label>
          <input
            type="text"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. person, car, ripe apple"
            style={selectStyle}
            autoFocus
          />
          <div style={helperTextStyle}>
            项目当前 DINO 阈值：box={boxThreshold} / text={textThreshold}
          </div>
        </div>
      </div>
    </Card>
  );
}

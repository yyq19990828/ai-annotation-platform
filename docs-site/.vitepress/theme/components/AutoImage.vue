<script setup lang="ts">
/**
 * M4 · <AutoImage> VitePress 组件。
 *
 * 用法（在 .md 文件中）：
 *   <AutoImage src="bbox/toolbar.png" alt="Bbox 工具栏" />
 *
 * 行为：
 *   - 从 manifest.json 读取该图片的元数据
 *   - 相对 src 与仓库路径 src 都映射到站点的 /user-guide/images/ 目录
 *   - 绝对路径与 http(s) URL 保持原样
 *   - auto:true  → 显示「自动产出」badge + 最后更新日期 + scene 源码链接
 *   - auto:false → 显示「手动维护」badge
 *   - 不在 manifest → 普通 <img>（无 badge）
 *
 * manifest.json 由 `pnpm screenshots` 运行后生成在：
 *   apps/web/e2e/screenshots/outputs/manifest.json
 * VitePress 构建时通过 vitepress.config 里的 vite.publicDir 或 alias 暴露。
 */
import { computed } from "vue";

// manifest 在构建时通过 vite 虚拟模块或 JSON import 注入
// 降级：如果没有 manifest，直接渲染普通图片
let manifest: Record<string, {
  auto: boolean;
  scene?: string;
  lastRun?: string;
  note?: string;
}> = {};

try {
  // @ts-ignore — 由 vitepress config alias 指向 outputs/manifest.json
  const mod = await import("virtual:screenshot-manifest");
  manifest = mod.default ?? mod;
} catch {
  // manifest 未配置时静默降级
}

const props = defineProps<{
  src: string;
  alt?: string;
  width?: string | number;
  /** 可选：图片说明文字，显示在 badge 行左侧 */
  caption?: string;
}>();

const REPO_IMAGE_PREFIX = "docs-site/user-guide/images/";
const PUBLIC_IMAGE_PREFIX = "/user-guide/images/";

// 标准化 key：src 可能是相对图片路径、站点绝对路径或仓库完整路径
const manifestKey = computed(() => {
  const s = props.src;
  if (s.startsWith("docs-site/")) return s;
  if (s.startsWith(PUBLIC_IMAGE_PREFIX)) return `docs-site${s}`;
  return `${REPO_IMAGE_PREFIX}${s}`;
});

const entry = computed(() => manifest[manifestKey.value]);

const lastRunDate = computed(() => {
  const r = entry.value?.lastRun;
  return r ? r.slice(0, 10) : null;
});

// 图片实际路径：仓库路径和相对路径都归一到站点的 /user-guide/images/ 目录
const imgSrc = computed(() => {
  const s = props.src;
  // 绝对站点路径和远端 URL 保持原样
  if (s.startsWith("/") || s.startsWith("http")) return s;
  if (s.startsWith(REPO_IMAGE_PREFIX)) {
    return `${PUBLIC_IMAGE_PREFIX}${s.slice(REPO_IMAGE_PREFIX.length)}`;
  }
  return `${PUBLIC_IMAGE_PREFIX}${s}`;
});
</script>

<template>
  <figure class="auto-image">
    <img :src="imgSrc" :alt="alt ?? src" :width="width" />
    <figcaption v-if="caption || entry">
      <span v-if="caption" class="ai-caption">{{ caption }}</span>
      <span v-if="entry" class="ai-meta">
        <span v-if="entry.auto" class="badge badge-auto">
          ⚡ 自动产出
          <span v-if="lastRunDate"> · {{ lastRunDate }}</span>
        </span>
        <span v-else class="badge badge-manual">✏ 手动维护</span>
        <span v-if="entry.auto && entry.scene" class="scene-link">
          <a
            :href="`https://github.com/yyq19990828/ai-annotation-platform/blob/main/apps/web/e2e/screenshots/scenes/${entry.scene.split('/')[0]}.ts`"
            target="_blank"
            rel="noopener"
          >
            场景源码 ↗
          </a>
        </span>
        <span v-if="!entry.auto && entry.note" class="manual-note">
          {{ entry.note }}
        </span>
      </span>
    </figcaption>
  </figure>
</template>

<style scoped>
.auto-image {
  margin: 1.75rem 0;
}
.auto-image img {
  display: block;
  border-radius: 8px;
  border: 1px solid var(--vp-c-border);
  max-width: 100%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
figcaption {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem 0.75rem;
  margin-top: 0.55rem;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}
.ai-caption {
  color: var(--vp-c-text-2);
}
.ai-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}
.badge {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
}
.badge-auto   { background: var(--vp-c-green-soft); color: var(--vp-c-green-1); }
.badge-manual { background: var(--vp-c-yellow-soft); color: var(--vp-c-yellow-1); }
.scene-link a { color: var(--vp-c-brand-1); text-decoration: none; }
.scene-link a:hover { text-decoration: underline; }
.manual-note { color: var(--vp-c-text-3); font-style: italic; }
</style>

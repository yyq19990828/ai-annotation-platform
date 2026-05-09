<script setup lang="ts">
/**
 * M4 · <AutoImage> VitePress 组件。
 *
 * 用法（在 .md 文件中）：
 *   <AutoImage src="bbox/toolbar.png" alt="Bbox 工具栏" />
 *
 * 行为：
 *   - 从 manifest.json 读取该图片的元数据
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
}>();

// 标准化 key：src 可能是 "bbox/toolbar.png"，manifest key 是完整路径
const manifestKey = computed(() => {
  const s = props.src;
  if (s.startsWith("docs-site/")) return s;
  return `docs-site/user-guide/images/${s}`;
});

const entry = computed(() => manifest[manifestKey.value]);

const lastRunDate = computed(() => {
  const r = entry.value?.lastRun;
  return r ? r.slice(0, 10) : null;
});

// 图片实际路径（相对于文档站 /images/...）
const imgSrc = computed(() => {
  const s = props.src;
  // 已经是 /images/ 开头或 http
  if (s.startsWith("/") || s.startsWith("http")) return s;
  // 去掉 docs-site/user-guide/images/ 前缀（VitePress public 目录）
  return s.replace(/^docs-site\/user-guide\/images\//, "/images/");
});
</script>

<template>
  <figure class="auto-image">
    <img :src="imgSrc" :alt="alt ?? src" :width="width" />
    <figcaption v-if="entry">
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
    </figcaption>
  </figure>
</template>

<style scoped>
.auto-image {
  margin: 1.5rem 0;
}
.auto-image img {
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  max-width: 100%;
}
figcaption {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.4rem;
  font-size: 0.78rem;
  color: var(--vp-c-text-2);
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

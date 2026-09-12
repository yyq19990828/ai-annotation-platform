<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";
import DefaultTheme from "vitepress/theme";

const { page, frontmatter } = useData();
const { Layout } = DefaultTheme;
const domains: Record<string, string> = {
  "user-guide": "使用指南",
  dev: "开发文档",
  api: "API 文档",
  ops: "部署运维",
  changelog: "更新日志",
  roadmap: "路线图",
};
const types: Record<string, string> = {
  tutorial: "入门教程",
  "how-to": "操作指南",
  reference: "技术参考",
  explanation: "概念说明",
};
const reading = computed(
  () => (frontmatter.value.layout ?? "doc") === "doc" && !page.value.isNotFound,
);
const domain = computed(() => page.value.relativePath.split("/")[0]);
const label = computed(() => domains[domain.value]);
const kind = computed(() =>
  String(frontmatter.value.pageClass ?? "").includes("docs-hub-page")
    ? undefined
    : types[frontmatter.value.type],
);
</script>

<template>
  <Layout :class="{ 'docs-reading-page': reading }">
    <template #sidebar-nav-before>
      <a v-if="label" class="docs-domain" :href="withBase(`/${domain}/`)">
        <span class="docs-domain-caption">文档 / DOCUMENTATION</span>
        <span>{{ label }}</span>
      </a>
    </template>
    <template #doc-before>
      <nav v-if="label" class="doc-section" aria-label="文档位置">
        <a :href="withBase(`/${domain}/`)">{{ label }}</a>
        <template v-if="kind">
          <span aria-hidden="true">/</span>
          <span class="doc-kind">{{ kind }}</span>
        </template>
      </nav>
    </template>
  </Layout>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { withBase } from "vitepress";

const props = defineProps<{
  icon?: string;
  title: string;
  desc?: string;
  href: string;
  badge?: string;
}>();

const external = computed(() => /^https?:\/\//.test(props.href));
const resolved = computed(() => (external.value ? props.href : withBase(props.href)));
</script>

<template>
  <a
    class="doc-link-card"
    :href="resolved"
    :target="external ? '_blank' : undefined"
    :rel="external ? 'noreferrer' : undefined"
  >
    <span v-if="icon" class="dlc-icon" aria-hidden="true">{{ icon }}</span>
    <span class="dlc-body">
      <span class="dlc-title">
        {{ title }}
        <span v-if="badge" class="dlc-badge">{{ badge }}</span>
      </span>
      <span v-if="desc" class="dlc-desc">{{ desc }}</span>
    </span>
    <span class="dlc-arrow" aria-hidden="true">→</span>
  </a>
</template>

<style scoped>
.doc-link-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  height: 100%;
  padding: 18px 18px 18px 20px;
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  text-decoration: none !important;
  color: var(--vp-c-text-1);
  transition:
    border-color 0.22s ease,
    transform 0.22s ease,
    background-color 0.22s ease;
}
.doc-link-card:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
  transform: translateY(-3px);
}
.dlc-icon {
  font-size: 22px;
  line-height: 1.2;
  flex-shrink: 0;
}
.dlc-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dlc-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--vp-c-text-1);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.dlc-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
.dlc-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}
.dlc-arrow {
  margin-left: auto;
  align-self: center;
  color: var(--vp-c-text-3);
  transition:
    transform 0.22s ease,
    color 0.22s ease;
}
.doc-link-card:hover .dlc-arrow {
  color: var(--vp-c-brand-1);
  transform: translateX(3px);
}
</style>

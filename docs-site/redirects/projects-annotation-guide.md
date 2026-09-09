---
search: false
sitemap: false
editLink: false
outline: false
---

<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vitepress";

const router = useRouter();
onMounted(() => router.go("/user-guide/projects/"));
</script>

# 页面已迁移

标注指引已移到项目设置页的「标注指引」区，正在返回[项目管理](/user-guide/projects/)。进入具体项目后选择「项目设置 → 标注指引」即可编辑和预览。

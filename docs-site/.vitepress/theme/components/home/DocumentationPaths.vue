<script setup lang="ts">
import { withBase } from "vitepress";

const paths = [
  {
    no: "#01 / OPERATE",
    title: "使用平台",
    desc: "创建项目、导入数据、完成标注并进入质量审核。",
    link: "USER GUIDE ↗",
    href: withBase("/user-guide/"),
  },
  {
    no: "#02 / AUTOMATE",
    title: "AI 辅助",
    desc: "连接模型后端，运行预标注、追踪与失败恢复。",
    link: "AI WORKFLOWS ↗",
    href: withBase("/user-guide/ai/"),
  },
  {
    no: "#03 / BUILD",
    title: "开发与集成",
    desc: "API、SDK、部署拓扑和 ML Backend 协议。",
    link: "DEVELOPER DOCS ↗",
    href: withBase("/dev/"),
  },
];
</script>

<template>
  <section class="paper" id="paths">
    <div class="paper-top">
      <div>
        <span class="section-no">03 / CHOOSE YOUR PATH</span>
        <h2 class="reveal">DOCUMENTATION<br />AS A WORKSPACE.</h2>
      </div>
      <p class="paper-note">
        不是功能清单。每个入口都回答：你是谁、要完成什么、下一步在哪里。
      </p>
    </div>
    <div class="paths reveal">
      <a v-for="p in paths" :key="p.title" class="path" :href="p.href">
        <small>{{ p.no }}</small>
        <h3>{{ p.title }}</h3>
        <p>{{ p.desc }}</p>
        <span class="path-link">{{ p.link }}</span>
        <i class="path-visual" aria-hidden="true"></i>
      </a>
    </div>
  </section>
</template>

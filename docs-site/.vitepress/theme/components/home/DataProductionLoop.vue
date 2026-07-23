<script setup lang="ts">
const steps = [
  { no: "01", title: "导入数据", desc: "本地文件、对象存储和批量数据集进入统一项目空间。" },
  { no: "02", title: "AI 生成候选", desc: "模型先完成可自动化的部分，并保留推理与任务状态。" },
  { no: "03", title: "人工修正", desc: "标注员聚焦判断、边界和异常，而不是重复劳动。" },
  { no: "04", title: "质量审核", desc: "通过、回退、评论和审计记录构成可验证的质量链路。" },
  { no: "05", title: "训练集导出", desc: "开放格式让数据直接进入训练、评估和下一轮模型迭代。" },
];
</script>

<template>
  <section class="flow" id="flow">
    <span class="section-no">04 / DATA PRODUCTION LOOP</span>
    <div class="flow-layout">
      <div class="flow-sticky reveal">
        <h2>ONE LOOP.<br />EVERY<br />DECISION.</h2>
        <p>数据从进入平台的那一刻起，就拥有完整上下文。模型负责提速，人负责判断，系统负责记录。</p>
      </div>
      <div class="steps">
        <div v-for="s in steps" :key="s.no" class="step reveal">
          <span class="step-no">{{ s.no }}</span>
          <div>
            <h3>{{ s.title }}</h3>
            <p>{{ s.desc }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
